import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("better-auth/api", () => ({
  createAuthMiddleware: (handler: unknown) => handler,
  APIError: class extends Error {
    constructor(readonly status: string, body: { message: string }) { super(body.message); }
  },
}));
vi.mock("@/infrastructure/database/client", () => ({ db: { query: mocks.query } }));
vi.mock("./otp-rate-limit", () => ({ checkOtpRateLimit: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/infrastructure/database/rate-limit", () => ({ consumeSharedRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
import { authRequestPolicy } from "./auth-request-policy";
import { registrationInternalProof } from "./registration-policy";
import { internalAuthProof } from "@/infrastructure/security/internal-auth-proof";
const policy = authRequestPolicy as unknown as (ctx: { path: string; headers: Headers; body?: Record<string, string> }) => Promise<unknown>;

describe("原生认证入口", () => {
  beforeEach(() => mocks.query.mockReset());

  it.each(["existing@example.test", "new@example.test"])("未授权邮箱 %s 在查询账号前被一致拒绝", async (email) => {
    await expect(policy({ path: "/email-otp/send-verification-otp", headers: new Headers(), body: { email, type: "sign-in" } })).rejects.toThrow("请使用注册页完成注册");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("发码凭证不能用于登录，合法注册凭证仍受实时注册策略限制", async () => {
    const email = "new@example.test";
    const headers = new Headers({ "x-surge-registration-proof": registrationInternalProof(email, "send-otp") });
    await expect(policy({ path: "/sign-in/email-otp", headers, body: { email } })).rejects.toThrow("请使用注册页完成注册");
    expect(mocks.query).not.toHaveBeenCalled();
    headers.set("x-surge-registration-proof", registrationInternalProof(email, "sign-in"));
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ registration_enabled: false, invite_required: false }] });
    await expect(policy({ path: "/sign-in/email-otp", headers, body: { email } })).rejects.toThrow("当前未开放新账号注册");
  });

  it("允许经过受控入口的已有账号，拒绝跨会话使用退出凭证", async () => {
    const email = "existing@example.test";
    mocks.query.mockResolvedValue({ rows: [{ id: "user" }] });
    await expect(policy({ path: "/sign-in/email-otp", headers: new Headers({ "x-surge-registration-proof": registrationInternalProof(email, "sign-in") }), body: { email } })).resolves.toBeDefined();
    await expect(policy({ path: "/sign-out", headers: new Headers({ cookie: "session=b", "x-surge-end-session-proof": internalAuthProof("end-session", "session=a") }) })).rejects.toThrow("请使用平台退出登录入口");
  });
});
