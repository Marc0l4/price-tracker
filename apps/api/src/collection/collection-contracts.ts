import type { CollectionRun, CollectionRunStatus, CollectionTrigger, ProviderCollectionRunStatus, TrackedSearch } from "../generated/prisma/client.js";
import type { DetailedSearchResult } from "../services/product-search.service.js";
import type { CollectionContext, SourcedProduct } from "../persistence/persistence-contracts.js";
import type { PersistenceBatchResult } from "../persistence/persistence-result.js";

export type CollectionExecutionStatus = CollectionRunStatus | "skipped_overlap" | "skipped_inactive";

export interface CollectionExecutionResult {
  status: CollectionExecutionStatus;
  collectionRun?: CollectionRun;
}

export interface CollectionLogger {
  info(event: string, fields: Record<string, string | number | boolean | undefined>): void;
}

export interface CollectionSearchPort {
  readonly providerNames: string[];
  searchDetailed(query: string): Promise<DetailedSearchResult>;
}

export interface CollectionPersistencePort {
  persist(inputs: SourcedProduct[], context: CollectionContext): Promise<PersistenceBatchResult>;
}

export interface CollectionRunStart {
  run: CollectionRun;
  trackedSearch: TrackedSearch;
  trigger: CollectionTrigger;
}

export interface ProviderRunCompletion {
  provider: string;
  status: ProviderCollectionRunStatus;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  resultCount?: number;
  errorCode?: string;
}
