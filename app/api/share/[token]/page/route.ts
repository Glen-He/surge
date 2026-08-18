import path from "path";
import { findValidShare, incrementShareView, shouldCountView } from "@/lib/shares";
import { loadReportHtml, reportDocCsp, requestOrigin } from "@/lib/report-pipeline";

export const dynamic = "force-dynamic";

const USERS_DIR = path.join(process.cwd(), "reports", "users");

// 分享页文档（iframe src）：无登录态，token 即凭证。
// 返回完整 HTML 文档，脚本在父页的 sandbox iframe（opaque origin）内执行；
// reportDocCsp（含 sandbox allow-scripts）作为第二道防线。
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const found = await findValidShare(token);
  if (!found) {
    return new Response("链接无效或已失效", { status: 404 });
  }

  // 有密码：必须携带正确解锁 cookie（HMAC 值，不可伪造）
  if (found.share.password_hash) {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const proof = jar.get(`share_${token}`)?.value;
    const { unlockProof } = await import("@/lib/shares");
    if (proof !== unlockProof(token)) {
      return new Response("需要密码", { status: 401 });
    }
  }

  try {
    const slug = found.ownerDir.split("/")[1];
    const html = await loadReportHtml(path.join(USERS_DIR, found.ownerDir), slug, {
      assetUrl: (p) => `/api/share/${token}/asset?p=${encodeURIComponent(p)}`,
    });
    // 只统计真实文档加载（密码通过后）；同 IP 同 token 1 小时内只计 1 次（防刷）
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (shouldCountView(token, ip)) void incrementShareView(token);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": reportDocCsp(requestOrigin(req)),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("报告内容缺失", { status: 404 });
  }
}
