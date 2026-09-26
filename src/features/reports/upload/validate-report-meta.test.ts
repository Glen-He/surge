import { describe, expect, it } from "vitest";
import { metaFromForm, validateReportMeta, type ReportMeta } from "@/features/reports/upload/validate-report-meta";

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
    expect(validateReportMeta({ ...base, date: "08/27/2026" })).toMatchObject({
      ok: false,
      code: "META_DATE_FORMAT",
      params: undefined,
    });
    expect(validateReportMeta({ ...base, date: "2026-02-30" })).toMatchObject({
      ok: false,
      code: "META_DATE_INVALID",
      params: undefined,
    });
  });
});


describe("展示模式校验", () => {
  it("允许缺省、汇报展示与网页发布", () => {
    for (const displayMode of [undefined, "frame", "bare"]) {
      expect(validateReportMeta({ ...base, displayMode })).toBeNull();
    }
  });

  it.each(["", "BARE", "bare ", "website", "<script>"])("拒绝非法模式 %s", (displayMode) => {
    expect(validateReportMeta({ ...base, displayMode })).toEqual({
      ok: false, code: "META_DISPLAY_MODE_INVALID", params: undefined,
    });
  });

  it("表单保留缺省与显式值的区别，不把非法值悄悄回退", () => {
    const form = new FormData();
    expect(metaFromForm(form).displayMode).toBeUndefined();
    form.set("displayMode", "bare");
    expect(metaFromForm(form).displayMode).toBe("bare");
    form.set("displayMode", "");
    expect(metaFromForm(form).displayMode).toBe("");
  });
});
