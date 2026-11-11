import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "../../src/shared/runtime/graceful-shutdown.js";

describe("graceful shutdown", () => {
  it("para scheduler, fecha HTTP e desconecta banco uma única vez", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const scheduler = { stop: vi.fn() };
    const database = { close: vi.fn().mockResolvedValue(undefined) };
    const shutdown = createGracefulShutdown(server, database, scheduler);
    await Promise.all([shutdown(), shutdown()]);
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(database.close).toHaveBeenCalledTimes(1);
  });
});
