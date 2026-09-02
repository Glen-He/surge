import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 压缩由前置 OpenResty 统一负责（Brotli 优先、Gzip fallback）。
  // Next.js 自身只支持 gzip，若在此压缩，OpenResty 收到已编码响应就无法再
  // 转成 Brotli，导致 SSR HTML 拿不到 br（实测首页 gzip 4118B vs br 3328B）。
  compress: false,

  experimental: {
    // proxy.ts 会克隆请求体，Next.js 默认只保留前 10MB。上传接口允许
    // 50MB 文件，因此为 multipart 边界和元数据额外预留 1MB。
    proxyClientMaxBodySize: "51mb",
  },
  // unzipper 在运行时 require() 之后藏着可选适配器（含 S3）。
  // 保留为原生 Node 依赖，避免 Turbopack 把未使用的可选适配器
  // 解析进应用 bundle。
  serverExternalPackages: ["unzipper"],
  async headers() {
    return [
      {
        // 全站基础安全头：
        // - nosniff：阻止 MIME 嗅探
        // - Referrer-Policy：跨站只泄露 origin，分享 token 不进第三方 referer
        // HSTS 由 proxy.ts 仅在当前配置 origin 确实为 HTTPS 时注入，
        // 不能在这里无条件下发，否则 Safari 会把本地 HTTP 资源升级为 HTTPS。
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // 分享页禁止索引（与 robots.txt 双保险：robots 只约束守规矩的爬虫，
        // X-Robots-Tag 对收到链接的爬虫也生效）
        source: "/s/:token*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // 分享面板及面板内报告同样是持有链接才可访问的内容。
        source: "/b/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // capability URL 属于持有即凭证（bearer credential），禁止被索引，
        // 也不能经 Referer 头泄露。路由处理器会重复这些头，
        // 保证该不变量在本 Next.js 配置之外同样成立。
        source: "/r/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
