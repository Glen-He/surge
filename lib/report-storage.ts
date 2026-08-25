import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "./db";
import { logger } from "./logger";

/**
 * Runtime report data is deliberately separated from source-controlled templates.
 *
 * Production should point REPORTS_DATA_DIR at a persistent volume outside the
 * application checkout/container image. The legacy location remains the local
 * development default so existing workspaces keep working.
 */
export const REPORT_USERS_DIR = path.resolve(
  /* turbopackIgnore: true */
  process.env.REPORTS_DATA_DIR ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "reports", "users"),
);
export const REPORT_TRASH_DIR = path.join(REPORT_USERS_DIR, ".trash");
export const REPORT_SHARED_DIR = path.join(
  process.cwd(),
  "reports",
  "_shared",
);
export const REPORT_TEMPLATES_DIR = path.join(
  process.cwd(),
  "reports",
  "templates",
);
export const REPORT_DEMO_TEMPLATES_DIR = path.join(
  process.cwd(),
  "reports",
  "demo-templates",
);

function assertSafeDataDir(dir: string): void {
  const root = path.parse(dir).root;
  if (dir === root || dir === process.cwd()) {
    throw new Error(`REPORTS_DATA_DIR points at an unsafe broad directory: ${dir}`);
  }
}

assertSafeDataDir(REPORT_USERS_DIR);

export async function validateReportStorageConfiguration(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.REPORTS_DATA_DIR) {
    throw new Error(
      "Production requires REPORTS_DATA_DIR on a persistent volume outside the application checkout",
    );
  }
  // Resolve symlinks as well as lexical `..`: a path that looks external but
  // points back into the checkout is still an unsafe deployment target.
  await fs.mkdir(REPORT_USERS_DIR, { recursive: true });
  const [realCheckout, realData] = await Promise.all([
    fs.realpath(process.cwd()),
    fs.realpath(REPORT_USERS_DIR),
  ]);
  const relative = path.relative(realCheckout, realData);
  if (!relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "Production REPORTS_DATA_DIR must be outside the application checkout",
    );
  }
}

export function userReportsDir(userId: string): string {
  if (!userId || userId === "." || userId === ".." || /[\\/\0]/.test(userId)) {
    throw new Error("Invalid user id for report storage");
  }
  return path.join(/* turbopackIgnore: true */ REPORT_USERS_DIR, userId);
}

/** Resolve one report directory while preserving the user-directory boundary. */
export function reportDir(userId: string, slug: string): string {
  if (!slug || slug === "." || slug === ".." || /[\\/\0]/.test(slug)) {
    throw new Error("Invalid report slug for storage");
  }
  const root = path.resolve(/* turbopackIgnore: true */ userReportsDir(userId));
  const resolved = path.resolve(/* turbopackIgnore: true */ root, slug);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("Report path escapes user storage");
  }
  return resolved;
}

/** Recursive size without following symlinks. Missing directories count as zero. */
export async function dirSizeBytes(dir: string): Promise<number> {
  let rootEntries;
  try {
    rootEntries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  const stack: Array<{ base: string; entries: typeof rootEntries }> = [
    { base: dir, entries: rootEntries },
  ];
  let total = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of current.entries) {
      const full = path.join(current.base, entry.name);
      if (entry.isDirectory()) {
        stack.push({
          base: full,
          entries: await fs.readdir(full, { withFileTypes: true }),
        });
      } else {
        // lstat prevents a legacy/on-disk symlink from escaping the data root.
        total += (await fs.lstat(full)).size;
      }
    }
  }
  return total;
}

type TrashManifest = {
  version: 1;
  kind: "report" | "account" | "guest";
  userId: string;
  slug?: string;
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

export async function moveReportDirToTrash(
  userId: string,
  slug: string,
): Promise<TrashMove> {
  return stageInTrash(reportDir(userId, slug), {
    kind: "report",
    userId,
    slug,
  });
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
    (item.kind === "report" || item.kind === "account" || item.kind === "guest") &&
    typeof item.userId === "string" &&
    typeof item.payload === "string" &&
    /^[0-9a-f-]+\.data$/i.test(item.payload) &&
    (item.kind !== "report" || typeof item.slug === "string")
  );
}

/**
 * Crash recovery for cross-resource deletes. A manifest is persisted before
 * the directory is hidden. At startup, DB state decides whether to restore the
 * payload (delete never committed) or remove it (delete committed).
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
        logger.warn("storage-recovery", "回收区 manifest 无法解析，已保留", error as Error, {
          entry: entry.name,
        });
        continue;
      }
      const payload = path.join(REPORT_TRASH_DIR, manifest.payload);
      const exists =
        manifest.kind === "report"
          ? await client.query(
              `SELECT 1 FROM reports WHERE user_id = $1 AND slug = $2`,
              [manifest.userId, manifest.slug],
            )
          : await client.query(`SELECT 1 FROM "user" WHERE id = $1`, [
              manifest.userId,
            ]);
      if (exists.rowCount === 0) {
        await removeTrashedDir(payload, manifestPath);
        continue;
      }
      const original =
        manifest.kind === "report"
          ? reportDir(manifest.userId, manifest.slug!)
          : userReportsDir(manifest.userId);
      try {
        await restoreTrashedDir(original, payload, manifestPath);
        logger.warn("storage-recovery", "已恢复未提交删除的存储数据", {
          kind: manifest.kind,
          userId: manifest.userId,
          slug: manifest.slug,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await fs.rm(manifestPath, { force: true });
          continue;
        }
        // Never overwrite an existing live directory. Preserve both copies for
        // operator inspection instead of guessing which one is authoritative.
        logger.error("storage-recovery", "回收区数据自动恢复失败，已保留", error as Error, {
          kind: manifest.kind,
          userId: manifest.userId,
          slug: manifest.slug,
        });
      }
    }
    const known = new Set(
      manifests.flatMap((entry) => [entry.name, entry.name.replace(/\.json$/, ".data")]),
    );
    const unknown = entries.filter((entry) => !known.has(entry.name));
    if (unknown.length > 0) {
      logger.warn("storage-recovery", "回收区存在无 manifest 数据，为避免误删已保留", {
        count: unknown.length,
      });
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [globalKey])
      .catch(() => {});
    client.release();
  }
}
