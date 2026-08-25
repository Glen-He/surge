import { ensureSchemaVersioned } from "./migrations";

// 兜底迁移入口：在每个 API 入口调用，确保表结构就绪。
// 历史名称保留（ensureOtpMigration），内部已升级为版本化迁移：
// schema_migrations 表记录已应用版本，每个版本只执行一次，
// 结构变更方式见 lib/migrations.ts 顶部说明。
// 迁移失败必须向上抛出：继续业务只会产生更难诊断的零散 500。
let migrated = false;
let migrating: Promise<void> | null = null;

export function ensureOtpMigration(): Promise<void> {
  if (migrated) return Promise.resolve();
  if (migrating) return migrating;
  migrating = (async () => {
    try {
      await ensureSchemaVersioned();
      migrated = true;
    } finally {
      migrating = null;
    }
  })();
  return migrating;
}
