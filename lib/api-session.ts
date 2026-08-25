import { headers } from "next/headers";
import { auth } from "./auth";
import { expireGuestIfNeeded } from "./guest-sandbox";

/**
 * Uniform session DAL for custom API routes. Guest expiry is an authorization
 * rule, not a UI concern, so expired sandboxes are destroyed before access is
 * granted to any authenticated business endpoint.
 */
export async function getApiSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session && (await expireGuestIfNeeded(session))) return null;
  return session;
}
