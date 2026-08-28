import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // proxy.ts 会克隆请求体，Next.js 默认只保留前 10MB。上传接口允许
    // 50MB 文件，因此为 multipart 边界和元数据额外预留 1MB。
    proxyClientMaxBodySize: "51mb",
  },
  // unzipper contains optional adapters (including S3) behind runtime require().
  // Keep it as a native Node dependency so Turbopack does not resolve unused
  // optional adapters into the application bundle.
  serverExternalPackages: ["unzipper"],
  async headers() {
    return [
      {
        // 全站基础安全头：
        // - nosniff：阻止 MIME 嗅探
        // - Referrer-Policy：跨站只泄露 origin，分享 token 不进第三方 referer
        // - HSTS：生产 https 下强制 180 天
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
          {
            key: "Strict-Transport-Security",
            value: "max-age=15552000; includeSubDomains",
          },
        ],
      },
      {
        // 主站页面仅允许同源嵌入。必须排除 /r/*：next.config headers 的优先级
        // 高于 Route Handler 响应头，否则会覆盖报告路由精确的 frame-ancestors
        // 与 capability 资源 CSP，导致独立内容域 iframe 被浏览器拦截。
        source: "/((?!r/).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      {
        // 分享页禁止索引（与 robots.txt 双保险：robots 只约束守规矩的爬虫，
        // X-Robots-Tag 对收到链接的爬虫也生效）
        source: "/s/:token*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // Capability URLs are bearer credentials and must not be indexed or
        // leak through a Referer header. Route handlers repeat these headers
        // so the invariant also holds outside this Next.js config.
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
