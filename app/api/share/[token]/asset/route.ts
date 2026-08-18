import { promises as fs } from "fs";
import path from "path";
import { findValidShare, unlockProof } from "@/lib/shares";

export const dynamic = "force-dynamic";

const USERS_DIR = path.join(process.cwd(), "reports", "users");
const SHARED_DIR = path.join(process.cwd(), "reports", "_shared");

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function extOf(p: string) {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(req.url);
  const p = url.searchParams.get("p");
  if (!p) return new Response("missing p", { status: 400 });

  const found = await findValidShare(token);
  if (!found) return new Response("链接无效或已失效", { status: 404 });

  // 与文档端点同一道密码门槛：资产不能成为绕过入口
  if (found.share.password_hash) {
    const cookie = req.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`share_${token}=`));
    const proof = cookie?.slice(`share_${token}=`.length);
    if (proof !== unlockProof(token)) {
      return new Response("需要密码", { status: 401 });
    }
  }

  // 防目录穿越（与 report-assets 相同策略）
  const clean = path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, "");
  if (clean.includes("..") || path.isAbsolute(clean)) {
    return new Response("forbidden", { status: 403 });
  }

  // 文件定位：分享 token → 报告属主目录（token 决定可达范围，
  // p 只允许落在本报告目录或 _shared 公共目录内）
  const reportSlug = found.ownerDir.split("/")[1];
  let filePath: string;
  const allowedRoots: string[] = [];
  if (clean.startsWith("_shared/")) {
    filePath = path.join(SHARED_DIR, clean.slice("_shared/".length));
    allowedRoots.push(path.resolve(SHARED_DIR));
  } else {
    // 相对引用已在管线里带上 "<slug>/" 前缀；不接受任何其他前缀
    // （尤其不允许 "../" 跳到属主的其他报告目录）
    if (!clean.startsWith(`${reportSlug}/`)) {
      return new Response("forbidden", { status: 403 });
    }
    filePath = path.join(USERS_DIR, found.ownerId, clean);
    allowedRoots.push(path.resolve(path.join(USERS_DIR, found.ownerId)));
  }
  if (!allowedRoots.some((root) => filePath.startsWith(root))) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    let content = await fs.readFile(filePath);
    const ext = extOf(filePath);

    // CSS 内部相对引用改写（与 report-assets 一致）：
    // 相对路径以样式表自身 URL 解析会脱离资产端点，统一改写为代理绝对路径
    if (ext === ".css") {
      const dir = path.posix.dirname(clean);
      const toProxy = (rawRef: string) => {
        const ref = rawRef.split("?")[0].split("#")[0];
        if (!ref) return null;
        if (
          ref.startsWith("/") ||
          /^https?:/i.test(ref) ||
          rawRef.startsWith("data:")
        ) {
          return null;
        }
        const resolved = path.posix.normalize(path.posix.join(dir, ref));
        if (resolved.startsWith("..") || resolved.startsWith("/")) return null;
        return `/api/share/${token}/asset?p=${encodeURIComponent(resolved)}`;
      };
      const css = content
        .toString("utf-8")
        .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, ref: string) => {
          const proxied = toProxy(ref);
          return proxied ? `url("${proxied}")` : m;
        })
        .replace(/@import\s+(['"])([^'"]+)\1/g, (m, _q, ref: string) => {
          const proxied = toProxy(ref);
          return proxied ? `@import "${proxied}"` : m;
        });
      content = Buffer.from(css, "utf-8");
    }

    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      // 短缓存：撤销 / 到期后最迟 60s 失效
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    };
    // 可导航类型防同源脚本执行（纵深防御，同 report-assets）
    if (ext === ".svg") {
      headers["Content-Security-Policy"] =
        "default-src 'none'; style-src 'unsafe-inline'";
    } else if (ext === ".html") {
      headers["Content-Security-Policy"] = "sandbox";
    }

    return new Response(content, { headers });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
