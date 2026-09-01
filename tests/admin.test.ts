import { describe, expect, it } from "vitest";
import { hasAdminRole } from "@/lib/admin";

describe("管理员角色", () => {
  it("只接受独立的 admin 角色标记", () => {
    expect(hasAdminRole({ role: "admin" })).toBe(true);
    expect(hasAdminRole({ role: "user, admin" })).toBe(true);
    expect(hasAdminRole({ role: "user" })).toBe(false);
    expect(hasAdminRole({ role: "administrator" })).toBe(false);
    expect(hasAdminRole({ role: null })).toBe(false);
  });
});
