import { db } from "@/infrastructure/database/client";
import { consumeSharedRateLimit } from "@/infrastructure/database/rate-limit";
import { logger } from "@/infrastructure/logging/logger";
import { internalAuthProof } from "@/infrastructure/security/internal-auth-proof";
import {
  authSetCookies,
  internalAuthBaseUrl,
  internalAuthHeaders,
} from "@/infrastructure/auth/internal-auth-request";
import { auth } from "./auth";
import { RegistrationError } from "./registration-errors";
import {
  redeemRegistrationInvite,
  validateRegistrationInvite,
} from "./registration-invites";
import {
  getRegistrationPolicy,
  registrationInternalProof,
} from "./registration-policy";

/** 串行完成 OTP 建号、初始密码设置、邀请码核销与会话签发，失败时执行补偿清理。 */
export async function registerAccount(input: {
  email: string;
  otp: string;
  password: string;
  inviteCode: string;
  clientIp: string;
  requestUrl: string;
  headers: Headers;
}): Promise<{ setCookies: string[] }> {
  const rate = await consumeSharedRateLimit("register", input.clientIp, 10, 10 * 60);
  if (!rate.allowed) throw new RegistrationError("REGISTRATION_RATE_LIMIT");

  const client = await db.connect();
  const lockKey = `registration:${input.email.toLowerCase()}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
    // 注册关闭时对所有邮箱返回同一结果；邀请码是否真实存在延后到
    // OTP 验证通过后再校验，避免未认证请求在查账号前探测邀请码。
    const policy = await getRegistrationPolicy(client);
    if (!policy.enabled) {
      throw new RegistrationError("REGISTRATION_CLOSED");
    }
    const before = await client.query<{ id: string }>(
      `SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
      [input.email],
    );
    const userExisted = before.rows[0] !== undefined;

    const otpHeaders = internalAuthHeaders(input.headers);
    otpHeaders.set(
      "x-surge-registration-proof",
      registrationInternalProof(input.email, "sign-in"),
    );
    let otpResponse: Response;
    try {
      otpResponse = await auth.handler(
        new Request(
          `${internalAuthBaseUrl(input.requestUrl)}/api/auth/sign-in/email-otp`,
          {
            method: "POST",
            headers: otpHeaders,
            body: JSON.stringify({ email: input.email, otp: input.otp, name: "" }),
          },
        ),
      );
    } catch (error) {
      logger.error("register", "email otp sign-in failed", error as Error);
      throw new RegistrationError("REGISTRATION_FAILED");
    }
    const otpData = (await otpResponse.clone().json().catch(() => null)) as
      | { user?: { id?: string }; token?: string; code?: string }
      | null;
    if (!otpResponse.ok) {
      throw new RegistrationError("AUTH_REGISTRATION_REJECTED", {
        authCode: otpData?.code ?? null,
      });
    }

    let createdUserId = otpData?.user?.id;
    if (!userExisted && !createdUserId) {
      const created = await client.query<{ id: string }>(
        `SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
        [input.email],
      );
      createdUserId = created.rows[0]?.id;
    }
    const setCookies = authSetCookies(otpResponse.headers);
    const sessionCookie = setCookies
      .map((cookie) => cookie.split(";")[0])
      .find((cookie) => cookie.includes("session_token"));
    const sessionToken = otpData?.token ?? null;

    const compensate = async () => {
      if (!userExisted && createdUserId) {
        await client.query(`DELETE FROM "user" WHERE id = $1`, [createdUserId]);
      } else if (sessionToken) {
        await client.query(`DELETE FROM "session" WHERE token = $1`, [sessionToken]);
      }
    };

    if (!sessionCookie) {
      await compensate();
      throw new RegistrationError("REGISTRATION_FAILED");
    }

    // OTP 已证明邮箱归属，此时才校验邀请码：未认证请求无法再用
    // 发码/注册接口区分邀请码是否有效。已有账号不受邀请码策略影响。
    if (!userExisted) {
      if (policy.inviteRequired && !input.inviteCode) {
        await compensate();
        throw new RegistrationError("INVITE_REQUIRED");
      }
      if (
        input.inviteCode &&
        !(await validateRegistrationInvite(input.inviteCode, client))
      ) {
        await compensate();
        throw new RegistrationError("INVITE_INVALID");
      }
    }

    try {
      const passwordHeaders = internalAuthHeaders(input.headers, sessionCookie);
      passwordHeaders.set(
        "x-surge-set-password-proof",
        internalAuthProof("set-password", passwordHeaders.get("cookie") ?? ""),
      );
      await auth.api.setPassword({
        body: { newPassword: input.password },
        headers: passwordHeaders,
      });
    } catch (error) {
      const authError = error as { body?: { code?: string }; code?: string };
      if ((authError.body?.code ?? authError.code) !== "PASSWORD_ALREADY_SET") {
        await compensate();
        logger.error("register", "failed to set initial password", error as Error);
        throw new RegistrationError("REGISTRATION_FAILED");
      }
    }

    if (!userExisted && input.inviteCode) {
      if (!createdUserId) {
        await compensate();
        throw new RegistrationError("REGISTRATION_FAILED");
      }
      const redeemed = await redeemRegistrationInvite({
        client,
        code: input.inviteCode,
        userId: createdUserId,
      });
      if (!redeemed) {
        await compensate();
        throw new RegistrationError("INVITE_INVALID");
      }
    }
    return { setCookies };
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey])
      .catch(() => {});
    client.release();
  }
}
