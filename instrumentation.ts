export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateProductionEnvironment } = await import("./lib/env");
    validateProductionEnvironment();
    // Next.js waits for register() before accepting traffic. Schema failures are
    // therefore readiness failures, never latent per-request 500s.
    const { auth } = await import("./lib/auth");
    const context = await auth.$context;
    await context.runMigrations();
    const { ensureSchemaVersioned } = await import("./lib/migrations");
    await ensureSchemaVersioned();
    const { purgeTrash, reconcileReportSizes, validateReportStorageConfiguration } = await import(
      "./lib/report-storage"
    );
    await validateReportStorageConfiguration();
    await purgeTrash();
    await reconcileReportSizes();
    const { startMaintenanceScheduler } = await import("./lib/maintenance");
    startMaintenanceScheduler();
  }
}
