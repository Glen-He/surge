import { auth } from "@/lib/auth";

// 注册验证码通过后，用登录态设置初始密码
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.newPassword !== "string") {
    return Response.json({ error: "缺少密码" }, { status: 400 });
  }

  try {
    await auth.api.setPassword({
      body: { newPassword: body.newPassword },
      headers: req.headers,
    });
    return Response.json({ status: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "设置密码失败" },
      { status: 400 },
    );
  }
}
