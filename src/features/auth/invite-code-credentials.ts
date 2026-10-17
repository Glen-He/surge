import { createHmac, hkdfSync } from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";
import {
  openSecret,
  sealSecret,
} from "@/infrastructure/security/aes-gcm-envelope";

function rootSecret(): string {
  // 该配置始终必需：缺失或过短由 serverEnv 校验抛错。
  return serverEnv.INVITE_CODE_SECRET;
}

function deriveKey(purpose: string): Buffer {
  // HKDF context 已参与线上密文派生，属于持久化加密协议，不随文件重命名。
  return Buffer.from(
    hkdfSync("sha256", rootSecret(), "surge-invite-code-store", purpose, 32),
  );
}

export function inviteCodeHash(code: string): string {
  return createHmac("sha256", deriveKey("v1-lookup")).update(code).digest("hex");
}

export function encryptInviteCode(code: string): string {
  return sealSecret(code, deriveKey("v1-encryption"));
}

export function decryptInviteCode(value: string): string {
  return openSecret(
    value,
    deriveKey("v1-encryption"),
    "invalid encrypted invite code",
  );
}
