import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  REPORT_DATA_DIR,
  REPORT_DEMO_TEMPLATES_DIR,
  assertSafeReportSlug,
  demoTemplateDir,
  reportArtifactDir,
  reportArtifactsDir,
  reportContentDir,
  userReportsDir,
} from "@/features/reports/storage/report-storage";

describe("report storage path boundaries", () => {
  it("为合法用户和 slug 生成根目录内路径", () => {
    expect(userReportsDir("user-1")).toBe(path.join(REPORT_DATA_DIR, "user-1"));
    expect(() => assertSafeReportSlug("r_1234")).not.toThrow();
  });

  it.each(["", ".", "..", "../other", "a/b", "a\\b", "a\0b"])(
    "拒绝非法报告 slug %j",
    (slug) => {
      expect(() => assertSafeReportSlug(slug)).toThrow();
    },
  );

  it.each(["", ".", "..", "../other", "a/b", "a\\b", "a\0b"])(
    "拒绝非法用户 ID %j",
    (userId) => {
      expect(() => userReportsDir(userId)).toThrow();
    },
  );

  it("共享模板只能通过服务端允许列表解析", () => {
    expect(demoTemplateDir("tpl-01")).toBe(
      path.join(REPORT_DEMO_TEMPLATES_DIR, "tpl-01"),
    );
    expect(() => demoTemplateDir("../users")).toThrow();
    expect(
      reportContentDir({
        userId: "user-1",
        templateKey: "tpl-02",
      }),
    ).toBe(path.join(REPORT_DEMO_TEMPLATES_DIR, "tpl-02"));
  });

  it("不可变报告版本只能通过服务端格式的 storage key 解析", () => {
    const key = "a_0123456789abcdef0123456789abcdef";
    expect(reportArtifactDir("user-1", key)).toBe(
      path.join(reportArtifactsDir("user-1"), key),
    );
    expect(
      reportContentDir({
        userId: "user-1",
        storageKey: key,
      }),
    ).toBe(path.join(REPORT_DATA_DIR, "user-1", "artifacts", key));
    expect(() => reportArtifactDir("user-1", "../r_1234")).toThrow();
    expect(() => reportArtifactDir("user-1", "a_not-hex")).toThrow();
  });

  it("拒绝没有内容指针的报告", () => {
    expect(() => reportContentDir({ userId: "user-1" })).toThrow(
      "Report content pointer is missing",
    );
  });
});
