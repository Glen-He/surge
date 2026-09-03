import { promises as fs } from "node:fs";
import { UploadError } from "@/features/reports/upload/upload-errors";

export const STORAGE_MIN_FREE_BYTES = Number(
  process.env.STORAGE_MIN_FREE_BYTES ?? 512 * 1024 * 1024,
);

/** 磁盘余量不足：错误码 STORAGE_CAPACITY，用户文案由边界层翻译 */
export class StorageCapacityError extends UploadError<"STORAGE_CAPACITY"> {
  constructor() {
    super("STORAGE_CAPACITY");
  }
}

export function validateStorageSettings(): void {
  if (
    !Number.isSafeInteger(STORAGE_MIN_FREE_BYTES) ||
    STORAGE_MIN_FREE_BYTES < 64 * 1024 * 1024
  ) {
    throw new Error("STORAGE_MIN_FREE_BYTES must be an integer >= 67108864");
  }
}

export async function availableBytes(dir: string): Promise<number> {
  const stats = await fs.statfs(dir, { bigint: true });
  const bytes = stats.bavail * stats.bsize;
  return bytes > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(bytes);
}

/** 预留本次写入字节与服务端正常运行所需的磁盘余量，不足即抛错 */
export async function ensureStorageHeadroom(
  dir: string,
  incomingBytes: number,
): Promise<void> {
  if ((await availableBytes(dir)) < STORAGE_MIN_FREE_BYTES + incomingBytes) {
    throw new StorageCapacityError();
  }
}
