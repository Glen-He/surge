import type { MetadataRoute } from "next";

// API、分享链接和汇报 capability URL 一律禁止被搜索引擎收录。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/api/", "/s/", "/b/", "/r/"] }],
  };
}
