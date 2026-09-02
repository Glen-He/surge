import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "node:os";
import { db } from "./db";
import { logger } from "./logger";

// 运行时报告数据必须与代码和只读模板分离。所有环境都显式配置，避免开发
// 环境悄悄写回 checkout，继而把代码目录误当成正式数据卷。
const configuredReportDataDir = process.env.REPORTS_DATA_DIR?.trim();
if (!configuredReportDataDir) {
  throw new Error("REPORTS_DATA_DIR is required");
}
export const REPORT_DATA_DIR = path.resolve(
  /* turbopackIgnore: true */ configuredReportDataDir,
);
const REPORT_TRASH_DIR = path.join(REPORT_DATA_DIR, ".trash");
export const REPORT_DEMO_TEMPLATES_DIR = path.join(
  process.cwd(),
  "reports",
  "demo-templates",
);

// 模板 key 永远由服务端允许列表映射，不把数据库字符串当文件路径。
// 即使数据库被意外写入 ../，也无法越界读取服务器文件。
const DEMO_TEMPLATE_KEYS = [
  "tpl-01",
  "tpl-02",
  "tpl-03",
  "tpl-04",
  "tpl-05",
] as const;
export type DemoTemplateKey = (typeof DEMO_TEMPLATE_KEYS)[number];
const DEMO_TEMPLATE_KEY_SET = new Set<string>(DEMO_TEMPLATE_KEYS);

function assertSafeDataDir(dir: string): void {
  const root = path.parse(dir).root;
  if (dir === root || dir === process.cwd()) {
    throw new Error("REPORTS_DATA_DIR points at an unsafe broad directory");
  }
}

assertSafeDataDir(REPORT_DATA_DIR);

export async function validateReportStorageConfiguration(): Promise<void> {
  await fs.mkdir(REPORT_DATA_DIR, { recursive: true });
  // 同时解析符号链接和字面路径；看似位于外部、实际指回 checkout 的目录
  // 仍属于不安全的数据位置。
  const [realCheckout, realData] = await Promise.all([
    fs.realpath(process.cwd()),
    fs.realpath(REPORT_DATA_DIR),
  ]);
  const relative = path.relative(realCheckout, realData);
  if (!relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "REPORTS_DATA_DIR must be outside the application checkout",
    );
  }
}

export function userReportsDir(userId: string): string {
  if (!userId || userId === "." || userId === ".." || /[\\/\0]/.test(userId)) {
    throw new Error("Invalid user id for report storage");
  }
  return path.join(/* turbopackIgnore: true */ REPORT_DATA_DIR, userId);
}

/** 校验报告 slug 可安全用作单个路径 segment。 */
export function assertSafeReportSlug(slug: string): void {
  if (!slug || slug === "." || slug === ".." || /[\\/\0]/.test(slug)) {
    throw new Error("Invalid report slug for storage");
  }
}

const STORAGE_KEY_RE = /^a_[0-9a-f]{32}$/;

export function newReportStorageKey(): string {
  return `a_${randomUUID().replaceAll("-", "")}`;
}

export function reportArtifactsDir(userId: string): string {
  return path.join(userReportsDir(userId), "artifacts");
}

export function reportStagingDir(userId: string): string {
  return path.join(userReportsDir(userId), ".staging");
}

/** 校验不透明服务端 key 之后才解析不可变 artifact 目录 */
export function reportArtifactDir(userId: string, storageKey: string): string {
  if (!STORAGE_KEY_RE.test(storageKey)) {
    throw new Error("Invalid report storage key");
  }
  return path.join(reportArtifactsDir(userId), storageKey);
}

function isDemoTemplateKey(value: string): value is DemoTemplateKey {
  return DEMO_TEMPLATE_KEY_SET.has(value);
}

/** 经严格白名单解析服务端掌管的不可变演示模板 */
export function demoTemplateDir(templateKey: string): string {
  if (!isDemoTemplateKey(templateKey)) {
    throw new Error("Unknown report template key");
  }
  return path.join(REPORT_DEMO_TEMPLATES_DIR, templateKey);
}

/**
 * 解析报告行的内容根目录。用户报告走私有存储；
 * 游客演示在文件被替换前共用一份只读模板。
 */
export function reportContentDir(report: {
  userId: string;
  templateKey?: string | null;
  storageKey?: string | null;
}): string {
  if (report.templateKey) return demoTemplateDir(report.templateKey);
  if (report.storageKey) {
    return reportArtifactDir(report.userId, report.storageKey);
  }
  throw new Error("Report content pointer is missing");
}

type TrashManifest = {
  version: 1;
  kind: "account" | "guest";
  userId: string;
  payload: string;
};

export type TrashMove = {
  original: string;
  trashed: string | null;
  manifest: string | null;
};

async function stageInTrash(
  original: string,
  details: Omit<TrashManifest, "version" | "payload">,
): Promise<TrashMove> {
  await fs.mkdir(REPORT_TRASH_DIR, { recursive: true });
  const key = randomUUID();
  const payloadName = `${key}.data`;
  const trashed = path.join(REPORT_TRASH_DIR, payloadName);
  const manifest = path.join(REPORT_TRASH_DIR, `${key}.json`);
  const handle = await fs.open(manifest, "wx", 0o600);
  try {
    await handle.writeFile(
      JSON.stringify({ version: 1, ...details, payload: payloadName }),
      "utf8",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(original, trashed);
    return { original, trashed, manifest };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.rm(manifest, { force: true });
      return { original, trashed: null, manifest: null };
    }
    await fs.rm(manifest, { force: true }).catch(() => {});
    throw error;
  }
}

export async function moveUserDirToTrash(
  userId: string,
  reason: "account" | "guest",
): Promise<TrashMove> {
  return stageInTrash(userReportsDir(userId), { kind: reason, userId });
}

export async function restoreTrashedDir(
  original: string,
  trashed: string | null,
  manifest?: string | null,
): Promise<void> {
  if (!trashed) return;
  await fs.mkdir(path.dirname(original), { recursive: true });
  await fs.rename(trashed, original);
  if (manifest) await fs.rm(manifest, { force: true });
}

export async function removeTrashedDir(
  trashed: string | null,
  manifest?: string | null,
): Promise<void> {
  if (!trashed) return;
  await fs.rm(trashed, { recursive: true, force: true, maxRetries: 3 });
  if (manifest) await fs.rm(manifest, { force: true });
}

function isManifest(value: unknown): value is TrashManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TrashManifest>;
  return (
    item.version === 1 &&
    (item.kind === "account" || item.kind === "guest") &&
    typeof item.userId === "string" &&
    typeof item.payload === "string" &&
    /^[0-9a-f-]+\.data$/i.test(item.payload)
  );
}

/**
 * 跨资源删除的崩溃恢复：目录被隐藏前先持久化 manifest。
 * 启动时按数据库状态决定恢复 payload（删除未提交）还是清除（删除已提交）。
 */
export async function purgeTrash(): Promise<void> {
  const client = await db.connect();
  const globalKey = "storage-quota:global";
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      globalKey,
    ]);
    let entries;
    try {
      entries = await fs.readdir(REPORT_TRASH_DIR, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const manifests = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json"),
    );
    for (const entry of manifests) {
      const manifestPath = path.join(REPORT_TRASH_DIR, entry.name);
      let manifest: TrashManifest;
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        if (!isManifest(parsed)) throw new Error("invalid trash manifest");
        manifest = parsed;
      } catch (error) {
        if (await isOlderThan(manifestPath, recoveryRetentionMs())) {
          await fs.rm(manifestPath, { force: true });
          logger.warn("storage-recovery", "removed invalid trash manifest past retention", {
            entry: entry.name,
          });
        } else {
          logger.warn("storage-recovery", "trash manifest unparsable; kept for now", error as Error, {
            entry: entry.name,
          });
        }
        continue;
      }
      const payload = path.join(REPORT_TRASH_DIR, manifest.payload);
      const exists = await client.query(`SELECT 1 FROM "user" WHERE id = $1`, [
        manifest.userId,
      ]);
      if (exists.rowCount === 0) {
        await removeTrashedDir(payload, manifestPath);
        continue;
      }
      const original = userReportsDir(manifest.userId);
      try {
        await restoreTrashedDir(original, payload, manifestPath);
        logger.warn("storage-recovery", "restored storage data with uncommitted delete", {
          kind: manifest.kind,
          userId: manifest.userId,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await fs.rm(manifestPath, { force: true });
          continue;
        }
        // 绝不覆盖已存在的线上目录：两份都保留给运维排查，
        // 而不是猜测哪一份才是权威数据。
        logger.error("storage-recovery", "trash restore failed; data kept", error as Error, {
          kind: manifest.kind,
          userId: manifest.userId,
        });
      }
    }
    const known = new Set(
      manifests.flatMap((entry) => [entry.name, entry.name.replace(/\.json$/, ".data")]),
    );
    const unknown = entries.filter((entry) => !known.has(entry.name));
    let removedUnknown = 0;
    for (const entry of unknown) {
      const full = path.join(REPORT_TRASH_DIR, entry.name);
      if (!(await isOlderThan(full, recoveryRetentionMs()))) continue;
      await fs.rm(full, { recursive: true, force: true, maxRetries: 3 });
      removedUnknown += 1;
    }
    if (unknown.length > removedUnknown) {
      logger.warn("storage-recovery", "manifest-less trash data kept until retention ends", {
        count: unknown.length - removedUnknown,
      });
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [globalKey])
      .catch(() => {});
    client.release();
  }
}

function positiveEnvMs(name: string, fallbackMinutes: number): number {
  const minutes = Number(process.env[name] ?? fallbackMinutes);
  return Number.isFinite(minutes) && minutes > 0
    ? minutes * 60 * 1000
    : fallbackMinutes * 60 * 1000;
}

function orphanGraceMs(): number {
  return positiveEnvMs("STORAGE_ORPHAN_GRACE_MINUTES", 60);
}

function recoveryRetentionMs(): number {
  const hours = Number(process.env.STORAGE_RECOVERY_RETENTION_HOURS ?? 168);
  return (Number.isFinite(hours) && hours > 0 ? hours : 168) * 60 * 60 * 1000;
}

async function isOlderThan(full: string, ageMs: number): Promise<boolean> {
  try {
    const stat = await fs.lstat(full);
    return Date.now() - stat.mtimeMs >= ageMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removeIfStale(full: string, graceMs: number): Promise<boolean> {
  if (!(await isOlderThan(full, graceMs))) return false;
  await fs.rm(full, { recursive: true, force: true, maxRetries: 3 });
  return true;
}

/**
 * 用数据库指针核对持久卷。只清理超过宽限期的数据，
 * 避免把正在流式写入/暂存的上传误判为孤儿；全站存储锁
 * 在所有实例间关闭「先落盘、后切库」的短暂窗口。
 */
export async function purgeOrphanedReportStorage(): Promise<{ removed: number }> {
  const client = await db.connect();
  const globalKey = "storage-quota:global";
  let removed = 0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      globalKey,
    ]);
    await fs.mkdir(REPORT_DATA_DIR, { recursive: true });
    const [{ rows: reports }, { rows: users }] = await Promise.all([
      client.query<{
        user_id: string;
        storage_key: string | null;
      }>(`SELECT user_id, storage_key FROM reports`),
      client.query<{ id: string }>(`SELECT id FROM "user"`),
    ]);
    const knownUsers = new Set(users.map((row) => row.id));
    const currentArtifacts = new Set(
      reports
        .filter((row) => row.storage_key)
        .map((row) => `${row.user_id}\0${row.storage_key}`),
    );
    const grace = orphanGraceMs();
    const userEntries = await fs.readdir(REPORT_DATA_DIR, { withFileTypes: true });

    for (const userEntry of userEntries) {
      if (!userEntry.isDirectory() || userEntry.name === ".trash") continue;
      const userId = userEntry.name;
      const userDir = userReportsDir(userId);
      if (!knownUsers.has(userId)) {
        if (await removeIfStale(userDir, grace)) removed += 1;
        continue;
      }
      const entries = await fs.readdir(userDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(userDir, entry.name);
        if (entry.name === ".staging") {
          const staged = await fs.readdir(full, { withFileTypes: true }).catch(() => []);
          for (const item of staged) {
            if (await removeIfStale(path.join(full, item.name), grace)) removed += 1;
          }
          continue;
        }
        if (entry.name === "artifacts") {
          const artifacts = await fs.readdir(full, { withFileTypes: true }).catch(() => []);
          for (const item of artifacts) {
            if (currentArtifacts.has(`${userId}\0${item.name}`)) continue;
            if (await removeIfStale(path.join(full, item.name), grace)) removed += 1;
          }
          continue;
        }
        if (await removeIfStale(full, grace)) removed += 1;
      }
    }

    const osEntries = await fs.readdir(tmpdir(), { withFileTypes: true });
    for (const entry of osEntries) {
      if (!entry.name.startsWith("surge-upload-")) continue;
      if (await removeIfStale(path.join(tmpdir(), entry.name), grace)) removed += 1;
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [globalKey])
      .catch(() => {});
    client.release();
  }
  if (removed > 0) logger.info("storage", "orphaned storage purged", { removed });
  return { removed };
}
