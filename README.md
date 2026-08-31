# SURGE 工作汇报系统

SURGE 是自托管的工作汇报平台：用户可上传单个 HTML 或包含 `report.html` 的 ZIP，管理元数据，并生成可设密码和过期时间的只读分享链接。

## 环境要求

- Node.js 24+ / pnpm 11.21+
- PostgreSQL 17
- 代码目录之外的持久化报告数据卷

## 本地开发

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

在 `.env.local` 中至少配置 `DATABASE_URL`、`BETTER_AUTH_SECRET` 和 `REPORTS_DATA_DIR`。报告数据目录在所有环境都必须显式指定；本地也应使用当前 checkout 之外的专用目录。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check  # 一次执行全部检查
```

## 配置

完整示例见 [`.env.example`](./.env.example)。生产环境的关键项：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `BETTER_AUTH_SECRET` | 会话与内部密钥派生的高熵根密钥 |
| `BETTER_AUTH_URL` | 对外的 HTTPS 站点地址 |
| `REPORTS_ORIGIN` | 独立、无 Cookie 的 HTTPS 汇报内容域，生产必填且主机名必须不同于主站 |
| `REPORTS_DATA_DIR` | checkout 之外的持久化报告目录，所有环境必填 |
| `SHARE_SECRET` | 分享解锁凭证的独立签名密钥（生产必填） |
| `SHARE_TOKEN_ENCRYPTION_KEY` | 可选的分享 URL 令牌和 4 位提取码独立加密根密钥；设置后需持久保存 |
| `OTP_SECRET` | OTP HMAC 密钥；不设时从 `BETTER_AUTH_SECRET` 派生 |
| `TRUSTED_PROXIES` | 允许提供真实客户端 IP 的反向代理 IP/CIDR |
| `DB_QUERY_TIMEOUT_MS` | 业务数据库查询超时，默认 15000 ms |
| `AUTH_DB_QUERY_TIMEOUT_MS` | 登录/会话数据库查询超时，默认 15000 ms |
| `UPLOAD_MAX_CONCURRENCY` | 跨实例共享的同时上传数，默认 2 |
| `STORAGE_MIN_FREE_BYTES` | 接受上传后仍须保留的磁盘空间，默认 512 MiB |
| `STORAGE_ORPHAN_GRACE_MINUTES` | 崩溃遗留暂存/孤儿版本的安全回收等待时间，默认 60 分钟 |
| `STORAGE_RECOVERY_RETENTION_HOURS` | 无法自动判定的回收区数据最长保留时间，默认 168 小时 |
| `SECURITY_LOG_RETENTION_DAYS` | 含邮箱/IP 的安全日志保留期，默认 90 天 |
| `REGISTRATION_MODE` | `closed`（生产默认）关闭公开注册；明确设为 `open` 才开放 |
| `MAINTENANCE_SECRET` | 外部 cron 触发完整清理任务的 Bearer 密钥 |
| `LOG_REDACTION_SECRET` | 日志中邮箱/IP 的不可逆指纹盐；默认从认证密钥派生 |

密钥可用 `openssl rand -hex 32` 生成。不要把 `.env.local`、数据库备份或报告数据卷提交到 Git。

## 数据库迁移与启动

Node 运行时的 `instrumentation.register()` 会在接受流量前依次：

1. 执行 Better Auth 官方迁移；
2. 在 PostgreSQL advisory lock 保护下执行项目版本化迁移；
3. 验证持久化目录与五个只读游客模板；
4. 启动可重试的后台清理任务。

迁移失败会使实例启动失败，不会带着半完成 schema 接受请求。多实例可并发启动，但发布前仍应同时备份 PostgreSQL 和 `REPORTS_DATA_DIR`，并在预发环境验证迁移。

## 生产部署

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

- `REPORTS_DATA_DIR` 必须指向容器镜像/代码 checkout 之外的持久卷；缺失或指向不安全路径时实例拒绝启动。
- 反向代理应是应用的唯一入口，应用端口必须由防火墙限制为仅本机/内网代理可访问。代理覆盖（不是追加客户端传入的）`Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 与 `X-Forwarded-For`，只允许 HTTPS，把单请求体上限设为 `51 MiB`，并保留 `Content-Length`。上传缺少该头时返回 `411`，超限时在解析 multipart 前返回 `413`。
- 内容域（如 `reports.example.com`）可复用同一应用进程，但反向代理只应开放 `/r/*`；应用本身也会拒绝内容域上的其他路径和主站 origin 上的报告资源。
- readiness probe 指向 `GET /api/health`：数据库、报告卷可写且剩余空间高于保护线时返回 `200`，否则返回 `503`。
- 给进程留出 10–30 秒 `SIGTERM` 优雅退出时间，使请求和 Next.js `after()` 任务完成。
- PostgreSQL 连接上限需同时计入业务池和 Better Auth 池，再乘以实例数。
- 使用系统 cron 每 15 分钟调用一次 `POST /api/internal/maintenance`，请求头为 `Authorization: Bearer $MAINTENANCE_SECRET`。进程内调度仍作为兜底，但外部 cron 能覆盖应用重启或长时间无请求场景；`GET /api/health` 会返回最近一次完整维护时间和错误。
- OpenResty/1Panel 访问日志不得记录 `/s/*`、`/b/*`、`/r/*` 的完整 URI；将这些路径统一写成脱敏标签。应用 stdout/stderr 日志也必须配置轮换和有限保留期（建议 30 天以内），不要永久保留容器日志。

上传限制：ZIP/HTML 50 MiB，解压后单项目 100 MiB / 50 文件 / 5 层目录，单用户总量 2 GiB，站点总量硬上限 20 GiB。上传先取得 PostgreSQL 中的短租约，因此多实例也不会同时产生过多临时文件；系统临时卷和报告卷都通过剩余空间保护线后才写入。

每次创建或替换都会发布一个新的不可变文件版本，再用单条数据库更新切换 `revision + storage_key`。每条报告必须且只能具有 `template_key` 或 `storage_key` 之一，私有 artifact 必须记录正数 `size_bytes`。旧分享链接的 URL 形式不变，未被数据库引用的版本、上传临时目录、已删除账号目录和系统临时上传会在安全等待期后回收。

账号物理删除会在同一事务中删除该账号的 OTP、Better Auth 验证记录以及含邮箱/IP/浏览器信息的安全日志，再级联删除会话、令牌、分享和报告。其余过期验证码和验证记录会周期清理，安全日志按配置的保留期滚动删除。

应用无法替云厂商删除数据库快照和数据卷快照。生产备份必须另外配置有限保留期（建议 30 天或更短）、加密和到期自动删除；恢复旧备份后应立即运行应用维护任务。不要创建“永久保留”快照，否则账号删除无法覆盖备份副本。

游客登录使用一次服务端编排：匿名账号、60 分钟绝对租约和五张示例卡片全部创建成功后才下发会话 Cookie。示例报告引用代码镜像内的共享只读模板，每位游客仍有独立的报告 ID、元数据、排序和 revision；只有在替换文件时才写时复制为私有目录。退出会先销毁数据再清除 Cookie，页面/API 每次授权都校验绝对到期时间，后台每分钟兜底回收闲置会话。

## 报告网页能力

报告可以运行 HTML/CSS/JavaScript，并读取同一报告目录中的脚本、样式、JSON/CSV、图片、字体、音视频、PDF 和 Blob Worker。包内资源使用相对路径。新项目默认关闭外部网络；只有创建/编辑时明确开启后，外部 HTTPS API、CDN、图片、字体、媒体和 iframe 才可引用。关闭时浏览器 CSP 只允许当前报告包内资源，适合包含敏感数据的汇报。外部 `fetch`/模块资源仍需要目标站正确提供 CORS 响应头。

## 安全边界

- ZIP 按顺序流式解压，同时校验路径穿越、符号链接、重复文件、文件数和实际解压字节数。
- 报告使用短时 HMAC capability 访问，与内容 revision 和撤销 epoch 绑定。
- 报告由独立内容域提供，仅在不带 `allow-same-origin`/顶层导航/表单提交/设备权限的固定视口 sandbox iframe 中运行；包内资源与外部 HTTPS 网页能力可用。
- OTP 只以 HMAC 落库，核销、错误次数和一次性变更 token 均使用数据库事务。
- API token 按 SHA-256 指纹等值定位，只有失败认证才进入 PostgreSQL 共享限流。
- 分享 URL 令牌按 SHA-256 指纹查询，明文使用 AES-256-GCM 和独立派生密钥加密后存储；数据库只读泄漏不会直接暴露可访问链接。
- 新分享的 4 位提取码放在 URL fragment 中供浏览器自动解锁；fragment 不会发送给反向代理、应用服务器或下游 Referer，验证后立即从地址栏清除。已登录属主访问自己的分享时由服务端所有权校验直接放行。
- 自定义浏览器写接口统一验证 Origin/Fetch Metadata，密码登录与重新认证使用 PostgreSQL 跨实例失败限流。

CI 会对每个 PR 执行 lint、TypeScript、Vitest 和生产构建。
