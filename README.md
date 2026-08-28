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

在 `.env.local` 中至少配置 `DATABASE_URL` 和 `BETTER_AUTH_SECRET`。本地未设置 `REPORTS_DATA_DIR` 时，为兼容旧数据使用 `reports/users`；此默认值不允许用于生产。

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
| `REPORTS_DATA_DIR` | 代码/镜像目录之外的持久卷，生产必填 |
| `SHARE_SECRET` | 分享解锁凭证的独立签名密钥（生产必填） |
| `OTP_SECRET` | OTP HMAC 密钥；不设时从 `BETTER_AUTH_SECRET` 派生 |
| `TRUSTED_PROXIES` | 允许提供真实客户端 IP 的反向代理 IP/CIDR |

密钥可用 `openssl rand -hex 32` 生成。不要把 `.env.local`、数据库备份或报告数据卷提交到 Git。

## 数据库迁移与启动

Node 运行时的 `instrumentation.register()` 会在接受流量前依次：

1. 执行 Better Auth 官方迁移；
2. 在 PostgreSQL advisory lock 保护下执行项目版本化迁移；
3. 验证持久化目录并执行可重试的清理/回填任务。

迁移失败会使实例启动失败，不会带着半完成 schema 接受请求。多实例可并发启动，但发布前仍应同时备份 PostgreSQL 和 `REPORTS_DATA_DIR`，并在预发环境验证迁移。

## 生产部署

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

- `REPORTS_DATA_DIR` 必须指向容器镜像/代码 checkout 之外的持久卷；生产启动会拒绝不安全路径。
- 反向代理应是应用的唯一入口，覆盖（不是追加客户端传入的）`X-Forwarded-For`，只允许 HTTPS，把单请求体上限设为 `51 MiB`，并保留 `Content-Length`。上传缺少该头时返回 `411`，超限时在解析 multipart 前返回 `413`。
- readiness probe 指向 `GET /api/health`：数据库可达时返回 `200`，否则返回 `503`。
- 给进程留出 10–30 秒 `SIGTERM` 优雅退出时间，使请求和 Next.js `after()` 任务完成。
- PostgreSQL 连接上限需同时计入业务池和 Better Auth 池，再乘以实例数。

上传限制：ZIP/HTML 50 MiB，解压后单项目 100 MiB / 50 文件 / 5 层目录，单用户总量 2 GiB，站点总量硬上限 20 GiB。文件流式落盘和解压，只在最终配额确认和原子转正时使用 PostgreSQL advisory lock。

## 安全边界

- ZIP 按顺序流式解压，同时校验路径穿越、符号链接、重复文件、文件数和实际解压字节数。
- 报告使用短时 HMAC capability 访问，与内容 revision 和撤销 epoch 绑定。
- 报告 HTML 仅在不带 `allow-same-origin` 的 sandbox iframe 中运行，并有独立 CSP 禁止网络外发。
- OTP 只以 HMAC 落库，核销、错误次数和一次性变更 token 均使用数据库事务。
- API token 按 SHA-256 指纹等值定位，只有失败认证才进入 PostgreSQL 共享限流。

CI 会对每个 PR 执行 lint、TypeScript、Vitest 和生产构建。
