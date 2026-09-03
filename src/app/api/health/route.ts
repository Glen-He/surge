import { db } from "@/infrastructure/database/client";
import { constants, promises as fs } from "node:fs";
import { REPORT_DATA_DIR } from "@/features/reports/storage/report-storage";
import {
  availableBytes,
  STORAGE_MIN_FREE_BYTES,
} from "@/features/reports/storage/storage-capacity";

export async function GET() {
  try {
    const [maintenance, freeBytes] = await Promise.all([
      db.query<{ last_succeeded_at: Date | null; last_error: string | null }>(
        `SELECT last_succeeded_at, last_error FROM maintenance_state WHERE name = 'full'`,
      ),
      (async () => {
        await fs.access(REPORT_DATA_DIR, constants.R_OK | constants.W_OK);
        return availableBytes(REPORT_DATA_DIR);
      })(),
    ]);
    if (freeBytes < STORAGE_MIN_FREE_BYTES) throw new Error("storage low");
    const state = maintenance.rows[0];
    const maintenanceAgeSeconds = state?.last_succeeded_at
      ? Math.max(0, Math.round((Date.now() - state.last_succeeded_at.getTime()) / 1000))
      : null;
    return Response.json(
      {
        status: "ok",
        maintenance: {
          lastSucceededAt: state?.last_succeeded_at ?? null,
          ageSeconds: maintenanceAgeSeconds,
          lastError: state?.last_error ?? null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
