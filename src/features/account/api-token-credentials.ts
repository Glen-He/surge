import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";

function encryptionRoot(): string {
  // 该配置始终必需：缺失或过短由 serverEnv 校验抛错。
  return serverEnv.API_TOKEN_ENCRYPTION_KEY;
}

function encryptionKey(): Buffer {
  // HKDF context 已参与线上密文派生，属于持久化加密协议，不随文件重命名。
  return Buffer.from(
    hkdfSync("sha256", encryptionRoot(), "surge-api-token-store", "v1", 32),
  );
}

/** 使用独立派生密钥加密 API 令牌，供令牌所有者再次查看。 */
export function encryptApiToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/** 解密 API 令牌；格式错误、密文损坏或密钥不匹配时拒绝返回明文。 */
export function decryptApiToken(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("invalid encrypted API token");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
