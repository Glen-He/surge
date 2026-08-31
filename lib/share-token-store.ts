import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { db } from "./db";

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

let hardened: Promise<void> | null = null;

async function hardenLegacyTokens(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('share-token-hardening', 0))",
    );
    for (const table of ["report_shares", "share_boards"] as const) {
      const rows = await client.query<{ id: string; token: string }>(
        `SELECT id, token FROM ${table} WHERE token IS NOT NULL AND token_hash IS NULL FOR UPDATE`,
      );
      for (const row of rows.rows) {
        await client.query(
          `UPDATE ${table} SET token_hash = $2, token_enc = $3, token = NULL WHERE id = $1`,
          [row.id, shareTokenHash(row.token), encryptShareToken(row.token)],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function ensureShareTokensProtected(): Promise<void> {
  if (!hardened) {
    hardened = hardenLegacyTokens().catch((error) => {
      hardened = null;
      throw error;
    });
  }
  return hardened;
}
