import { createHash } from "node:crypto";
import { CollectionRunStatus, type PrismaClient } from "../generated/prisma/client.js";
import type { CollectionOrchestrator } from "../collection/collection-orchestrator.js";
import { TrackedSearchRepository, normalizeTrackedQuery } from "../collection/repositories/tracked-search.repository.js";
import { CollectionRunRepository } from "../collection/repositories/collection-run.repository.js";
import type { ProductSearchSort } from "./repositories/product-read.repository.js";
import { ProductQueryService } from "./product-query.service.js";
import { ReadApiError } from "./read-errors.js";
import { OnDemandRateLimitRepository } from "./repositories/on-demand-rate-limit.repository.js";

export interface OnDemandSearchOptions {
  enabled: boolean;
  ttlMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export interface OnDemandProductSearchPort {
  search(
    query: string,
    page: number,
    limit: number,
    currency: string,
    sort: ProductSearchSort,
    clientAddress: string,
  ): ReturnType<ProductQueryService["search"]>;
}

function keyForClient(clientAddress: string): string {
  return createHash("sha256").update(`on-demand-search:${clientAddress || "unknown"}`).digest("hex");
}

function isFresh(lastCollectedAt: Date | null | undefined, now: Date, ttlMs: number): boolean {
  return Boolean(lastCollectedAt && lastCollectedAt.getTime() >= now.getTime() - ttlMs);
}

/**
 * Read-side policy for a logical query. It always returns the persisted model:
 * a collection, when needed, finishes before ProductQueryService reads again.
 */
export class OnDemandProductSearchService implements OnDemandProductSearchPort {
  private readonly trackedSearches: TrackedSearchRepository;
  private readonly collectionRuns: CollectionRunRepository;
  private readonly rateLimits: OnDemandRateLimitRepository;
  private readonly inFlightCollections = new Map<string, Promise<void>>();

  constructor(
    db: PrismaClient,
    private readonly collection: Pick<CollectionOrchestrator, "runOnDemand">,
    private readonly options: OnDemandSearchOptions,
    private readonly products = new ProductQueryService(db),
    private readonly now = () => new Date(),
  ) {
    this.trackedSearches = new TrackedSearchRepository(db);
    this.collectionRuns = new CollectionRunRepository(db);
    this.rateLimits = new OnDemandRateLimitRepository(db);
  }

  async search(query: string, page: number, limit: number, currency: string, sort: ProductSearchSort, clientAddress: string) {
    const normalizedQuery = normalizeTrackedQuery(query);
    if (!normalizedQuery) throw new ReadApiError(400, "invalid_query", "Query é obrigatória.");
    const current = this.now();
    const trackedSearch = await this.trackedSearches.findByQuery(normalizedQuery);

    if (isFresh(trackedSearch?.lastCollectedAt, current, this.options.ttlMs) || !this.options.enabled)
      return this.products.search(normalizedQuery, page, limit, currency, sort);

    // A request joining an existing collection never spends another rate-limit token.
    if (trackedSearch && await this.collectionRuns.findRunningByTrackedSearch(trackedSearch.id))
      return this.readAfterCollection(normalizedQuery, page, limit, currency, sort);

    const inFlight = this.inFlightCollections.get(normalizedQuery);
    if (inFlight) {
      await inFlight;
      return this.products.search(normalizedQuery, page, limit, currency, sort);
    }
    const collection = this.collect(normalizedQuery, clientAddress, current);
    this.inFlightCollections.set(normalizedQuery, collection);
    try {
      await collection;
      return this.products.search(normalizedQuery, page, limit, currency, sort);
    } finally {
      this.inFlightCollections.delete(normalizedQuery);
    }
  }

  private async collect(query: string, clientAddress: string, now: Date): Promise<void> {
    const accepted = await this.rateLimits.consume(keyForClient(clientAddress), this.options.rateLimitMax, this.options.rateLimitWindowMs, now);
    if (!accepted) {
      const retryAfterSeconds = Math.max(1, Math.ceil(this.options.rateLimitWindowMs / 1_000));
      throw new ReadApiError(429, "on_demand_rate_limited", "Limite temporário para novas coletas. Tente novamente em alguns minutos.", retryAfterSeconds);
    }
    await this.waitForCollection(query);
  }

  private async waitForCollection(query: string): Promise<void> {
    const execution = await this.collection.runOnDemand(query);
    if (execution.status === CollectionRunStatus.failed || execution.status === "skipped_inactive")
      throw new ReadApiError(502, "on_demand_collection_failed", "Não foi possível atualizar os preços agora. Tente novamente.");
    if (execution.status === "skipped_overlap")
      throw new ReadApiError(503, "on_demand_collection_in_progress", "A coleta deste produto ainda está em andamento. Tente novamente em instantes.");
  }

  private async readAfterCollection(query: string, page: number, limit: number, currency: string, sort: ProductSearchSort) {
    await this.waitForCollection(query);
    return this.products.search(query, page, limit, currency, sort);
  }
}
