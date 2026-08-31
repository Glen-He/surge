import { internalAuthProof, verifyInternalAuthProof } from "./internal-auth-proof";

type RegistrationMode = "open" | "closed";

function registrationMode(): RegistrationMode {
  const configured = process.env.REGISTRATION_MODE?.trim().toLowerCase();
  if (configured === "open" || configured === "closed") return configured;
  // Public account creation is deny-by-default in production. Local
  // development stays convenient unless explicitly configured otherwise.
  return process.env.NODE_ENV === "production" ? "closed" : "open";
}

export function registrationIsOpen(): boolean {
  return registrationMode() === "open";
}

/** Auth-handler proof that is generated only inside the custom registration saga. */
export function registrationInternalProof(email: string): string {
  return internalAuthProof("registration", email.trim().toLowerCase());
}

export function verifyRegistrationInternalProof(
  email: string,
  proof: string | null | undefined,
): boolean {
  return verifyInternalAuthProof(
    "registration",
    email.trim().toLowerCase(),
    proof,
  );
}
