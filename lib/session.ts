import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { expireGuestIfNeeded } from "@/lib/guest-sandbox";
import { logger } from "@/lib/logger";

/**
 * 服务端页面统一鉴权（DAL 层，Next.js 官方认证指南推荐的集中 session 校验）：
 * - 无会话 → 跳登录页
 * - 访客沙箱已到期 → 销毁沙箱并带「访客体验已结束」提示跳回
 *
 * 弹回时记录 cookie 名诊断日志：区分「请求根本没带 cookie」（浏览器侧
 * cookie 传播/时序问题）与「带了 cookie 但服务端判无效」（session 失效、
 * secret 轮换、代理改写等），只记录 cookie 名，绝不打印值。
 *
 * 注意：仅供页面/RSC 使用（redirect 对 API 路由无意义）；
 * API 路由请自行 `auth.api.getSession` 判空后返回 401。
 */
export async function requireSession() {
  const hs = await headers();
  const session = await auth.api.getSession({ headers: hs });

  if (session && (await expireGuestIfNeeded(session))) {
    redirect("/?guestExpired=1");
  }
  if (!session) {
    const cookieHeader = hs.get("cookie") ?? "";
    const names = cookieHeader
      .split(";")
      .map((c) => c.split("=")[0].trim())
      .filter(Boolean);
    logger.warn("auth", "bounce to / : session null", {
      cookieHeader: names.length > 0 ? `PRESENT [${names.join(",")}]` : "ABSENT",
    });
    redirect("/");
  }
  return session;
}
