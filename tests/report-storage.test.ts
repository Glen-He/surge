import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  REPORT_DEMO_TEMPLATES_DIR,
  REPORT_USERS_DIR,
  demoTemplateDir,
  reportArtifactDir,
  reportArtifactsDir,
  reportContentDir,
  reportDir,
  userReportsDir,
} from "@/lib/report-storage";

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

  it("共享模板只能通过服务端允许列表解析", () => {
    expect(demoTemplateDir("tpl-01")).toBe(
      path.join(REPORT_DEMO_TEMPLATES_DIR, "tpl-01"),
    );
    expect(() => demoTemplateDir("../users")).toThrow();
    expect(
      reportContentDir({
        userId: "user-1",
        slug: "demo_1234",
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
        slug: "r_1234",
        storageKey: key,
      }),
    ).toBe(path.join(REPORT_USERS_DIR, "user-1", "artifacts", key));
    expect(() => reportArtifactDir("user-1", "../r_1234")).toThrow();
    expect(() => reportArtifactDir("user-1", "a_not-hex")).toThrow();
  });
});
