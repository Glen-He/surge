import { describe, expect, it } from "vitest";
import {
  moveReportToTargetDate,
  reportDropPosition,
} from "@/lib/report-order";

const reports = [
  { slug: "a", date: "2026-08-28", title: "A" },
  { slug: "b", date: "2026-08-28", title: "B" },
  { slug: "c", date: "2026-08-26", title: "C" },
  { slug: "d", date: "2026-08-26", title: "D" },
];

describe("moveReportToTargetDate", () => {
  it("同一天内只调整手动顺序", () => {
    expect(moveReportToTargetDate(reports, "a", "b")).toEqual([
      reports[1],
      reports[0],
      reports[2],
      reports[3],
    ]);
  });

  it("向较新日期拖动时继承目标日期", () => {
    const next = moveReportToTargetDate(reports, "c", "a");
    expect(next.map(({ slug, date }) => ({ slug, date }))).toEqual([
      { slug: "c", date: "2026-08-28" },
      { slug: "a", date: "2026-08-28" },
      { slug: "b", date: "2026-08-28" },
      { slug: "d", date: "2026-08-26" },
    ]);
  });

  it("向较旧日期拖动时继承目标日期", () => {
    const next = moveReportToTargetDate(reports, "a", "c");
    expect(next.map(({ slug, date }) => ({ slug, date }))).toEqual([
      { slug: "b", date: "2026-08-28" },
      { slug: "c", date: "2026-08-26" },
      { slug: "a", date: "2026-08-26" },
      { slug: "d", date: "2026-08-26" },
    ]);
  });

  it("目标无效时保持原数组", () => {
    expect(moveReportToTargetDate(reports, "a", "missing")).toBe(reports);
  });
});

describe("reportDropPosition", () => {
  it("向后拖时占位在目标之后", () => {
    expect(reportDropPosition(reports, "a", "c")).toBe("after");
  });

  it("向前拖时占位在目标之前", () => {
    expect(reportDropPosition(reports, "d", "b")).toBe("before");
  });
});
