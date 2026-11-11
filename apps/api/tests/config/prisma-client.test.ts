import { describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../../src/infrastructure/database/prisma-client.js";

describe("Prisma database lifecycle", () => {
  it("mantém um pool com timeout explícito e encerra Prisma e pool uma única vez", async () => {
    const database = createPrismaClient("postgresql://user:password@localhost:5432/test?schema=isolated");
    const end = vi.spyOn(database.pool, "end");

    expect(database.pool.options.connectionTimeoutMillis).toBe(5_000);
    expect(database.pool.options.connectionString).not.toContain("schema=");

    const first = database.close();
    const second = database.close();
    expect(second).toBe(first);
    await Promise.all([first, second]);

    expect(end).toHaveBeenCalledTimes(1);
  });
});
