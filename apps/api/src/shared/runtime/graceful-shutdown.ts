import type { Server } from "node:http";

export interface ShutdownScheduler { stop(): void; }
export interface ShutdownDatabase { close(): Promise<void>; }

export function createGracefulShutdown(server: Server, database: ShutdownDatabase, scheduler?: ShutdownScheduler) {
  let stopping: Promise<void> | undefined;
  return async () => {
    if (stopping) return stopping;
    stopping = (async () => {
      scheduler?.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.close();
    })();
    return stopping;
  };
}
