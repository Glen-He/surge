import { db } from "@/lib/db";
import { constants, promises as fs } from "node:fs";
import { REPORT_USERS_DIR } from "@/lib/report-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await Promise.all([
      db.query("SELECT 1"),
      fs.access(REPORT_USERS_DIR, constants.R_OK | constants.W_OK),
    ]);
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
