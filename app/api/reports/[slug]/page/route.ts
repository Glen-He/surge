import path from "path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getReportBySlug } from "@/lib/reports-db";
import {
  loadReportHtml,
  reportDocCsp,
  requestOrigin,
  signedAssetUrl,
} from "@/lib/report-pipeline";

export const dynamic = "force-dynamic";

const USERS_DIR = path.join(process.cwd(), "reports", "users");

// 登录态报告文档（iframe src）：cookie 鉴权 + 归属校验（该报告必须属于当前用户）。
// 返回完整 HTML 文档，脚本在父页的 sandbox iframe（opaque origin）内执行；
// reportDocCsp（含 sandbox allow-scripts）作为第二道防线，即使被直接
// 在新标签页打开也降级为 opaque origin，无 cookie/storage/同源权能。
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return new Response("未登录", { status: 401 });
  }

  const { slug } = await params;
  const report = await getReportBySlug(session.user.id, slug);
  if (!report) {
    return new Response("项目不存在", { status: 404 });
  }

  try {
    const html = await loadReportHtml(
      path.join(USERS_DIR, session.user.id, slug),
      slug,
      {
        // 资产 URL 带 HMAC 签名：沙箱 iframe（opaque origin）的子资源请求
        // 不携带 SameSite cookie，签名是它们通过 /api/report-assets 鉴权的凭证
        assetUrl: (p) => signedAssetUrl(p, session.user.id),
      },
    );
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
