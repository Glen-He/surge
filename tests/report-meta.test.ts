import { describe, expect, it } from "vitest";
import { validateReportMeta, type ReportMeta } from "@/lib/report-upload";

const base: ReportMeta = {
  title: "周报",
  date: "2026-08-27",
  tag: "",
  tagColor: "#DBEAFE",
  description: "",
  keywords: "",
};

describe("validateReportMeta date", () => {
  it("接受真实 ISO 日期", () => {
    expect(validateReportMeta(base)).toBeNull();
    expect(validateReportMeta({ ...base, date: "2024-02-29" })).toBeNull();
  });

  it("拒绝格式错误和不存在的日期", () => {
    expect(validateReportMeta({ ...base, date: "08/27/2026" })).toContain("YYYY-MM-DD");
    expect(validateReportMeta({ ...base, date: "2026-02-30" })).toBe("请填写有效日期");
  });
});
