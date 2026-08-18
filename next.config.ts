import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // 全站基础安全头：
        // - nosniff：阻止 MIME 嗅探
        // - SAMEORIGIN：仅允许同源 iframe（分享页内部的 /api/share 文档 iframe 依赖此规则）
        // - Referrer-Policy：跨站只泄露 origin，分享 token 不进第三方 referer
        // - HSTS：生产 https 下强制 180 天
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=15552000; includeSubDomains",
          },
        ],
      },
      {
        // 分享页禁止索引（与 robots.txt 双保险：robots 只约束守规矩的爬虫，
        // X-Robots-Tag 对收到链接的爬虫也生效）
        source: "/s/:token*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
