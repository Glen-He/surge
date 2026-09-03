import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("BETTER_AUTH_SECRET is required for internal auth proof");
  return value;
}

export function internalAuthProof(purpose: string, subject = ""): string {
  return createHmac("sha256", secret())
    .update(`surge-internal-auth:v1:${purpose}:${subject}`)
    .digest("hex");
}

export function verifyInternalAuthProof(
  purpose: string,
  subject: string,
  proof: string | null | undefined,
): boolean {
  if (!proof || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const expected = Buffer.from(internalAuthProof(purpose, subject), "hex");
  const supplied = Buffer.from(proof, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
