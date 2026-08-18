"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

type Mode = "signin" | "signup";

const OTP_LENGTH = 6;
const COOLDOWN_SECONDS = 60;

// better-auth 错误码 → 中文文案（框架默认返回英文 message，这里统一翻译）
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码错误",
  USER_NOT_FOUND: "该邮箱尚未注册",
  INVALID_PASSWORD: "密码错误",
  EMAIL_NOT_VERIFIED: "邮箱尚未验证，请先完成验证",
  PASSWORD_TOO_SHORT: "密码长度不足",
  USER_ALREADY_EXISTS: "该邮箱已注册，请直接登录",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "该邮箱已注册，请更换邮箱",
  INVALID_OTP: "验证码错误",
  OTP_EXPIRED: "验证码已过期，请重新获取",
  TOO_MANY_REQUESTS: "操作过于频繁，请稍后再试",
  RATE_LIMIT: "操作过于频繁，请稍后再试",
  INVALID_EMAIL: "邮箱格式不正确",
};

function toChineseError(error: { code?: string; message?: string } | undefined): string {
  if (!error) return "操作失败，请稍后重试";
  if (error.code && AUTH_ERROR_MESSAGES[error.code]) {
    return AUTH_ERROR_MESSAGES[error.code];
  }
  // 英文消息（better-auth 未知错误）不直接展示，统一中文兜底
  const msg = error.message ?? "";
  if (msg && /[\u4e00-\u9fff]/.test(msg)) return msg;
  return "操作失败，请稍后重试";
}

const ICON_MAIL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]">
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

const ICON_LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]">
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

export function AuthPageClient() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");

  // 注册验证码
  const [otpDigits, setOtpDigits] = useState<string[]>(
    Array(OTP_LENGTH).fill(""),
  );
  const [otpSent, setOtpSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const isSignUp = mode === "signup";
  const otpPhase = isSignUp && otpSent;

  // 验证码发送后的 60s 倒计时
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // 发送验证码后聚焦第一格
  useEffect(() => {
    if (otpSent) otpRefs.current[0]?.focus();
  }, [otpSent]);

  function validateEmail(value: string): string {
    if (!value) return "";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? ""
      : "请输入有效的邮箱地址";
  }

  // 注册：发送验证码（sign-in 类型对未注册邮箱也会发）
  async function sendOtp() {
    if (!email || !password) {
      setError("请填写邮箱和密码");
      return;
    }
    const err = validateEmail(email);
    if (err) {
      setEmailError(err);
      return;
    }
    if (cooldown > 0) return;

    setLoading(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (error) {
        setError(toChineseError(error));
        return;
      }
      setOtpSent(true);
      setCooldown(COOLDOWN_SECONDS);
    } finally {
      setLoading(false);
    }
  }

  // 注册：验证码通过 → 自动创建用户（emailVerified=true）→ 设置密码
  async function verifyOtp(otp: string) {
    setLoading(true);
    try {
      const { error } = await authClient.signIn.emailOtp({
        email,
        otp,
        // 类型要求 name 必填；服务端钩子会覆盖为自动生成的随机 ID
        name: "",
        // 注册成功后保持登录 30 天
        rememberMe: true,
      });
      if (error) {
        setError(toChineseError(error));
        return;
      }
      // 验证通过即已登录，用第一步填的密码保存（走自定义服务端路由）
      if (password.length < 8) {
        setError("密码至少需要 8 位");
        return;
      }
      const pwRes = await fetch("/api/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      if (!pwRes.ok) {
        setError("设置密码失败，请重试");
        return;
      }
      // 整页跳转（非客户端路由）：Safari 下 router.push 的 RSC 请求可能不带
      // 刚 Set-Cookie 的会话，服务端视为未登录弹回登录页（"要登录两次"）
      window.location.assign("/home");
    } finally {
      setLoading(false);
    }
  }

  // 登录：邮箱 + 密码，无需验证码
  async function handleSignIn() {
    if (!email || !password) {
      setError("请填写邮箱和密码");
      return;
    }
    setLoading(true);
    try {
      const { error } = await authClient.signIn.email({
        email,
        password,
        // 保持登录 30 天
        rememberMe: true,
      });
      if (error) {
        setError(toChineseError(error));
        return;
      }
      // 整页跳转，理由同上（Safari cookie 竞态）
      window.location.assign("/home");
    } finally {
      setLoading(false);
    }
  }

  async function handleGuestLogin() {
    if (guestLoading || loading) return;
    setGuestLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/guest-login", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        // 服务端已统一中文；若仍有英文漏网（如代理层异常），前端兜底替换
        const raw = typeof data?.error === "string" ? data.error : "";
        setError(
          raw && /[\u4e00-\u9fff]/.test(raw) ? raw : "访客登录失败，请稍后重试",
        );
        return;
      }
      // 落标记：整页跳到 /home 后由布局里的 GuestToasts 展示
      // 「访客登录成功 · 会话 60 分钟」提示卡（10 秒自动消失）
      try {
        sessionStorage.setItem(
          "surge:guest-login-toast",
          String(data.ttlMinutes ?? 60),
        );
      } catch {
        /* 无痕模式等场景静默忽略 */
      }
      window.location.assign("/home");
    } finally {
      setGuestLoading(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setEmailError("");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setOtpSent(false);
  }

  // 验证码阶段点“修改”：回到填写阶段，保留已填内容
  function backToFields() {
    setOtpSent(false);
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setError("");
  }

  function handleOtpChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    setError("");

    if (digit && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
    if (digit && index === OTP_LENGTH - 1) {
      const otp = otpDigits.map((d, i) => (i === index ? digit : d)).join("");
      void verifyOtp(otp);
    }
  }

  function handleOtpKeyDown(
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, OTP_LENGTH);
    if (!text) return;
    e.preventDefault();
    setOtpDigits(
      text.split("").concat(Array(OTP_LENGTH - text.length).fill("")),
    );
    otpRefs.current[Math.min(text.length, OTP_LENGTH - 1)]?.focus();
    if (text.length === OTP_LENGTH) {
      void verifyOtp(text);
    }
  }

  const otpComplete = otpDigits.every((d) => d !== "");

  return (
    <main className="auth-page text-[#1d1d1f] antialiased">
      <div className="auth-main">
        <div className="auth-stage">
          {/* 左侧：安静品牌区 */}
          <aside className="auth-brand">
            <div className="auth-brand-logo">
              <span className="auth-brand-dot" aria-hidden />
              工作汇报系统
            </div>
            <h2 className="auth-brand-title">
              让工作记录更清晰，
              <br />
              让每一次汇报都有迹可循。
            </h2>
            <p className="auth-brand-foot">安全 · 简洁 · 高效</p>
          </aside>

          {/* 右侧：表单面板 */}
          <section className="auth-form-panel">
            <div className="auth-form-inner">
              <h1 className="auth-title">
                {isSignUp ? "创建账号" : "欢迎回来"}
              </h1>
              <p className="auth-subtitle">
                {isSignUp
                  ? "开始使用工作汇报系统"
                  : "登录你的账号继续使用工作汇报系统"}
              </p>

              {/* 分段切换（登录 / 注册）——滑块按可用宽度计算，天然对称 */}
              <div className="auth-tabs">
                <span
                  aria-hidden
                  className="auth-tab-indicator"
                  style={{
                    transform: isSignUp ? "translateX(100%)" : "translateX(0)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className={`auth-tab ${!isSignUp ? "auth-tab-active" : ""}`}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className={`auth-tab ${isSignUp ? "auth-tab-active" : ""}`}
                >
                  注册
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setError("");
                  if (isSignUp) {
                    if (otpSent) return;
                    sendOtp();
                  } else {
                    handleSignIn();
                  }
                }}
                noValidate
              >
                {/* 注册验证码阶段：摘要 + 验证码格（平滑展开） */}
                <div
                  className={`auth-collapse ${otpPhase ? "auth-collapse-open" : ""}`}
                >
                  <div>
                    <div className="auth-field auth-field-top">
                      <div className="auth-summary">
                        <span className="auth-summary-value break-email">
                          {email}
                        </span>
                        <button
                          type="button"
                          onClick={backToFields}
                          className="auth-link shrink-0"
                        >
                          修改
                        </button>
                      </div>
                    </div>
                    <div className="auth-field">
                      <label className="auth-label">验证码</label>
                      <div className="auth-otp-shell">
                        {otpDigits.map((d, i) => (
                          <input
                            key={i}
                            ref={(el) => {
                              otpRefs.current[i] = el;
                            }}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={d}
                            onChange={(e) => handleOtpChange(i, e.target.value)}
                            onKeyDown={(e) => handleOtpKeyDown(i, e)}
                            onPaste={handleOtpPaste}
                            aria-label={`验证码第 ${i + 1} 位`}
                            className="auth-otp"
                          />
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[12px]">
                        <button
                          type="button"
                          onClick={sendOtp}
                          disabled={cooldown > 0 || loading}
                          className="auth-link"
                        >
                          {cooldown > 0
                            ? `${cooldown}s 后重新获取`
                            : loading
                              ? "发送中…"
                              : "重新获取验证码"}
                        </button>
                        <span className="text-[#86868b]">
                          输入完整验证码后自动验证
                        </span>
                      </div>
                      <p className="auth-error-slot">{error}</p>
                    </div>
                  </div>
                </div>

                {/* 填写阶段：邮箱 + 密码（验证码阶段平滑收起） */}
                <div
                  className={`auth-collapse ${otpPhase ? "" : "auth-collapse-open"}`}
                >
                  <div>
                    {/* 邮箱 */}
                    <div className="auth-field auth-field-top">
                      <label className="auth-label" htmlFor="auth-email">
                        邮箱
                      </label>
                      <div className="auth-input-wrap">
                        <span className="auth-input-icon">{ICON_MAIL}</span>
                        <input
                          id="auth-email"
                          type="email"
                          placeholder="name@example.com"
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            setError("");
                            if (emailError) {
                              setEmailError(validateEmail(e.target.value));
                            }
                          }}
                          onBlur={() => setEmailError(validateEmail(email))}
                          autoComplete="email"
                          className={`auth-input ${emailError ? "auth-input-error" : ""}`}
                        />
                      </div>
                      <p className="auth-error-slot">{emailError}</p>
                    </div>

                    {/* 密码（登录和注册都需要，注册用于保存） */}
                    <div className="auth-field">
                      <label className="auth-label" htmlFor="auth-password">
                        {isSignUp ? "设置密码" : "密码"}
                      </label>
                      <div className="auth-input-wrap">
                        <span className="auth-input-icon">{ICON_LOCK}</span>
                        <input
                          id="auth-password"
                          type={showPassword ? "text" : "password"}
                          placeholder={isSignUp ? "至少 8 位" : "••••••••"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoComplete={
                            isSignUp ? "new-password" : "current-password"
                          }
                          className="auth-input auth-input-pw"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? "隐藏密码" : "显示密码"}
                          className="auth-eye"
                        >
                          {showPassword ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]">
                              <path d="M3 3l18 18" />
                              <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                              <path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c5.5 0 9 7 9 7a17 17 0 0 1-2.6 3.2M6.6 6.6A17 17 0 0 0 3 12s3.5 7 9 7a9.7 9.7 0 0 0 4-.9" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <p className="auth-error-slot">{error}</p>
                    </div>
                  </div>
                </div>

                {/* 元信息行：登录=右对齐忘记密码；注册=居中提示。同高，位置固定 */}
                <div
                  className={`auth-meta-row ${isSignUp ? "auth-meta-center" : ""}`}
                >
                  {!isSignUp ? (
                    <Link href="/forgot" className="auth-link">
                      忘记密码？
                    </Link>
                  ) : (
                    !otpSent && (
                      <span className="text-[12px] text-[#86868b]">
                        验证码通过后将自动创建账号
                      </span>
                    )
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || (otpPhase && !otpComplete)}
                  className="auth-submit"
                >
                  {loading
                    ? "请稍候…"
                    : isSignUp
                      ? otpSent
                        ? otpComplete
                          ? "注册中…"
                          : "请输入验证码"
                        : "获取验证码"
                      : "登录"}
                </button>

                {/* 游客登录：一键进入，自带 5 张示例卡片，60 分钟沙箱 */}
                <button
                  type="button"
                  onClick={() => void handleGuestLogin()}
                  disabled={guestLoading || loading}
                  className="auth-guest"
                >
                  {guestLoading ? "正在准备访客环境…" : "游客登录"}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
