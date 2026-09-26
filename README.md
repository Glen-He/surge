# SURGE 工作汇报系统

SURGE 是自托管的工作汇报平台：用户可上传单个 HTML 或包含 `report.html` 的 ZIP，管理元数据，并生成可设密码和过期时间的只读分享链接。

## 环境要求

- Node.js 24+ / pnpm 11.21+

- PostgreSQL 18

- 代码目录之外的持久化报告数据卷

## 本地开发

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

在环境变量中至少配置 `DATABASE_URL`、`BETTER_AUTH_SECRET`、`API_TOKEN_ENCRYPTION_KEY`、`INVITE_CODE_SECRET`、`SHARE_SECRET`、`SHARE_TOKEN_ENCRYPTION_KEY` 和 `REPORTS_DATA_DIR`。报告数据目录在所有环境都必须显式指定，并使用当前 checkout 之外的专用目录。所有变量的唯一契约见 `src/infrastructure/environment/schema.ts`（新增变量必须先在此注册，`pnpm env:check` 会校验 `.env.local` 与 `.env.example` 的同步）。

```bash
pnpm lint
pnpm typecheck
pnpm test:unit          # 单元测试（不需要数据库）
pnpm test:integration   # PostgreSQL 集成测试（需要 DATABASE_URL）
pnpm build
pnpm verify             # 一次执行全部本地检查（不含 e2e）
```

集成测试、生产构建和浏览器验证须使用临时 PostgreSQL 数据库与临时报告目录。单元及集成测试可通过 `SURGE_TEST_REPORTS_DATA_DIR` 指定隔离目录；浏览器测试使用 `E2E_REPORTS_DATA_DIR`，在生产构建后手动运行 `pnpm test:e2e`。验证后清理临时数据，不使用或删除 `reports_local/`。只有需要浏览器交互验收时才临时启动 `pnpm dev`，验收结束立即关闭；项目长期运行环境仅为云服务器。

## 配置

完整示例见 [`.env.example`](./.env.example)。生产环境的关键项：

| 变量                                 | 用途                                             |
| ---------------------------------- | ---------------------------------------------- |
| `DATABASE_URL`                     | PostgreSQL 连接串                                 |
| `BETTER_AUTH_SECRET`               | 会话与内部密钥派生的高熵根密钥                                |
| `API_TOKEN_ENCRYPTION_KEY`         | API 令牌回显所用的独立加密根密钥（至少 32 字符，必须持久保存）            |
| `INVITE_CODE_SECRET`               | 邀请码 HMAC 查询与 AES-GCM 加密的独立根密钥（至少 32 字符，必须持久保存） |
| `BETTER_AUTH_URL`                  | 对外的 HTTPS 站点地址                                 |
| `REPORTS_ORIGIN`                   | 独立、无 Cookie 的 HTTPS 汇报内容域，生产必填且主机名必须不同于主站      |
| `REPORTS_DATA_DIR`                 | checkout 之外的持久化报告目录，所有环境必填                     |
| `SHARE_SECRET`                     | 分享解锁凭证的独立签名密钥（所有环境必填，至少 32 字符）                 |
| `SHARE_TOKEN_ENCRYPTION_KEY`       | 分享 URL 令牌和 4 位提取码的独立加密根密钥（至少 32 字符，必须持久保存）     |
| `OTP_SECRET`                       | OTP HMAC 密钥；不设时从 `BETTER_AUTH_SECRET` 派生       |
| `TRUSTED_PROXIES`                  | 允许提供真实客户端 IP 的反向代理 IP/CIDR                     |
| `DB_QUERY_TIMEOUT_MS`              | 业务数据库查询超时，默认 15000 ms                          |
| `AUTH_DB_QUERY_TIMEOUT_MS`         | 登录/会话数据库查询超时，默认 15000 ms                       |
| `UPLOAD_MAX_CONCURRENCY`           | 跨实例共享的同时上传数，默认 2                               |
| `STORAGE_MIN_FREE_BYTES`           | 接受上传后仍须保留的磁盘空间，默认 512 MiB                      |
| `STORAGE_ORPHAN_GRACE_MINUTES`     | 崩溃遗留暂存/孤儿版本的安全回收等待时间，默认 60 分钟                  |
| `STORAGE_RECOVERY_RETENTION_HOURS` | 无法自动判定的回收区数据最长保留时间，默认 168 小时                   |
| `SECURITY_LOG_RETENTION_DAYS`      | 含邮箱/IP 的安全日志保留期，默认 90 天                        |
| `MAINTENANCE_SECRET`               | 外部 cron 触发完整清理任务的 Bearer 密钥                    |
| `LOG_REDACTION_SECRET`             | 日志中邮箱/IP 的不可逆指纹盐；默认从认证密钥派生                     |

密钥可用 `openssl rand -hex 32` 生成。不要把 `.env.local`、数据库备份或报告数据卷提交到 Git。

首次启用管理员功能时，先正常启动一次让 Better Auth 和项目迁移完成，再在部署环境执行 `pnpm admin:grant <管理员邮箱>`。管理员角色存储在数据库中，不绑定种子账号环境变量；注册开关和邀请码强制策略在“管理员后台”即时生效，普通用户由服务端权限校验拒绝访问。每个正式用户只有一个专属邀请码，可在“用户中心 → 邀请注册”中查看、复制邀请链接、更换或撤销；邀请码永久有效且不限制使用次数，实际邀请次数会持续记录。邀请链接使用 fragment 自动填写并锁定邀请码输入框；`INVITE_CODE_SECRET` 丢失后现有邀请码将无法回显或验证。

每个正式用户同时只能有一个有效 API 令牌。账户页可随时显示和复制令牌；认证仍通过不可逆 lookup 定位，明文只以 `API_TOKEN_ENCRYPTION_KEY` 派生的 AES-GCM 密钥加密保存。更换或撤销会立即使旧值失效。丢失或更换该加密根密钥后，现有令牌必须重新生成。

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

- 内容域（如 `reports.example.com`）可复用同一应用进程，但反向代理只应开放 `/report/*` 与 `/platform/*`（平台内置公共库的版本化 URL）；应用本身也会拒绝内容域上的其他路径和主站 origin 上的报告资源。

- readiness probe 指向 `GET /api/health`：数据库、报告卷可写且剩余空间高于保护线时返回 `200`，否则返回 `503`。

- 给进程留出 10–30 秒 `SIGTERM` 优雅退出时间，使请求和 Next.js `after()` 任务完成。

- PostgreSQL 连接上限需同时计入业务池和 Better Auth 池，再乘以实例数。

- 使用系统 cron 每 15 分钟调用一次 `POST /api/internal/maintenance`，请求头为 `Authorization: Bearer $MAINTENANCE_SECRET`。进程内调度仍作为兜底，但外部 cron 能覆盖应用重启或长时间无请求场景；`GET /api/health` 会返回最近一次完整维护时间和错误。

- OpenResty/1Panel 访问日志不得记录 `/share/*`、`/board/*`、`/report/*` 的完整 URI；将这些路径统一写成脱敏标签。应用 stdout/stderr 日志也必须配置轮换和有限保留期（建议 30 天以内），不要永久保留容器日志。

上传限制：ZIP/HTML 50 MiB，解压后单项目 100 MiB / 50 文件 / 5 层目录，单用户总量 2 GiB，站点总量硬上限 20 GiB。上传先取得 PostgreSQL 中的短租约，因此多实例也不会同时产生过多临时文件；系统临时卷和报告卷都通过剩余空间保护线后才写入。

每次创建或替换都会发布一个新的不可变文件版本，再用单条数据库更新切换 `revision + storage_key`。每条报告必须且只能具有 `template_key` 或 `storage_key` 之一，私有 artifact 必须记录正数 `size_bytes`。未被数据库引用的版本、上传临时目录、已删除账号目录和系统临时上传会在安全等待期后回收。

账号物理删除会在同一事务中删除该账号的 OTP、Better Auth 验证记录以及含邮箱/IP/浏览器信息的安全日志，再级联删除会话、令牌、分享和报告。其余过期验证码和验证记录会周期清理，安全日志按配置的保留期滚动删除。

应用无法替云厂商删除数据库快照和数据卷快照。生产备份必须另外配置有限保留期（建议 30 天或更短）、加密和到期自动删除；恢复旧备份后应立即运行应用维护任务。不要创建“永久保留”快照，否则账号删除无法覆盖备份副本。

游客登录使用一次服务端编排：匿名账号、60 分钟绝对租约和五张示例卡片全部创建成功后才下发会话 Cookie。示例报告引用代码镜像内的共享只读模板，每位游客仍有独立的报告 ID、元数据、排序和 revision；只有在替换文件时才写时复制为私有目录。退出会先销毁数据再清除 Cookie，页面/API 每次授权都校验绝对到期时间，后台每分钟兜底回收闲置会话。

## 展示模式与访问路径

上传和编辑项目时可选择“汇报展示”（`frame`，默认）或“网页发布”（`bare`）。存量报告由迁移保留为 `frame`。网页发布保留上传 HTML 原文，不剥离网页自身头部、不注入平台菜单、PDF 桥接或滚动条样式；在全屏隔离 iframe 中展示，平台列表通过新标签页打开，并带 `noopener noreferrer`。汇报展示保持原有系统头与操作方式。

- 登录查看：`/view/[slug]`；分享管理：`/account/shared`。
- 分享落地页：`/share/[token]`；面板：`/board/[token]`；面板汇报内页：`/board/[token]/item/[itemId]`。
- 面板网页链接：`/share/[token]?item=[itemId]`，其中 token 属于面板。沿用面板密码、有效期、停用和成员关系校验，不额外创建独立分享；面板解锁 Cookie 在主站 `/` 下使用，证明仍绑定该面板 token 和访问纪元。
- 内容域资源：`/report/[cap]/[...path]`，仍使用 capability、sandbox 和 CSP 隔离。

面板条目 `itemId` 固定为 4 位小写字母或数字，只在同一个面板内唯一。数据库通过 `(board_id, id)` 联合主键保证唯一性，创建时碰撞会重新生成；不同面板允许使用相同短码。迁移会直接替换存量条目的 32 位标识，旧条目链接失效，不保留兼容或重定向。短码仅用于定位，访问仍必须通过面板 token、密码及有效期等校验，内容资源仍由 capability 授权。

分享与面板 token 统一为 8 位小写字母或数字。旧路径不保留且不重定向，旧 22 位 token 无效；已有分享需重新创建，面板可更换链接。发布时须同步调整反向代理内容域路径和访问日志脱敏配置。

网页发布与汇报展示使用相同的上传结构校验、容量配额、分享权限及删除流程。上传 API 的 `displayMode` 字段接受 `frame` / `bare`：新建省略时默认 `frame`，更新省略时保留现有模式；显式非法值返回 400。模式更改会使先前签发的 capability 失效。

## 报告网页能力

报告可以运行 HTML/CSS/JavaScript，并读取同一报告目录中的脚本、样式、JSON/CSV、图片、字体、音视频、PDF 和 Blob Worker。包内资源使用相对路径；平台内置公共库（如 ECharts）直接引用 `/platform/<文件名>` 版本化 URL（登记于 `reports/_shared/platform-manifest.json`，manifest、磁盘文件名与 URL 三者一致，构建期强制校验内容 hash）。浏览器 CSP 允许当前报告 capability 目录内的资源与 `/platform/` 前缀，外部 API、CDN、图片、字体、媒体和 iframe 均不可加载；用户明确点击的 HTTPS 外链仍可在隔离的新标签页中打开。报告 HTML 的制作与脚本加载规范见 `reports_local/README.md`。

## 安全边界

- ZIP 按顺序流式解压，同时校验路径穿越、符号链接、重复文件、文件数和实际解压字节数。

- 报告使用短时 HMAC capability 访问，与内容 revision 和撤销 epoch 绑定。

- 报告由独立内容域提供，仅在不带 `allow-same-origin`/顶层导航/表单提交/设备权限的固定视口 sandbox iframe 中运行；只允许加载包内资源，用户触发的新标签页外链仍可用。

- OTP 只以 HMAC 落库，核销、错误次数和一次性变更 token 均使用数据库事务。

- API token 按 SHA-256 指纹等值定位，只有失败认证才进入 PostgreSQL 共享限流。

- 分享 URL 令牌按 SHA-256 指纹查询，明文使用 AES-256-GCM 和独立派生密钥加密后存储；数据库只读泄漏不会直接暴露可访问链接。

- 新分享的 4 位提取码放在 URL fragment 中供浏览器自动解锁；fragment 不会发送给反向代理、应用服务器或下游 Referer，验证后立即从地址栏清除。已登录属主访问自己的分享时由服务端所有权校验直接放行。

- 自定义浏览器写接口统一验证 Origin/Fetch Metadata，密码登录与重新认证使用 PostgreSQL 跨实例失败限流。

所有 lint、类型检查、测试和构建均由开发者在本地手动运行；项目不配置 GitHub Actions 工作流或自动依赖更新。


## 平台颜色约定

`src/shared/ui/design-system.css` 是平台 UI 的颜色来源。新界面先判断元素用途，再引用对应变量，不在页面中新增近似色值：

- **背景**：页面用 `--page-bg`，卡片和弹窗用 `--surface`，内嵌内容用 `--surface-sunken`；浅色控件与悬停分别用 `--control-bg`、`--control-hover`。
- **文字与图标**：标题、正文用 `--text-primary`，说明、日期、占位提示用 `--text-secondary`；`--icon-muted` 仅用于图标，`--text-disabled` 仅用于不可用内容，实色按钮文字用 `--text-on-fill`。
- **边框**：卡片轻边缘用 `--border-subtle`，普通容器用 `--border`，输入控件用 `--border-control`，悬停用 `--border-hover`。不新增分割线。
- **操作与状态**：蓝色 `--accent-*` 表示操作、链接、选中和焦点；绿色 `--success-*` 表示成功，橙色 `--warning-*` 表示提醒，红色 `--danger-*` 表示错误与危险操作。状态实色用于图标或填充，`*-text` 用于文字，`*-soft` 用于浅色背景，不用警示色作普通装饰。

复制成功的绿色及认证自动填充的浅蓝保留既定色值。报告系统头通过现有桥接取得父页颜色，仅作用于自身 Shadow DOM，不向上传网页正文注入主题。项目分类色板由 `src/features/reports/tag-colors.ts` 独立管理；汇报正文遵循 `reports_local/README.md`。根错误页必须在全局样式失效时仍可读，邮件必须兼容邮件客户端，两者使用与上述角色一致的内联色值。阴影与遮罩表示空间和遮挡关系，不参与内容背景的灰阶合并。
