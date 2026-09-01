import { describe, expect, it } from "vitest";
import {
  applyReportOrder,
  moveReportToDateIndex,
  reportOrderItems,
  sameReportOrder,
} from "@/lib/report-drag-layout";

const reports = [
  { slug: "a", date: "2026-08-28", title: "A" },
  { slug: "b", date: "2026-08-28", title: "B" },
  { slug: "c", date: "2026-08-26", title: "C" },
  { slug: "d", date: "2026-08-26", title: "D" },
];

describe("moveReportToDateIndex", () => {
  it("同一天内只调整手动顺序", () => {
    expect(moveReportToDateIndex(reports, "a", "2026-08-28", 2)).toEqual([
      reports[1],
      reports[0],
      reports[2],
      reports[3],
    ]);
  });

  it("向较新日期移动时继承目标日期", () => {
    const next = moveReportToDateIndex(reports, "c", "2026-08-28", 0);
    expect(reportOrderItems(next)).toEqual([
      { slug: "c", date: "2026-08-28" },
      { slug: "a", date: "2026-08-28" },
      { slug: "b", date: "2026-08-28" },
      { slug: "d", date: "2026-08-26" },
    ]);
  });

  it("向较旧日期移动时可插入组内任意位置", () => {
    const next = moveReportToDateIndex(reports, "a", "2026-08-26", 1);
    expect(reportOrderItems(next)).toEqual([
      { slug: "b", date: "2026-08-28" },
      { slug: "c", date: "2026-08-26" },
      { slug: "a", date: "2026-08-26" },
      { slug: "d", date: "2026-08-26" },
    ]);
  });

  it("支持第一位和最后一位插入槽", () => {
    expect(
      reportOrderItems(moveReportToDateIndex(reports, "a", "2026-08-26", 0)),
    ).toEqual([
      { slug: "b", date: "2026-08-28" },
      { slug: "a", date: "2026-08-26" },
      { slug: "c", date: "2026-08-26" },
      { slug: "d", date: "2026-08-26" },
    ]);
    expect(
      reportOrderItems(moveReportToDateIndex(reports, "a", "2026-08-26", 2)),
    ).toEqual([
      { slug: "b", date: "2026-08-28" },
      { slug: "c", date: "2026-08-26" },
      { slug: "d", date: "2026-08-26" },
      { slug: "a", date: "2026-08-26" },
    ]);
  });

  it("目标日期暂时为空时仍按日期倒序插入", () => {
    const next = moveReportToDateIndex(
      reports.filter((report) => report.slug !== "c"),
      "a",
      "2026-08-27",
      0,
    );
    expect(reportOrderItems(next)).toEqual([
      { slug: "b", date: "2026-08-28" },
      { slug: "a", date: "2026-08-27" },
      { slug: "d", date: "2026-08-26" },
    ]);
  });

  it("项目无效或位置没有变化时保留原数组", () => {
    expect(moveReportToDateIndex(reports, "missing", "2026-08-28", 0)).toBe(
      reports,
    );
    expect(moveReportToDateIndex(reports, "a", "2026-08-28", 0)).toBe(
      reports,
    );
  });
});

describe("报告顺序同步", () => {
  it("能应用服务器标准顺序并同步日期", () => {
    expect(
      applyReportOrder(reports, [
        { slug: "c", date: "2026-08-28" },
        { slug: "a", date: "2026-08-28" },
        { slug: "b", date: "2026-08-28" },
        { slug: "d", date: "2026-08-26" },
      ]),
    ).toEqual([
      { ...reports[2], date: "2026-08-28" },
      reports[0],
      reports[1],
      reports[3],
    ]);
  });

  it("拒绝缺失项目的服务器顺序", () => {
    expect(
      applyReportOrder(reports, [{ slug: "a", date: "2026-08-28" }]),
    ).toBeNull();
  });

  it("顺序比较同时检查 slug 和日期", () => {
    expect(sameReportOrder(reports, [...reports])).toBe(true);
    expect(
      sameReportOrder(reports, [reports[1], reports[0], reports[2], reports[3]]),
    ).toBe(false);
    expect(
      sameReportOrder(reports, [
        { ...reports[0], date: "2026-08-27" },
        reports[1],
        reports[2],
        reports[3],
      ]),
    ).toBe(false);
  });
});
