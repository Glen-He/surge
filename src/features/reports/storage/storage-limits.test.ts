import { describe, expect, it } from "vitest";
import {
  MAX_DEPTH,
  MAX_FILES,
  MAX_PROJECT_BYTES,
  MAX_USER_TOTAL_BYTES,
  MAX_ZIP_BYTES,
  SITE_TOTAL_WARN_BYTES,
  SITE_TOTAL_CAP_BYTES,
} from "@/features/reports/storage/storage-limits";

describe("上传容量常量关系", () => {
  it("全站硬顶为 20 GiB，预警线为 16 GiB", () => {
    expect(SITE_TOTAL_CAP_BYTES).toBe(20 * 1024 ** 3);
    expect(SITE_TOTAL_WARN_BYTES).toBe(16 * 1024 ** 3);
  });

  it("解压后上限 ≥ zip 上限（合理：压缩包可能不压缩）", () => {
    expect(MAX_PROJECT_BYTES).toBeGreaterThanOrEqual(MAX_ZIP_BYTES);
  });

  it("单用户上限 ≤ 全站上限", () => {
    expect(MAX_USER_TOTAL_BYTES).toBeLessThan(SITE_TOTAL_CAP_BYTES);
  });

  it("全站预警线 < 全站硬顶", () => {
    expect(SITE_TOTAL_WARN_BYTES).toBeLessThan(SITE_TOTAL_CAP_BYTES);
  });

  it("文件数与目录深度为正", () => {
    expect(MAX_FILES).toBeGreaterThan(0);
    expect(MAX_DEPTH).toBeGreaterThan(0);
  });
});
