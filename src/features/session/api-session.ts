import { headers } from "next/headers";
import { auth } from "@/features/auth/auth";
import { expireGuestIfNeeded } from "@/features/guest/guest-sandbox";

/**
 * 自建 API 路由统一的会话 DAL。游客过期属于授权规则而非 UI 关注点，
 * 因此任何已认证业务端点授权之前，过期沙箱都已被销毁。
 */
export async function getApiSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session && (await expireGuestIfNeeded(session))) return null;
  return session;
}
