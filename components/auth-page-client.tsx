"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  passwordLoginAction,
  type PasswordLoginState,
} from "@/app/actions/auth";
import {
  navigateAfterAuth,
  registerWithOtp,
  sendSignUpOtp,
  signInAsGuest,
} from "@/lib/auth-flow";
import { PASSWORD_RULE_TEXT } from "@/lib/password-policy";
import { inviteCodeFromFragment } from "@/lib/invite-link";
import { OtpCodeInput } from "@/components/otp-code-input";
import { Modal } from "@/components/modal";
import { isOtpCode } from "@/lib/otp-code";
import {
  GUEST_WELCOME_KEY,
  rememberGuestExpiry,
} from "@/lib/guest-session-client";

type Mode = "signin" | "signup";

const COOLDOWN_SECONDS = 60;
const INITIAL_LOGIN_STATE: PasswordLoginState = {
  ok: false,
  error: "",
  submissionId: 0,
};

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

const ICON_INVITE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]">
    <path d="M5 8h14v11H5z" />
    <path d="M4 8h16M12 8v11M7.5 8C5 6 6.5 3.5 8.5 4.2 10 4.7 11 6.2 12 8M16.5 8C19 6 17.5 3.5 15.5 4.2 14 4.7 13 6.2 12 8" />
  </svg>
);

/**
 * 登录/注册页。本组件只负责表单 UI 与输入校验，
 * 密码登录由 Server Action 原子完成；注册与游客流程仍由 auth-flow 封装。
 */
export function AuthPageClient({
  registrationOpen,
  inviteRequired,
}: {
  registrationOpen: boolean;
  inviteRequired: boolean;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLocked, setInviteLocked] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [dismissedLoginSubmissionId, setDismissedLoginSubmissionId] =
    useState(0);

  // 注册验证码
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [authSlow, setAuthSlow] = useState(false);
  const [loginState, loginAction, loginPending] = useActionState(
    passwordLoginAction,
    INITIAL_LOGIN_STATE,
  );
  const otpRef = useRef<HTMLInputElement | null>(null);
  const otpSendPendingRef = useRef(false);
  const otpVerificationPendingRef = useRef(false);
  const loginNavigationStartedRef = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const isSignUp = mode === "signup";
  const authBusy = loading || guestLoading || loginPending || loginState.ok;
  const otpModalVisible = isSignUp && otpSent && otpModalOpen;
  const visibleError =
    error ||
    (!isSignUp && loginState.submissionId > dismissedLoginSubmissionId
      ? loginState.error
      : "");

  useEffect(() => {
    formRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  // Server Action 响应先写入 HttpOnly Cookie，再把成功状态交给客户端。
  // 这里统一做一次整页导航，避免 RSC redirect 信号偶发未触发页面切换。
  useEffect(() => {
    if (!loginState.ok || loginNavigationStartedRef.current) return;
    loginNavigationStartedRef.current = true;
    setAuthSlow(false);
    void navigateAfterAuth("/home");
  }, [loginState.ok]);

  // 邀请链接把邀请码放在 fragment 中。客户端读取后切到注册面板并锁定
  // 输入框；fragment 保留在地址栏，刷新后仍能恢复，同时不会进入服务器
  // 日志或 Referer。
  useEffect(() => {
    const invited = inviteCodeFromFragment(window.location.hash);
    if (!invited) return;
    const timer = window.setTimeout(() => {
      setInviteCode(invited);
      setInviteLocked(true);
      setMode("signup");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 验证码发送后的 60s 倒计时
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // 发送验证码后聚焦输入框
  useEffect(() => {
    if (otpModalVisible) otpRef.current?.focus({ preventScroll: true });
  }, [otpModalVisible]);

  // 请求超过 4 秒时明确告知仍在处理，不让用户反复点击。
  useEffect(() => {
    if (!authBusy) return;
    const timer = window.setTimeout(() => setAuthSlow(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [authBusy]);

  function validateEmail(value: string): string {
    if (!value) return "";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? ""
      : "请输入有效的邮箱地址";
  }

  // 注册：发送验证码（sign-in 类型对未注册邮箱也会发）
  async function sendOtp() {
    if (otpSendPendingRef.current || cooldown > 0) return;
    if (!registrationOpen) {
      setError("当前暂未开放新账号注册");
      return;
    }
    if (!email || !password) {
      setError("请填写邮箱和密码");
      return;
    }
    const err = validateEmail(email);
    if (err) {
      setEmailError(err);
      return;
    }
    otpSendPendingRef.current = true;
    setAuthSlow(false);
    setLoading(true);
    try {
      if (inviteRequired && !inviteCode) {
        setInviteError("请输入邀请码");
        return;
      }
      if (inviteCode && !/^[0-9A-Z]{6}$/.test(inviteCode)) {
        setInviteError("请输入 6 位邀请码");
        return;
      }
      const r = await sendSignUpOtp(email, password, inviteCode);
      if (!r.ok) {
        if (r.field === "inviteCode") setInviteError(r.error);
        else setError(r.error);
        return;
      }
      setOtpSent(true);
      setOtpModalOpen(true);
      setCooldown(COOLDOWN_SECONDS);
    } finally {
      otpSendPendingRef.current = false;
      setLoading(false);
    }
  }

  // 注册：验证码通过 → 服务端原子完成建号 + 登录 + 初始密码
  async function verifyOtp(otp: string) {
    if (!isOtpCode(otp) || otpVerificationPendingRef.current) return;
    otpVerificationPendingRef.current = true;
    setAuthSlow(false);
    setLoading(true);
    try {
      const r = await registerWithOtp(email, otp, password, inviteCode);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // 整页跳转（非客户端路由），Safari cookie 时序由 auth-flow 兜底
      await navigateAfterAuth("/home");
    } finally {
      otpVerificationPendingRef.current = false;
      setLoading(false);
    }
  }

  async function handleGuestLogin() {
    if (guestLoading || loading || loginPending) return;
    setAuthSlow(false);
    setGuestLoading(true);
    setError("");
    try {
      const r = await signInAsGuest();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // 落标记：整页跳到 /home 后由布局里的 GuestToasts 展示
      // 「游客登录成功 · 会话 60 分钟」提示卡（10 秒自动消失）
      try {
        sessionStorage.setItem(GUEST_WELCOME_KEY, String(r.ttlMinutes));
        rememberGuestExpiry(r.expiresAt);
      } catch {
        /* 无痕模式等场景静默忽略 */
      }
      await navigateAfterAuth("/home");
    } finally {
      setGuestLoading(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setDismissedLoginSubmissionId(loginState.submissionId);
    setEmailError("");
    setInviteError("");
    setOtpCode("");
    setOtpSent(false);
    setOtpModalOpen(false);
  }

  // 注册信息发生变化后，旧验证码不再匹配当前注册请求。
  function invalidateRegistrationOtp() {
    if (!otpSent) return;
    setOtpSent(false);
    setOtpCode("");
    setOtpModalOpen(false);
  }

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
                  disabled={authBusy}
                  className={`auth-tab ${!isSignUp ? "auth-tab-active" : ""}`}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  disabled={authBusy}
                  className={`auth-tab ${isSignUp ? "auth-tab-active" : ""}`}
                >
                  注册
                </button>
              </div>

              <form
                ref={formRef}
                data-testid="auth-form"
                action={loginAction}
                onSubmit={(e) => {
                  if (authBusy) {
                    e.preventDefault();
                    return;
                  }
                  setAuthSlow(false);
                  setError("");
                  setDismissedLoginSubmissionId(loginState.submissionId);
                  if (isSignUp) {
                    e.preventDefault();
                    if (otpSent) {
                      setOtpModalOpen(true);
                      return;
                    }
                    void sendOtp();
                  }
                }}
                noValidate
              >
                <div>
                  {/* 邮箱 */}
                  <div className="auth-field auth-field-top">
                    <div className="auth-input-wrap">
                        <span className="auth-input-icon">{ICON_MAIL}</span>
                        <input
                          id="auth-email"
                          name="email"
                          type="email"
                          placeholder="name@example.com"
                          value={email}
                          onChange={(e) => {
                            invalidateRegistrationOtp();
                            setEmail(e.target.value);
                            setError("");
                            setDismissedLoginSubmissionId(
                              loginState.submissionId,
                            );
                            if (emailError) {
                              setEmailError(validateEmail(e.target.value));
                            }
                          }}
                          onBlur={() => setEmailError(validateEmail(email))}
                          autoComplete="email"
                          disabled={authBusy}
                          className={`auth-input ${emailError ? "auth-input-error" : ""}`}
                        />
                        <label className="auth-floating-label" htmlFor="auth-email">
                          邮箱
                        </label>
                    </div>
                    <p className="auth-error-slot">{emailError}</p>
                  </div>

                  {/* 密码（登录和注册都需要，注册用于保存） */}
                  <div className="auth-field">
                    <div className="auth-input-wrap">
                        <span className="auth-input-icon">{ICON_LOCK}</span>
                        <input
                          id="auth-password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          placeholder={isSignUp ? PASSWORD_RULE_TEXT : "••••••••"}
                          value={password}
                          onChange={(e) => {
                            invalidateRegistrationOtp();
                            setPassword(e.target.value);
                            setError("");
                            setDismissedLoginSubmissionId(
                              loginState.submissionId,
                            );
                          }}
                          autoComplete={
                            isSignUp ? "new-password" : "current-password"
                          }
                          disabled={authBusy}
                          className="auth-input auth-input-pw"
                        />
                        <label
                          className="auth-floating-label"
                          htmlFor="auth-password"
                        >
                          {isSignUp ? "设置密码" : "密码"}
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          disabled={authBusy}
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
                    <p className="auth-error-slot">{visibleError}</p>
                  </div>

                  {/* 第三行始终等高：登录显示辅助入口，注册显示邀请码。 */}
                  <div className="auth-mode-slot">
                    {isSignUp ? (
                      <div className="auth-field">
                        <div className="auth-input-wrap">
                            <span className="auth-input-icon">{ICON_INVITE}</span>
                            <input
                              id="auth-invite-code"
                              name="inviteCode"
                              type="text"
                              inputMode="text"
                              maxLength={6}
                              placeholder="6 位数字或字母"
                              value={inviteCode}
                              onChange={(event) => {
                                if (inviteLocked) return;
                                invalidateRegistrationOtp();
                                setInviteCode(
                                  event.target.value
                                    .toUpperCase()
                                    .replace(/[^0-9A-Z]/g, "")
                                    .slice(0, 6),
                                );
                                setInviteError("");
                                setError("");
                              }}
                              autoComplete="off"
                              autoCapitalize="characters"
                              spellCheck={false}
                              readOnly={inviteLocked}
                              aria-readonly={inviteLocked}
                              disabled={authBusy || !isSignUp}
                              className={`auth-input auth-input-code ${inviteError ? "auth-input-error" : ""}`}
                            />
                            <label
                              className="auth-floating-label"
                              htmlFor="auth-invite-code"
                            >
                              {inviteLocked
                                ? "邀请码（邀请链接已填写）"
                                : inviteRequired
                                  ? "邀请码"
                                  : "邀请码（选填）"}
                            </label>
                        </div>
                        <p className="auth-error-slot">{inviteError}</p>
                      </div>
                    ) : (
                      <div className="auth-field auth-login-field">
                        <div className="auth-login-support">
                          <Link href="/forgot" className="auth-link">
                            忘记密码？
                          </Link>
                        </div>
                        <p className="auth-error-slot" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="auth-actions">
                  <button
                    type="submit"
                    disabled={authBusy || (isSignUp && !registrationOpen)}
                    className="auth-submit"
                  >
                    {loading || loginPending
                      ? authSlow
                        ? "网络较慢，仍在处理…"
                        : "请稍候…"
                      : isSignUp && !registrationOpen
                        ? "当前未开放注册"
                        : isSignUp
                        ? otpSent
                          ? "输入验证码"
                          : "获取验证码"
                        : "登录"}
                  </button>

                  {/* 游客登录：一键进入，自带 5 张示例卡片，60 分钟沙箱 */}
                  <button
                    type="button"
                    onClick={() => void handleGuestLogin()}
                    disabled={authBusy}
                    className="auth-guest"
                  >
                    {guestLoading
                      ? authSlow
                        ? "网络较慢，仍在准备…"
                        : "正在准备游客环境…"
                      : "游客登录"}
                  </button>
                </div>
              </form>

              <Modal
                open={otpModalVisible}
                onClose={() => setOtpModalOpen(false)}
                title="验证邮箱"
                busy={loading}
                plainHeader
              >
                <p className="text-[14px] leading-[1.55] text-[#6e6e73]">
                  验证码已发送至{" "}
                  <span className="break-email font-medium text-[#1d1d1f]">
                    {email}
                  </span>
                </p>
                <div className="mt-4 flex items-center gap-2.5">
                  <OtpCodeInput
                    ref={otpRef}
                    value={otpCode}
                    onValueChange={(value) => {
                      setOtpCode(value);
                      setError("");
                    }}
                    onComplete={(value) => void verifyOtp(value)}
                    aria-label="验证码"
                    placeholder="输入验证码"
                    disabled={loading}
                    className="otp-input"
                  />
                  <button
                    type="button"
                    onClick={() => void sendOtp()}
                    disabled={cooldown > 0 || loading}
                    className="btn-primary otp-send"
                  >
                    {loading
                      ? "发送中…"
                      : cooldown > 0
                        ? `${cooldown}s 后重发`
                        : "重新获取"}
                  </button>
                </div>
                <p className="mt-2 text-[13px] text-[#6e6e73]">
                  验证码 6 位数字，输入后自动验证，5 分钟内有效
                </p>
                <p className="field-error">{error}</p>
                <p className="mt-2 h-[18px] text-[13px] leading-[18px] text-[#6e6e73]">
                  {loading ? "验证中…" : ""}
                </p>
              </Modal>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
