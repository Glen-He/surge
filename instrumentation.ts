export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Next.js waits for register() before accepting traffic. Schema failures are
    // therefore readiness failures, never latent per-request 500s.
    const { auth } = await import("./lib/auth");
    const context = await auth.$context;
    await context.runMigrations();
    const { ensureSchemaVersioned } = await import("./lib/migrations");
    await ensureSchemaVersioned();
    const { backfillApiTokenLookups } = await import("./lib/api-tokens");
    await backfillApiTokenLookups();
    const { purgeExpiredSecurityRateLimits } = await import(
      "./lib/db-rate-limit"
    );
    await purgeExpiredSecurityRateLimits();
    const { purgeTrash, validateReportStorageConfiguration } = await import(
      "./lib/report-storage"
    );
    await validateReportStorageConfiguration();
    await purgeTrash();
    const { purgeStaleGuests } = await import("./lib/guest-sandbox");
    await purgeStaleGuests();
    const { seedDefaultUser } = await import("./lib/seed");
    await seedDefaultUser();
    const { purgeExpiredDeletions } = await import("./lib/account-deletion");
    await purgeExpiredDeletions();
  }
}
