import { createReadApiServer } from "./read-api.server.js";
import { loadProjectEnv } from "../shared/config/load-project-env.js";
import { collectionEnvironmentFromEnvironment, readApiEnvironmentFromEnvironment } from "../shared/config/environment.js";
import { createCollectionOrchestrator, createCollectionScheduler } from "../index.js";
import type { CollectionScheduler } from "../collection/collection-scheduler.js";
import { createGracefulShutdown } from "../shared/runtime/graceful-shutdown.js";
import { createPrismaClient } from "../infrastructure/database/prisma-client.js";
import { OnDemandProductSearchService } from "../read/on-demand-product-search.service.js";

loadProjectEnv();

const configuration = readApiEnvironmentFromEnvironment();
const port = configuration.apiPort;

const database = createPrismaClient(configuration.databaseUrl);
let scheduler: CollectionScheduler | undefined;
let onDemandSearch: OnDemandProductSearchService | undefined;
let collectionConfiguration;

if (configuration.schedulerEnabled || configuration.onDemandCollectionEnabled) {
  collectionConfiguration = collectionEnvironmentFromEnvironment();
  const orchestrator = createCollectionOrchestrator(database.client, collectionConfiguration);
  if (configuration.schedulerEnabled) scheduler = createCollectionScheduler(orchestrator, collectionConfiguration);
  if (configuration.onDemandCollectionEnabled) {
    onDemandSearch = new OnDemandProductSearchService(database.client, orchestrator, {
      enabled: true,
      ttlMs: configuration.onDemandCollectionTtlMs,
      rateLimitMax: configuration.onDemandRateLimitMax,
      rateLimitWindowMs: configuration.onDemandRateLimitWindowMs,
    });
  }
}

const server = createReadApiServer(database.client, {
  corsOrigin: configuration.corsOrigin,
  version: process.env.npm_package_version,
  onDemandSearch,
  onDemandTrustProxy: configuration.onDemandTrustProxy,
});

const shutdown = createGracefulShutdown(server, database, scheduler);
server.listen(port, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "read_api_started", port, schedulerEnabled: configuration.schedulerEnabled, onDemandCollectionEnabled: configuration.onDemandCollectionEnabled }));
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
