import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/features/auth/auth";
import { expireGuestIfNeeded } from "@/features/guest/guest-sandbox";
import { logger } from "@/infrastructure/logging/logger";

/** 公开页面可识别已登录 owner，但不强制要求登录。 */
export async function getOptionalSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session && (await expireGuestIfNeeded(session))) return null;
  return session;
}

/**
 * 服务端页面统一鉴权（DAL 层，Next.js 官方认证指南推荐的集中 session 校验）：
 * - 无会话 → 跳登录页
 * - 游客沙箱已到期 → 销毁沙箱并带「游客体验已结束」提示跳回
 *
 * 弹回时记录凭据 cookie 名诊断日志：区分「请求根本没带 cookie」（浏览器侧
 * cookie 传播/时序问题）与「带了 cookie 但服务端判无效」（session 失效、
 * secret 轮换、代理改写等），只记录名称，绝不打印值。
 *
 * 注意：仅供页面/RSC 使用（redirect 对 API 路由无意义）；
 * API 路由统一使用 `getApiSession()` 并在判空后返回 401。
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
    logger.warn("auth", "session missing; redirecting to login", {
      requestCredentialNames: names,
    });
    redirect("/");
  }
  return session;
}
