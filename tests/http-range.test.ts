import { describe, expect, it } from "vitest";
import { parseByteRange } from "@/lib/http-range";

describe("parseByteRange", () => {
  it("支持显式、开放和后缀范围", () => {
    expect(parseByteRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
    expect(parseByteRange("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
  });

  it("拒绝多段、倒置和越界范围", () => {
    expect(parseByteRange("bytes=0-1,3-4", 10)).toBeNull();
    expect(parseByteRange("bytes=4-2", 10)).toBeNull();
    expect(parseByteRange("bytes=10-", 10)).toBeNull();
  });
});
