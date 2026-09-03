import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

function rootSecret(): string {
  const secret = process.env.INVITE_CODE_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("INVITE_CODE_SECRET is missing or too short");
  }
  return secret;
}

function deriveKey(purpose: string): Buffer {
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
