import { promises as fs } from "node:fs";
import path from "node:path";

const PLATFORM_REPORT_FIXTURE_ROOT = path.join(
  process.cwd(),
  "e2e",
  "fixtures",
  "platform-reports",
);

export const PLATFORM_REPORT_FIXTURES = {
  reportA: path.join(PLATFORM_REPORT_FIXTURE_ROOT, "report-a"),
  reportB: path.join(PLATFORM_REPORT_FIXTURE_ROOT, "report-b"),
} as const;

/** 将仓库内的确定性报告夹具复制到隔离的运行时报告目录。 */
export async function copyReportFixture(
  sourceDir: string,
  targetDir: string,
): Promise<number> {
  await fs.mkdir(targetDir, { recursive: true });
  let total = 0;
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      total += await copyReportFixture(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    await fs.copyFile(from, to);
    total += (await fs.stat(from)).size;
  }

  return total;
}
