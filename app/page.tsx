import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthPageClient } from "@/components/auth-page-client";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 已登录（30 天持久会话 cookie 有效）→ 直接进 home；未登录才显示登录/注册
export default async function AuthPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (session) {
    redirect("/home");
  }
  return <AuthPageClient />;
}
