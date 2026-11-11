import { CollectionRunStatus, CollectionTrigger, ProviderCollectionRunStatus, type PrismaClient, type TrackedSearch } from "../generated/prisma/client.js";
import { ProductMatchingService } from "../matching/product-matching.service.js";
import type { SourcedProduct } from "../persistence/persistence-contracts.js";
import { CollectionRunRepository } from "./repositories/collection-run.repository.js";
import { TrackedSearchRepository } from "./repositories/tracked-search.repository.js";
import type { CollectionExecutionResult, CollectionLogger, CollectionPersistencePort, CollectionSearchPort, ProviderRunCompletion } from "./collection-contracts.js";
import { StructuredCollectionLogger } from "./collection-logger.js";

export interface CollectionOrchestratorOptions {
  collectionTimeoutMs?: number;
  staleRunMs?: number;
}

const DEFAULT_COLLECTION_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_RUN_MS = 60 * 60 * 1_000;

function safeTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

function httpStatus(message: string | undefined): number | undefined {
  const match = message?.match(/HTTP\s+(\d{3})/i);
  return match ? Number(match[1]) : undefined;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class CollectionOrchestrator {
  private readonly trackedSearches: TrackedSearchRepository;
  private readonly runs: CollectionRunRepository;
  private readonly inFlightSearches = new Set<string>();
  private readonly collectionTimeoutMs: number;
  private readonly staleRunMs: number;

  constructor(
    db: PrismaClient,
    private readonly search: CollectionSearchPort,
    private readonly persistence: CollectionPersistencePort,
    private readonly matching = new ProductMatchingService(),
    private readonly logger: CollectionLogger = new StructuredCollectionLogger(),
    options: CollectionOrchestratorOptions = {},
  ) {
    this.trackedSearches = new TrackedSearchRepository(db);
    this.runs = new CollectionRunRepository(db);
    this.collectionTimeoutMs = safeTimeout(options.collectionTimeoutMs, DEFAULT_COLLECTION_TIMEOUT_MS);
    this.staleRunMs = safeTimeout(options.staleRunMs, DEFAULT_STALE_RUN_MS);
  }

  async runManual(query: string): Promise<CollectionExecutionResult> {
    const trackedSearch = await this.trackedSearches.ensure(query);
    return this.runTrackedSearch(trackedSearch.id, CollectionTrigger.manual);
  }

  async runScheduled(): Promise<CollectionExecutionResult[]> {
    const trackedSearches = await this.trackedSearches.findActive();
    const results: CollectionExecutionResult[] = [];
    for (const trackedSearch of trackedSearches)
      results.push(await this.runTrackedSearch(trackedSearch.id, CollectionTrigger.scheduled));
    return results;
  }

  async runTrackedSearch(trackedSearchId: string, trigger: CollectionTrigger): Promise<CollectionExecutionResult> {
    const trackedSearch = await this.trackedSearches.findById(trackedSearchId);
    if (!trackedSearch) {
      this.logger.info("collection.failed", { stage: "tracked_search_resolution", code: "not_found", trigger });
      throw new Error("TrackedSearch não encontrada.");
    }
    if (!trackedSearch.active) {
      this.logger.info("collection.skipped_inactive", { trackedSearchId, trigger });
      return { status: "skipped_inactive" };
    }
    if (this.inFlightSearches.has(trackedSearch.id)) {
      this.logger.info("collection.skipped_overlap", { trackedSearchId, query: trackedSearch.query, trigger });
      return { status: "skipped_overlap" };
    }
    this.inFlightSearches.add(trackedSearch.id);
    try {
      const startedAt = new Date();
      const run = await this.runs.start(trackedSearch.id, trackedSearch.query, trigger, startedAt);
      return await this.executeSafely(run, trackedSearch);
    } finally {
      this.inFlightSearches.delete(trackedSearch.id);
    }
  }

  async retry(runId: string): Promise<CollectionExecutionResult> {
    const previous = await this.runs.findWithTrackedSearch(runId);
    if (!previous) throw new Error("CollectionRun não encontrada.");
    if (!previous.trackedSearch.active) {
      this.logger.info("collection.skipped_inactive", { collectionRunId: runId, query: previous.query, trigger: "manual" });
      return { status: "skipped_inactive" };
    }
    if (this.inFlightSearches.has(previous.trackedSearchId)) {
      this.logger.info("collection.skipped_overlap", { collectionRunId: runId, query: previous.query, trigger: "manual" });
      return { status: "skipped_overlap" };
    }
    this.inFlightSearches.add(previous.trackedSearchId);
    try {
      const restarted = await this.runs.restart(runId, new Date());
      return await this.executeSafely(restarted.run, restarted.trackedSearch);
    } finally {
      this.inFlightSearches.delete(previous.trackedSearchId);
    }
  }

  async recoverInterruptedRuns(now = new Date()): Promise<number> {
    const recovered = await this.runs.recoverInterrupted(new Date(now.getTime() - this.staleRunMs), now);
    if (recovered) this.logger.info("collection.recovered_interrupted", { recovered });
    return recovered;
  }

  private async executeSafely(
    run: { id: string; collectionKey: string; attempt: number; startedAt: Date; attemptStartedAt: Date },
    trackedSearch: TrackedSearch,
  ): Promise<CollectionExecutionResult> {
    try {
      return await this.execute(run, trackedSearch);
    } catch {
      const finished = await this.runs.failUnexpected(run.id, run.attempt, run.attemptStartedAt, new Date(), "orchestrator_error");
      this.logger.info("collection.failed", { collectionRunId: run.id, query: trackedSearch.query, status: "failed", stage: "orchestrator", code: "orchestrator_error" });
      return { status: CollectionRunStatus.failed, collectionRun: finished };
    }
  }

  private async execute(run: { id: string; collectionKey: string; attempt: number; startedAt: Date; attemptStartedAt: Date }, trackedSearch: TrackedSearch): Promise<CollectionExecutionResult> {
    const providers = this.search.providerNames;
    await this.runs.createProviderRuns(run.id, run.attempt, providers, run.attemptStartedAt);
    this.logger.info("collection.providers_started", {
      collectionRunId: run.id,
      query: trackedSearch.query,
      stage: "provider_search",
      providers: providers.join(","),
    });
    this.logger.info("collection.started", { collectionRunId: run.id, query: trackedSearch.query, attempt: run.attempt });

    let detailed;
    try {
      detailed = await withTimeout(this.search.searchDetailed(trackedSearch.query), this.collectionTimeoutMs);
    } catch {
      detailed = undefined;
    }
    if (!detailed) return this.finishTimeout(run, trackedSearch, providers);

    const providerCompletions: ProviderRunCompletion[] = detailed.providers.map((provider) => ({
      provider: provider.provider,
      status: provider.status === "success" ? ProviderCollectionRunStatus.success : ProviderCollectionRunStatus.failed,
      startedAt: provider.startedAt,
      finishedAt: provider.finishedAt,
      durationMs: provider.durationMs,
      resultCount: provider.status === "success" ? provider.products.length : undefined,
      errorCode: provider.error?.code,
    }));
    await this.runs.completeProviderRuns(run.id, run.attempt, providerCompletions);

    for (const provider of detailed.providers) {
      if (provider.status === "failed") {
        this.logger.info("collection.provider_failed", {
          collectionRunId: run.id,
          query: trackedSearch.query,
          provider: provider.provider,
          code: provider.error?.code,
          httpStatus: httpStatus(provider.error?.message),
          message: provider.error?.message,
          durationMs: provider.durationMs,
        });
      }
    }

    const successfulProviders = detailed.providers.filter((provider) => provider.status === "success");
    const sourcedProducts: SourcedProduct[] = successfulProviders.flatMap((provider) =>
      provider.products.map((product) => ({ provider: provider.provider, product })));
    const matchedGroupCount = this.matching.group(sourcedProducts.map(({ product }) => product)).length;
    let persistedGroupCount = 0;
    let failedGroupCount = 0;
    let persistenceFailed = false;
    try {
      const persisted = await this.persistence.persist(sourcedProducts, {
        collectionKey: run.collectionKey,
        // A retry is the same logical observation, not a newer observation.
        collectedAt: run.startedAt,
        successfulProviders: successfulProviders.map((provider) => provider.provider),
        lifecycleScopeId: trackedSearch.id,
      });
      persistedGroupCount = persisted.succeeded.length;
      failedGroupCount = persisted.failed.length;
      persistenceFailed = failedGroupCount > 0;
    } catch {
      persistenceFailed = true;
      failedGroupCount = Math.max(1, matchedGroupCount);
    }

    const finishedAt = new Date();
    const hasProviderFailure = successfulProviders.length !== detailed.providers.length;
    const status = successfulProviders.length === 0 ? CollectionRunStatus.failed :
      hasProviderFailure || persistenceFailed ? CollectionRunStatus.partial : CollectionRunStatus.completed;
    const finished = await this.runs.finish(run.id, status, run.attemptStartedAt, finishedAt, {
      productsReceived: sourcedProducts.length,
      matchedGroupCount,
      persistedGroupCount,
      failedGroupCount,
    }, status === CollectionRunStatus.failed ? "all_providers_failed" : persistenceFailed ? "persistence_partial" : undefined);
    if (successfulProviders.length) await this.trackedSearches.markCollected(trackedSearch.id, finishedAt);
    this.logger.info("collection.finished", {
      collectionRunId: run.id,
      query: trackedSearch.query,
      status,
      durationMs: finished.durationMs ?? 0,
      productsReceived: sourcedProducts.length,
      persistedGroupCount,
      failedGroupCount,
    });
    return { status, collectionRun: finished };
  }

  private async finishTimeout(
    run: { id: string; attempt: number; startedAt: Date; attemptStartedAt: Date },
    trackedSearch: TrackedSearch,
    providers: string[],
  ): Promise<CollectionExecutionResult> {
    const finishedAt = new Date();
    await this.runs.completeProviderRuns(run.id, run.attempt, providers.map((provider) => ({
      provider,
      status: ProviderCollectionRunStatus.failed,
      startedAt: run.attemptStartedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - run.attemptStartedAt.getTime()),
      errorCode: "timeout",
    })));
    const finished = await this.runs.finish(run.id, CollectionRunStatus.failed, run.attemptStartedAt, finishedAt, {
      productsReceived: 0, matchedGroupCount: 0, persistedGroupCount: 0, failedGroupCount: 0,
    }, "timeout");
    this.logger.info("collection.timeout", { collectionRunId: run.id, query: trackedSearch.query, durationMs: finished.durationMs ?? 0 });
    return { status: CollectionRunStatus.failed, collectionRun: finished };
  }
}
