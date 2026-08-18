import { promises as fs } from "fs";
import path from "path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { signedAssetUrl, verifyAssetSig } from "@/lib/report-pipeline";

export const dynamic = "force-dynamic";

const USERS_DIR = path.join(process.cwd(), "reports", "users");
const SHARED_DIR = path.join(process.cwd(), "reports", "_shared");

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
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
};

function extOf(p: string) {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("p");
  if (!p) return new Response("missing p", { status: 400 });

  // 鉴权（双通道）：
  // 1) 会话 cookie —— 常规同源上下文；
  // 2) HMAC 签名（u/e/t）—— 沙箱 iframe（opaque origin）内的子资源请求
  //    不携带 SameSite=Lax cookie，必须依赖报告页签发的短期签名。
  const session = await auth.api.getSession({ headers: await headers() });

  const sigU = url.searchParams.get("u");
  const sigE = Number(url.searchParams.get("e"));
  const sigT = url.searchParams.get("t");
  const sigValid =
    !session && sigU !== null && sigT !== null
      ? verifyAssetSig(p, sigU, sigE, sigT)
      : false;

  const ownerId = session?.user.id ?? (sigValid ? sigU : null);
  if (!ownerId) return new Response("unauthorized", { status: 401 });

  // 防目录穿越
  const clean = path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, "");
  if (clean.includes("..") || path.isAbsolute(clean)) {
    return new Response("forbidden", { status: 403 });
  }

  let filePath: string;
  if (clean.startsWith("_shared/")) {
    // 公共资源（echarts 等）
    filePath = path.join(SHARED_DIR, clean.slice("_shared/".length));
  } else {
    // 用户私有资源：reports/users/<ownerId>/<rest>
    filePath = path.join(USERS_DIR, ownerId, clean);
  }

  // 防目录穿越（二次确认）
  if (!filePath.startsWith(path.resolve(SHARED_DIR)) && !filePath.startsWith(path.resolve(path.join(USERS_DIR, ownerId)))) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    let content = await fs.readFile(filePath);
    const ext = extOf(filePath);

    // CSS 内的相对引用按样式表自身 URL 解析，脱离报告页后会指错位置；
    // 输出前把 url(...) / @import 改写为携带同目录前缀的代理绝对路径，
    // 让包内样式表引用的图片 / 字体 / 子样式表都能正确走代理。
    if (ext === ".css") {
      const dir = path.posix.dirname(clean); // 如 "r_x" 或 "_shared"
      const toProxy = (rawRef: string) => {
        // 剥掉查询串 / 锚点（图标字体常见 font.woff2?v=4#iefix）
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
        // CSS 内嵌引用继续走代理；有属主上下文时带签名（沙箱内无 cookie）
        return signedAssetUrl(resolved, ownerId);
      };
      const css = content.toString("utf-8")
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

    // 可导航类型防同源脚本执行：
    // .svg / .html 被浏览器直接打开时，内部 <script> 会以站点同源身份运行。
    // - .svg：允许内联样式正常渲染，禁掉脚本与外链
    // - .html：sandbox 让文档运行在无源沙箱，脚本完全失效
    // 作为子资源（<img>、<iframe> 之外）嵌入时不受影响。
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };
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
