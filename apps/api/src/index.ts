import { MercadoLivreProvider } from "./integrations/providers/mercadolivre/mercadolivre.provider.js";
import { AmazonProvider } from "./integrations/providers/amazon/amazon.provider.js";
import { ScavioAmazonClient } from "./integrations/providers/amazon/clients/scavio-amazon.client.js";
import { ScavioMercadoLivreClient } from "./integrations/providers/mercadolivre/clients/scavio-mercadolivre.client.js";
import { ProductSearchService } from "./services/product-search.service.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { ProductPersistenceService } from "./persistence/product-persistence.service.js";
import { CollectionOrchestrator } from "./collection/collection-orchestrator.js";
import { CollectionScheduler } from "./collection/collection-scheduler.js";
import { collectionEnvironmentFromEnvironment, type CollectionEnvironment } from "./shared/config/environment.js";

export function createProductSearchService(configuration = collectionEnvironmentFromEnvironment()): ProductSearchService {
  return new ProductSearchService([
    new MercadoLivreProvider(new ScavioMercadoLivreClient(configuration.scavioApiKey)),
    new AmazonProvider(new ScavioAmazonClient(configuration.scavioApiKey, fetch, configuration.scavioAmazonTimeoutMs)),
  ]);
}

export function createCollectionOrchestrator(db: PrismaClient, configuration = collectionEnvironmentFromEnvironment()): CollectionOrchestrator {
  return new CollectionOrchestrator(
    db,
    createProductSearchService(),
    new ProductPersistenceService(db),
    undefined,
    undefined,
    { collectionTimeoutMs: configuration.collectionTimeoutMs, staleRunMs: configuration.staleRunMs },
  );
}

export function createCollectionScheduler(orchestrator: CollectionOrchestrator, configuration = collectionEnvironmentFromEnvironment()): CollectionScheduler {
  return new CollectionScheduler(orchestrator, configuration.collectionIntervalMs);
}

export type { CollectionEnvironment } from "./shared/config/environment.js";

export { MercadoLivreProvider } from "./integrations/providers/mercadolivre/mercadolivre.provider.js";
export { AmazonProvider } from "./integrations/providers/amazon/amazon.provider.js";
export { ProductSearchService } from "./services/product-search.service.js";
export type { DetailedSearchResult, ProviderSearchOutcome } from "./services/product-search.service.js";
export { ProductMatcher } from "./matching/product-matcher.js";
export { ProductMatchingService } from "./matching/product-matching.service.js";
export type { ProductMatchResult, ProductGroup } from "./matching/product-match-result.js";
export { ProductPersistenceService } from "./persistence/product-persistence.service.js";
export type { SourcedProduct, CollectionContext } from "./persistence/product-persistence.service.js";
export type { PersistenceBatchResult } from "./persistence/persistence-result.js";
export { CollectionOrchestrator } from "./collection/collection-orchestrator.js";
export { CollectionScheduler } from "./collection/collection-scheduler.js";
export type { CollectionExecutionResult, CollectionExecutionStatus } from "./collection/collection-contracts.js";
export { ProductQueryService } from "./read/product-query.service.js";
export { PriceHistoryService } from "./read/price-history.service.js";
export { createReadApiServer } from "./http/read-api.server.js";
export type * from "./types/normalized-product.js";
