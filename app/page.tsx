import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthPageClient } from "@/components/auth-page-client";
import { auth } from "@/lib/auth";
import { expireGuestIfNeeded } from "@/lib/guest-sandbox";
import { registrationIsOpen } from "@/lib/registration-policy";

export const dynamic = "force-dynamic";

// 已登录（30 天持久会话 cookie 有效）→ 直接进 home；未登录才显示登录/注册
export default async function AuthPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  // 游客会话已过 60 分钟：销毁沙箱，落到登录页并展示「游客体验已结束」提示
  if (session && (await expireGuestIfNeeded(session))) {
    redirect("/?guestExpired=1");
  }
  if (session) {
    redirect("/home");
  }
  return <AuthPageClient registrationOpen={registrationIsOpen()} />;
}
