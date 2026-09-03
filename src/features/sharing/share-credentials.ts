import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";

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

function encrypt(value: string, encryptionKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decrypt(value: string, encryptionKey: Buffer): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("invalid encrypted share secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function shareTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptShareToken(token: string): string {
  return encrypt(token, key());
}

export function decryptShareToken(value: string): string {
  return decrypt(value, key());
}

/** 提取码需向所有者回显，但使用独立派生密钥加密。 */
export function encryptSharePasscode(passcode: string): string {
  return encrypt(passcode, passcodeKey());
}

export function decryptSharePasscode(value: string): string {
  return decrypt(value, passcodeKey());
}
