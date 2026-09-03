import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/infrastructure/database/client", () => ({ db: { connect: mocks.connect } }));
vi.mock("@/infrastructure/logging/logger", () => ({ logger: { info: mocks.info } }));

function clientFor(options?: {
  column?: "missing" | "nullable" | "required";
  unsupportedProvider?: boolean;
  invalidData?: boolean;
}) {
  const column = options?.column ?? "missing";
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
    if (sql.includes("information_schema.columns")) {
      return {
        rows:
          column === "missing"
            ? []
            : [{ is_nullable: column === "nullable" ? "YES" : "NO" }],
      };
    }
    if (sql.includes(`SELECT DISTINCT "providerId"`)) {
      return {
        rows: options?.unsupportedProvider
          ? [{ provider_id: "unexpected-provider" }]
          : [],
      };
    }
    if (sql.includes("UPDATE account")) {
      return { rows: [], rowCount: column === "required" ? 0 : 1 };
    }
    if (sql.includes("AS invalid")) {
      return { rows: [{ invalid: options?.invalidData ?? false }] };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query, release: vi.fn() };
}

describe("Better Auth 1.7 account issuer 迁移", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.connect.mockReset();
    mocks.info.mockReset();
  });

  it("为 1.6 credential 账号回填 issuer 后收紧为必填", async () => {
    const client = clientFor();
    mocks.connect.mockResolvedValue(client);
    const { ensureBetterAuthSchemaCompatible } = await import(
      "@/infrastructure/auth/better-auth-migration"
    );

    await ensureBetterAuthSchemaCompatible();

    const statements = client.query.mock.calls.map(([sql]) => sql).join("\n");
    expect(statements).toContain("ADD COLUMN issuer TEXT");
    expect(statements).toContain("SET issuer = $1");
    expect(statements).toContain("ALTER COLUMN issuer SET NOT NULL");
    expect(statements).toContain("COMMIT");
    expect(mocks.info).toHaveBeenCalledWith(
      "better-auth-migration",
      "account issuer migration applied",
    );
  });

  it("已完成迁移时不重复执行 DDL", async () => {
    const client = clientFor({ column: "required" });
    mocks.connect.mockResolvedValue(client);
    const { ensureBetterAuthSchemaCompatible } = await import(
      "@/infrastructure/auth/better-auth-migration"
    );

    await ensureBetterAuthSchemaCompatible();

    const statements = client.query.mock.calls.map(([sql]) => sql).join("\n");
    expect(statements).not.toContain("ADD COLUMN issuer TEXT");
    expect(statements).not.toContain("ALTER COLUMN issuer SET NOT NULL");
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("遇到未知 provider 时回滚并拒绝猜测 issuer", async () => {
    const client = clientFor({ unsupportedProvider: true });
    mocks.connect.mockResolvedValue(client);
    const { ensureBetterAuthSchemaCompatible } = await import(
      "@/infrastructure/auth/better-auth-migration"
    );

    await expect(ensureBetterAuthSchemaCompatible()).rejects.toThrow(
      "requires a reviewed provider mapping",
    );

    const statements = client.query.mock.calls.map(([sql]) => sql).join("\n");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("ALTER COLUMN issuer SET NOT NULL");
  });
});
