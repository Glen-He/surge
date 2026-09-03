import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/infrastructure/environment/server";

function secret(): string {
  // BETTER_AUTH_SECRET 始终必需：缺失或过短在此直接抛错。
  return serverEnv.BETTER_AUTH_SECRET;
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
