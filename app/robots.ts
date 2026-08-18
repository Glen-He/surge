import type { MetadataRoute } from "next";

// /api/ 是接口面；/s/ 是分享落地页（token 属私有内容，不应进索引）
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/api/", "/s/"] }],
  };
}
