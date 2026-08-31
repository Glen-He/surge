import { promises as fs } from "node:fs";

export const STORAGE_MIN_FREE_BYTES = Number(
  process.env.STORAGE_MIN_FREE_BYTES ?? 512 * 1024 * 1024,
);

export class StorageCapacityError extends Error {
  constructor() {
    super("服务器可用存储空间不足，上传暂停，请联系管理员");
    this.name = "StorageCapacityError";
  }
}

export function validateStorageSettings(): void {
  if (
    !Number.isSafeInteger(STORAGE_MIN_FREE_BYTES) ||
    STORAGE_MIN_FREE_BYTES < 64 * 1024 * 1024
  ) {
    throw new Error("STORAGE_MIN_FREE_BYTES 必须是至少 67108864 的整数");
  }
}

export async function availableBytes(dir: string): Promise<number> {
  const stats = await fs.statfs(dir, { bigint: true });
  const bytes = stats.bavail * stats.bsize;
  return bytes > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(bytes);
}

/** Reserve enough headroom for the incoming bytes and normal server operation. */
export async function ensureStorageHeadroom(
  dir: string,
  incomingBytes: number,
): Promise<void> {
  if ((await availableBytes(dir)) < STORAGE_MIN_FREE_BYTES + incomingBytes) {
    throw new StorageCapacityError();
  }
}
