export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateProductionEnvironment } = await import("./lib/env");
    validateProductionEnvironment();
    const { validateStorageSettings } = await import("./lib/storage-capacity");
    const { validateUploadGateSettings } = await import("./lib/upload-gate");
    validateStorageSettings();
    validateUploadGateSettings();
    // Next.js waits for register() before accepting traffic. Schema failures are
    // therefore readiness failures, never latent per-request 500s.
    const { auth } = await import("./lib/auth");
    const context = await auth.$context;
    await context.runMigrations();
    const { ensureSchemaVersioned } = await import("./lib/migrations");
    await ensureSchemaVersioned();
    const { ensureShareTokensProtected } = await import("./lib/share-token-store");
    await ensureShareTokensProtected();
    const { validateReportStorageConfiguration } = await import(
      "./lib/report-storage"
    );
    await validateReportStorageConfiguration();
    const { validateDemoTemplates } = await import("./lib/guest-sandbox");
    await validateDemoTemplates();
    // Full disk reconciliation is intentionally not on the readiness path. The
    // scheduler (and /api/internal/maintenance for external cron) performs it
    // under a DB lease after the server is accepting traffic.
    const { startMaintenanceScheduler } = await import("./lib/maintenance");
    startMaintenanceScheduler();
  }
}
