import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import {
  createGuestSessionRecord,
  destroyGuestUser,
  getGuestExpiry,
  isGuestEmail,
  purgeStaleGuests,
  seedDemoReports,
  GUEST_TTL_MINUTES,
} from "@/lib/guest-sandbox";
import { ensureOtpMigration } from "@/lib/schema";

export const dynamic = "force-dynamic";

/**
 * 访客沙箱初始化（业务层）。
 * 认证已由 better-auth 官方 anonymous 客户端完成
 * （authClient.signIn.anonymous() 签发一次性账号与会话 cookie），
 * 本路由只负责产品侧数据：60 分钟过期元信息 + 5 张示例卡片。
 *
 * 初始化失败时当场销毁刚建的访客账号（会话级联失效，浏览器残留的
 * cookie 指向死会话，自然回到未登录态），不残留无沙箱的访客。
 */
export async function POST() {
  await ensureOtpMigration();
  const hs = await nextHeaders();

  // IP 频控：初始化会灌 5 条报告 + 磁盘目录，同 IP 10 分钟最多 5 次
  const ip = clientIp(hs);
  if (!rateLimit(`guest-init:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: "访客登录过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  const session = await auth.api.getSession({ headers: hs });
  if (!session || !isGuestEmail(session.user.email)) {
    return NextResponse.json(
      { error: "访客会话未就绪，请重试" },
      { status: 401 },
    );
  }
  const userId = session.user.id;

  // 幂等：已初始化过（如客户端重试）直接返回
  if (await getGuestExpiry(userId)) {
    return NextResponse.json({ ok: true, ttlMinutes: GUEST_TTL_MINUTES });
  }

  // 懒清理：顺手清掉所有已过期的访客沙箱（防 DB/磁盘垃圾堆积）
  try {
    await purgeStaleGuests();
  } catch (e) {
    logger.warn("guest-init", "清理过期访客沙箱失败", e as Error);
  }

  try {
    await createGuestSessionRecord(userId, GUEST_TTL_MINUTES);
    await seedDemoReports(userId);
  } catch (e) {
    logger.error("guest-init", "访客沙箱初始化失败", e as Error, { userId });
    // 初始化失败不要把账号留在表里（级联清理会话/报告/沙箱记录）
    try {
      await destroyGuestUser(userId);
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      { error: "初始化示例数据失败，请重试" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, ttlMinutes: GUEST_TTL_MINUTES });
}
