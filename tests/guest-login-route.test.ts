import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  authHandler: vi.fn(),
  consumeRateLimit: vi.fn(),
  initializeSandbox: vi.fn(),
  destroyGuest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { handler: mocked.authHandler },
}));
vi.mock("@/lib/client-ip", () => ({ clientIp: () => "203.0.113.10" }));
vi.mock("@/lib/db-rate-limit", () => ({
  consumeSharedRateLimit: mocked.consumeRateLimit,
}));
vi.mock("@/lib/guest-sandbox", () => ({
  GUEST_TTL_MINUTES: 60,
  guestInternalProof: () => "guest-proof",
  isGuestEmail: (email: string) => email.endsWith("@demo.surge"),
  initializeGuestSandbox: mocked.initializeSandbox,
  destroyGuestUser: mocked.destroyGuest,
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { POST } from "@/app/api/auth/guest-login/route";

function request() {
  return new Request("https://surge.example/api/auth/guest-login", {
    method: "POST",
    headers: { Origin: "https://surge.example" },
  });
}

describe("原子游客登录", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.consumeRateLimit.mockResolvedValue({ allowed: true });
    mocked.authHandler.mockResolvedValue(
      Response.json(
        { user: { id: "guest-1", email: "guest_1@demo.surge" } },
        {
          headers: {
            "Set-Cookie":
              "better-auth.session_token=secret; Path=/; HttpOnly; SameSite=Lax",
          },
        },
      ),
    );
    mocked.initializeSandbox.mockResolvedValue(
      new Date("2026-08-31T09:00:00.000Z"),
    );
    mocked.destroyGuest.mockResolvedValue(undefined);
  });

  it("只在沙箱初始化成功后向浏览器下发会话 Cookie", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      ttlMinutes: 60,
      expiresAt: "2026-08-31T09:00:00.000Z",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=secret",
    );
    expect(mocked.initializeSandbox).toHaveBeenCalledWith("guest-1", 60);
    expect(mocked.destroyGuest).not.toHaveBeenCalled();
  });

  it("初始化失败会销毁临时账号，且不下发 Cookie", async () => {
    mocked.initializeSandbox.mockRejectedValueOnce(new Error("database down"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocked.destroyGuest).toHaveBeenCalledWith("guest-1");
  });

  it("频率超限时不创建匿名账号", async () => {
    mocked.consumeRateLimit.mockResolvedValueOnce({ allowed: false });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocked.authHandler).not.toHaveBeenCalled();
  });
});
