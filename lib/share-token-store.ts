import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

function key(): Buffer {
  const root = process.env.SHARE_TOKEN_ENCRYPTION_KEY ?? process.env.SHARE_SECRET;
  if (!root) throw new Error("缺少 SHARE_TOKEN_ENCRYPTION_KEY 或 SHARE_SECRET");
  return Buffer.from(
    hkdfSync("sha256", root, "surge-share-token-store", "v1", 32),
  );
}

function passcodeKey(): Buffer {
  const root = process.env.SHARE_TOKEN_ENCRYPTION_KEY ?? process.env.SHARE_SECRET;
  if (!root) throw new Error("缺少 SHARE_TOKEN_ENCRYPTION_KEY 或 SHARE_SECRET");
  return Buffer.from(
    hkdfSync("sha256", root, "surge-share-token-store", "v1-passcode", 32),
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

/** Extraction codes are recoverable for the owner, but use a distinct key. */
export function encryptSharePasscode(passcode: string): string {
  return encrypt(passcode, passcodeKey());
}

export function decryptSharePasscode(value: string): string {
  return decrypt(value, passcodeKey());
}
