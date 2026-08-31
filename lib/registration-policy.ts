import { internalAuthProof, verifyInternalAuthProof } from "./internal-auth-proof";

type RegistrationMode = "open" | "closed";

function registrationMode(): RegistrationMode {
  const configured = process.env.REGISTRATION_MODE?.trim().toLowerCase();
  if (configured === "open" || configured === "closed") return configured;
  // 生产环境公开注册默认拒绝（deny-by-default）；
  // 本地开发保持便利，除非显式配置为关闭。
  return process.env.NODE_ENV === "production" ? "closed" : "open";
}

export function registrationIsOpen(): boolean {
  return registrationMode() === "open";
}

/** 仅在自建注册流程内部生成的 auth-handler proof */
export function registrationInternalProof(email: string): string {
  return internalAuthProof("registration", email.trim().toLowerCase());
}

export function verifyRegistrationInternalProof(
  email: string,
  proof: string | null | undefined,
): boolean {
  return verifyInternalAuthProof(
    "registration",
    email.trim().toLowerCase(),
    proof,
  );
}
