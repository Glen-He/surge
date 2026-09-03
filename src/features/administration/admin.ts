import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getApiSession } from "@/features/auth/api-session";
import { auth } from "@/features/auth/auth";

type UserWithRole = { role?: string | null };

export function hasAdminRole(user: UserWithRole): boolean {
  return (user.role ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");
}

/** 管理页面统一授权：未登录回登录页，非管理员回首页。 */
export async function requireAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/");
  if (!hasAdminRole(session.user)) redirect("/home");
  return session;
}

/** 管理 API 统一授权；调用方必须对 null 返回 403。 */
export async function getAdminApiSession() {
  const session = await getApiSession();
  return session && hasAdminRole(session.user) ? session : null;
}
