import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";

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
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("v1-encryption"), iv);
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptInviteCode(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("invalid encrypted invite code");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey("v1-encryption"),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
