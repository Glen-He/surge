import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";

const PROOF_TTL_SECONDS = 60;

function signature(
  purpose: string,
  subject: string,
  issuedAt: number,
  nonce: string,
): Buffer {
  return createHmac("sha256", serverEnv.BETTER_AUTH_SECRET)
    .update(JSON.stringify(["surge-internal-auth:v2", purpose, subject, issuedAt, nonce]))
    .digest();
}

/** 签发短时内部凭证；用途、主体与签发时间共同参与签名，不暴露主体内容。 */
export function internalAuthProof(purpose: string, subject: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");
  return `${issuedAt}.${nonce}.${signature(purpose, subject, issuedAt, nonce).toString("hex")}`;
}

/** 仅接受当前格式和有效期内的凭证，拒绝未来时间与跨用途、跨主体使用。 */
export function verifyInternalAuthProof(
  purpose: string,
  subject: string,
  proof: string | null | undefined,
): boolean {
  const match = proof?.match(/^(\d{10})\.([0-9a-f]{32})\.([0-9a-f]{64})$/);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  const age = Math.floor(Date.now() / 1000) - issuedAt;
  if (age < 0 || age >= PROOF_TTL_SECONDS) return false;
  return timingSafeEqual(
    Buffer.from(match[3], "hex"),
    signature(purpose, subject, issuedAt, match[2]),
  );
}
