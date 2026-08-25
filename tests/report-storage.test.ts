import { describe, expect, it } from "vitest";
import path from "node:path";
import { REPORT_USERS_DIR, reportDir, userReportsDir } from "@/lib/report-storage";

describe("report storage path boundaries", () => {
  it("为合法用户和 slug 生成根目录内路径", () => {
    expect(userReportsDir("user-1")).toBe(path.join(REPORT_USERS_DIR, "user-1"));
    expect(reportDir("user-1", "r_1234")).toBe(
      path.join(REPORT_USERS_DIR, "user-1", "r_1234"),
    );
  });

  it.each(["", ".", "..", "../other", "a/b", "a\\b", "a\0b"])(
    "拒绝非法报告 slug %j",
    (slug) => {
      expect(() => reportDir("user-1", slug)).toThrow();
    },
  );

  it.each(["", ".", "..", "../other", "a/b", "a\\b", "a\0b"])(
    "拒绝非法用户 ID %j",
    (userId) => {
      expect(() => userReportsDir(userId)).toThrow();
    },
  );
});
