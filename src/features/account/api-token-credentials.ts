import { hkdfSync } from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";
import {
  openSecret,
  sealSecret,
} from "@/infrastructure/security/aes-gcm-envelope";

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
  return sealSecret(token, encryptionKey());
}

/** 解密 API 令牌；格式错误、密文损坏或密钥不匹配时拒绝返回明文。 */
export function decryptApiToken(value: string): string {
  return openSecret(value, encryptionKey(), "invalid encrypted API token");
}
