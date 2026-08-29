import type { MetadataRoute } from "next";

// API, share links and report capability URLs must never enter an index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/api/", "/s/", "/b/", "/r/"] }],
  };
}
