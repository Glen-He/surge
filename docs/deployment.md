# 云服务器部署

SURGE 使用 Node.js 24+、pnpm 11.21.0 和 PostgreSQL 18。生产运行在云服务器，应用进程由服务管理器维护；数据库和报告目录使用持久化存储。基础安装步骤见 [README](../README.md)，完整变量见 [`.env.example`](../.env.example)。

## 网络入口和域名

配置两个 HTTPS origin，例如主站 `https://surge.example.com` 和内容域 `https://reports.example.net`，分别填写 `BETTER_AUTH_URL` 与 `REPORTS_ORIGIN`。内容域不得设置主站会话 Cookie；不要给认证 Cookie 设置覆盖两者的父域。两域均代理到同一应用，应用自身负责内容域隔离与 capability 校验。不要通过静态文件服务直接公开 `REPORTS_DATA_DIR`。

应用端口只监听 loopback（例如 `pnpm start --hostname 127.0.0.1 --port 3000`），或在容器私有网络中仅向反向代理开放。数据库端口同样不向公网开放。`TRUSTED_PROXIES` 只控制转发地址链的解析，不能替代防火墙或连接来源限制。

单层 Nginx / OpenResty 部署，在两个域名各自的 HTTPS `server` 中使用以下代理配置，并为其他 Host 配置拒绝请求的默认站点：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 51m;
}
```

这里覆盖客户端传入的转发头，不能直接透传伪造值。应用和 Better Auth 共用 XFF 解析规则：从右向左跳过 `TRUSTED_PROXIES` 中的可信代理，使用第一个非代理地址；无有效地址时进入共享限流桶。IPv4 映射地址统一为 IPv4，IPv6 按 /64 子网归一化。

如果前面还有 CDN / 负载均衡，必须限制源站只接受这些可信入口，并按照该服务的真实来源机制配置代理：最外层清除伪造地址，后续可信节点追加其连接来源。`TRUSTED_PROXIES` 只填写实际代理 IP / CIDR，不得填写整个互联网地址范围。配置后通过实际请求确认限流识别的是客户端，不能机械套用单层示例覆盖为 CDN 的地址。

## 日志和维护

分享 token、报告 capability、提取码以及密码重置参数均可能出现在 URL 中。应用日志脱敏不会替代理服务器脱敏；Nginx/CDN/APM 不应记录原始 URL、查询参数、Cookie、Authorization、请求体或内部认证 proof。可在 Nginx `http` 块定义仅记录方法、状态和耗时的日志格式：

```nginx
log_format surge_safe '$request_method $status $body_bytes_sent $request_time';
access_log /var/log/nginx/surge-access.log surge_safe;
```

同时检查错误日志和上游观测平台的采集配置，避免原始请求被另一路日志收集。数据库中的安全审计记录按 `SECURITY_LOG_RETENTION_DAYS` 清理，需限制访问并保护备份。

应用启动后会自动运行维护调度器。需要从服务器定时任务主动触发时，可向 `POST /api/internal/maintenance` 发送请求，在 `Authorization: Bearer` 中提供 `MAINTENANCE_SECRET`。凭证由受限配置文件或服务管理器注入，不能写进 URL 或公开日志。该任务清理过期安全数据、游客账号和存储遗留内容；多实例共用数据库锁协调执行，不使用 GitHub Actions。

`GET /api/health` 可用于健康探测，只公开整体状态和最近维护成功时间。失败或长期未成功的维护任务会使健康检查返回 503；详细原因在服务端日志中排查。首次部署需等待启动维护任务成功后再确认健康状态。

## 升级与验证

升级前备份 PostgreSQL、报告数据和加密密钥。分享与邀请码密文依赖对应密钥，不能只恢复数据库而丢弃密钥。迁移由应用的数据库初始化流程执行，部署新版本时检查迁移和健康日志。

本地验证使用独立临时数据库、临时报告目录和测试密钥，不连接生产数据，也不把 `reports_local/` 当作运行目录。按改动运行 lint、`pnpm typecheck`、单元测试；结构变化还需运行 `pnpm check:imports` 与 `pnpm check:architecture`。数据库变更运行集成测试，最终验证生产构建；涉及交互时再运行浏览器测试，结束后关闭临时服务并清理数据。
