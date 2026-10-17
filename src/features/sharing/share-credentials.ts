import { createHash, hkdfSync } from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";
import {
  openSecret,
  sealSecret,
} from "@/infrastructure/security/aes-gcm-envelope";

function encryptionRoot(): string {
  // 该配置始终必需：缺失或过短由 serverEnv 校验抛错。
  return serverEnv.SHARE_TOKEN_ENCRYPTION_KEY;
}

function key(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", encryptionRoot(), "surge-share-token-store", "v1", 32),
  );
}

function passcodeKey(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", encryptionRoot(), "surge-share-token-store", "v1-passcode", 32),
  );
}

export function shareTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptShareToken(token: string): string {
  return sealSecret(token, key());
}

export function decryptShareToken(value: string): string {
  return openSecret(value, key(), "invalid encrypted share secret");
}

/** 提取码需向所有者回显，但使用独立派生密钥加密。 */
export function encryptSharePasscode(passcode: string): string {
  return sealSecret(passcode, passcodeKey());
}

export function decryptSharePasscode(value: string): string {
  return openSecret(value, passcodeKey(), "invalid encrypted share secret");
}
