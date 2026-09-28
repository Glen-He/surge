# SURGE

**自托管的工作汇报与网页发布平台。** 把 HTML 汇报集中管理，按项目整理，并通过分享链接或分享面板安全地发布给他人。

SURGE 适合需要展示工作进展、分析结果或交互式网页内容的团队。报告文件保存在你自己的服务器上；你可以选择带平台导航的汇报展示，也可以直接发布不带平台外壳的网页。

## 功能

- **集中管理报告**：按日期、项目标签和关键词整理内容，支持更新、搜索和排序。
- **两种展示模式**：汇报展示保留平台界面；网页发布以全屏方式展示网页本身。
- **灵活分享**：为报告创建多个分享链接，设置访问密码和有效期，查看访问次数，并随时停用、撤销或更换链接。
- **分享面板**：把多份报告组合到同一个面板链接中，集中管理访问设置和面板内容。
- **程序化上传**：使用个人 API 令牌，通过 HTTP API 上传报告或更新现有内容。
- **账号与访问管理**：支持邮箱验证、邀请注册、管理员注册策略，以及限时游客体验。

## 报告格式

上传单个 HTML 文件，或上传包含根目录入口文件 `report.html` 的 ZIP。需要的图片、样式表、脚本和其他资源应一并放入 ZIP，并使用报告能够访问的相对路径。

```text
report.html
assets/
├── style.css
└── chart.js
```

当前限制：单次上传不超过 50 MiB；ZIP 解压后单份报告不超过 100 MiB、50 个文件和 5 层目录；单个账号的报告存储上限为 2 GiB。

## 自托管部署

项目当前使用 Node.js 24+、pnpm 11.21 和 PostgreSQL 18。生产环境还需要可发送邮件的 SMTP 服务、HTTPS 反向代理，以及应用目录之外的持久化报告存储卷。

```bash
git clone https://github.com/Glen-He/surge.git
cd surge
corepack enable
pnpm install --frozen-lockfile
```

根据 [`.env.example`](./.env.example) 配置应用环境变量。生产环境建议由进程管理器或容器平台注入配置；本地开发可复制为 `.env.local`。首次启动会初始化并迁移数据库。

```bash
pnpm build
pnpm start
```

部署时请注意：

- `DATABASE_URL` 指向 PostgreSQL 数据库；发布升级前应备份数据库和报告存储卷。
- `REPORTS_DATA_DIR` 必须指向应用代码目录之外的可写持久化目录。容器部署时，将其挂载到持久卷。
- `BETTER_AUTH_URL` 设置为用户访问的 HTTPS 主站地址。生产环境还应将 `REPORTS_ORIGIN` 配置为独立的 HTTPS 报告内容域，并通过反向代理转发到应用。
- 生产环境需要配置 `SMTP_HOST`、`SMTP_USER` 和 `SMTP_PASS`，用于发送邮箱验证码等邮件。
- `BETTER_AUTH_SECRET`、`INVITE_CODE_SECRET`、`SHARE_SECRET`、`SHARE_TOKEN_ENCRYPTION_KEY` 和 `API_TOKEN_ENCRYPTION_KEY` 都是至少 32 字符的密钥。可用 `openssl rand -hex 32` 生成；请分别生成并安全保存。更换或丢失这些密钥可能使现有会话、邀请码、API 令牌或分享凭证失效。
- 生产环境配置 `MAINTENANCE_SECRET`，并建议每 15 分钟调用一次 `POST /api/internal/maintenance`，请求头使用 `Authorization: Bearer <MAINTENANCE_SECRET>`。

所有环境变量的说明和示例值见 [`.env.example`](./.env.example)。不要将密钥、数据库备份或报告数据目录提交到版本库。

生产反向代理、独立内容域和维护任务配置见 [部署指南](./docs/deployment.md)。

## 上传 API

在账号设置中创建 API 令牌，并通过 `Authorization: Bearer` 请求头认证。`POST /api/v1/reports` 接受 `multipart/form-data`；必填字段为 `title`、`date` 和 `file`，其中 `file` 可以是 HTML 或 ZIP。可选的 `displayMode` 接受 `frame`（汇报展示）或 `bare`（网页发布）。

```bash
curl -X POST "https://your-surge.example/api/v1/reports" \
  -H "Authorization: Bearer sgk_your_api_token" \
  -F "title=项目周报" \
  -F "date=2026-09-27" \
  -F "displayMode=frame" \
  -F "file=@./report.html;type=text/html"
```

成功响应包含新报告的 `slug`。使用 `PATCH /api/v1/reports/{slug}` 更新报告文件或元信息；省略 `file` 时只更新元信息。API 上传与网页上传遵循相同的权限、配额和文件校验规则。

## 本地开发

本地开发需要 PostgreSQL 和配置好的环境变量；`REPORTS_DATA_DIR` 应使用仓库目录之外的临时或专用目录。

```bash
pnpm dev
```

常用检查命令：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
```

PostgreSQL 集成测试请使用隔离的测试数据库，可运行 `pnpm test:integration`。更多仓库开发约定见 [`AGENTS.md`](./AGENTS.md)。

## 许可

SURGE 自有代码和文档采用 MIT License，详见 [`LICENSE`](./LICENSE)。仓库中单独标注的第三方组件继续遵循各自许可；例如内置 ECharts 带有 Apache License 2.0 声明。
