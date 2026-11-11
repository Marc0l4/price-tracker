import { createReadApiServer } from "./read-api.server.js";
import { loadProjectEnv } from "../shared/config/load-project-env.js";
import { collectionEnvironmentFromEnvironment, readApiEnvironmentFromEnvironment } from "../shared/config/environment.js";
import { createCollectionOrchestrator, createCollectionScheduler } from "../index.js";
import type { CollectionScheduler } from "../collection/collection-scheduler.js";
import { createGracefulShutdown } from "../shared/runtime/graceful-shutdown.js";
import { createPrismaClient } from "../infrastructure/database/prisma-client.js";

loadProjectEnv();

const configuration = readApiEnvironmentFromEnvironment();
const port = configuration.apiPort;

const database = createPrismaClient(configuration.databaseUrl);
const server = createReadApiServer(database.client, { corsOrigin: configuration.corsOrigin, version: process.env.npm_package_version });
let scheduler: CollectionScheduler | undefined;

if (configuration.schedulerEnabled) {
  const collectionConfiguration = collectionEnvironmentFromEnvironment();
  scheduler = createCollectionScheduler(createCollectionOrchestrator(database.client, collectionConfiguration), collectionConfiguration);
}

const shutdown = createGracefulShutdown(server, database, scheduler);
server.listen(port, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "read_api_started", port, schedulerEnabled: configuration.schedulerEnabled }));
  if (scheduler) void scheduler.start().catch(() => console.error(JSON.stringify({ event: "scheduler.start_failed" })));
});

function stop(signal: "SIGINT" | "SIGTERM"): void {
  console.info(JSON.stringify({ event: "shutdown.started", signal }));
  void shutdown().then(() => console.info(JSON.stringify({ event: "shutdown.finished", signal }))).catch(() => process.exitCode = 1);
}
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("uncaughtException", () => { console.error(JSON.stringify({ event: "process.uncaught_exception" })); void shutdown().finally(() => process.exit(1)); });
process.once("unhandledRejection", () => { console.error(JSON.stringify({ event: "process.unhandled_rejection" })); void shutdown().finally(() => process.exit(1)); });
