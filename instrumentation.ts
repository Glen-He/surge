export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateProductionEnvironment } = await import("./lib/env");
    validateProductionEnvironment();
    const { validateStorageSettings } = await import("./lib/storage-capacity");
    const { validateUploadGateSettings } = await import("./lib/upload-gate");
    validateStorageSettings();
    validateUploadGateSettings();
    // Better Auth 1.7 在 account identity 上新增 issuer。存量数据必须先完成
    // 语义回填，再交给认证库补齐索引等结构，不能直接添加必填列。
    const { ensureBetterAuthSchemaCompatible } = await import(
      "./lib/better-auth-migration"
    );
    await ensureBetterAuthSchemaCompatible();
    // Next.js 会等 register() 完成后才接收流量，因此 schema 失败
    // 属于就绪失败，而不是潜伏到某个请求才爆的 500。
    const { auth } = await import("./lib/auth");
    const context = await auth.$context;
    await context.runMigrations();
    const { ensureSchemaVersioned } = await import("./lib/migrations");
    await ensureSchemaVersioned();
    const { validateReportStorageConfiguration } = await import(
      "./lib/report-storage"
    );
    await validateReportStorageConfiguration();
    const { validateDemoTemplates } = await import("./lib/guest-sandbox");
    await validateDemoTemplates();
    // 全量磁盘核对刻意不放在就绪路径上：调度器
    // （外部定时任务走 /api/internal/maintenance）在服务接收流量后、
    // 持有数据库租约时才执行。
    const { startMaintenanceScheduler } = await import("./lib/maintenance");
    startMaintenanceScheduler();
  }
}
