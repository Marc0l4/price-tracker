import { MatchStatus, Prisma, type PrismaClient, type Prisma as PrismaTypes } from "../generated/prisma/client.js";
import type { NormalizedProduct } from "../types/normalized-product.js";
import { ProductMatchingService } from "../matching/product-matching.service.js";
import { PersistenceDecision } from "./persistence-decision.js";
import { normalizeBatch, productKey } from "./batch-normalizer.js";
import { CanonicalStatusEvaluator } from "./canonical-status-evaluator.js";
import type { CollectionContext, SourcedProduct } from "./persistence-contracts.js";
import type { PersistenceBatchResult, PersistenceFailureCode, PersistenceUnitFailure } from "./persistence-result.js";
import { CanonicalProductRepository } from "./repositories/canonical-product.repository.js";
import { ProviderProductRepository } from "./repositories/provider-product.repository.js";
import { OfferRepository } from "./repositories/offer.repository.js";
import { PriceObservationRepository } from "./repositories/price-observation.repository.js";
import { TrackedSearchOfferRepository } from "./repositories/tracked-search-offer.repository.js";

const TRANSACTION_TIMEOUT_MS = 10_000;
const TRANSACTION_MAX_WAIT_MS = 5_000;

function sanitizedFailure(error: unknown, groupId: string | undefined, productKeys: string[]): PersistenceUnitFailure {
  let code: PersistenceFailureCode = "persistence_error";
  let message = "A unidade de persistência falhou.";
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") { code = "database_conflict"; message = "Uma identidade única entrou em conflito no banco."; }
    else if (error.code === "P2003") { code = "database_conflict"; message = "Uma relação de banco ficou inconsistente."; }
    else if (error.code === "P2028") { code = "transaction_timeout"; message = "A transação excedeu o tempo disponível."; }
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    code = "database_unavailable";
    message = "O PostgreSQL está indisponível.";
  } else if (error instanceof Error) {
    if (error.message.includes("outro produto externo")) { code = "identity_conflict"; message = error.message; }
    else if (error.message.includes("chave de coleta")) { code = "database_conflict"; message = error.message; }
  }
  return { groupId, productKeys, code, message };
}

export class ProductPersistenceService {
  constructor(
    private readonly db: PrismaClient,
    private readonly matching = new ProductMatchingService(),
    private readonly decision = new PersistenceDecision(),
    private readonly statusEvaluator = new CanonicalStatusEvaluator(),
  ) {}

  async persist(rawInputs: SourcedProduct[], rawContext: CollectionContext): Promise<PersistenceBatchResult> {
    const collectionKey = rawContext.collectionKey.trim();
    if (!collectionKey || !Number.isFinite(rawContext.collectedAt.getTime()))
      throw new Error("Chave e instante de coleta válidos são obrigatórios.");
    const successfulProviders = [...new Set(rawContext.successfulProviders.map((provider) => provider.trim()))];
    if (successfulProviders.some((provider) => !provider)) throw new Error("Provider bem-sucedido não pode ser vazio.");
    if (rawContext.lifecycleScopeId !== undefined && !rawContext.lifecycleScopeId.trim())
      throw new Error("Escopo de lifecycle não pode ser vazio.");

    const normalized = normalizeBatch(rawInputs);
    const failed = [...normalized.failures];
    const failedProviders = new Set<string>();
    for (const failure of failed) for (const key of failure.productKeys) {
      try { const [provider] = JSON.parse(key) as [string, string]; if (provider) failedProviders.add(provider); }
      catch { /* invalid input without a usable provider */ }
    }
    const successfulSet = new Set(successfulProviders);
    const eligibleInputs: SourcedProduct[] = [];
    for (const input of normalized.inputs) {
      if (!successfulSet.has(input.provider)) {
        failedProviders.add(input.provider);
        failed.push({ productKeys: [productKey(input.provider, input.product.externalId)], code: "validation_error",
          message: "O produto não pertence a um provider marcado como bem-sucedido." });
      } else eligibleInputs.push(input);
    }

    const sources = new WeakMap<NormalizedProduct, string>();
    for (const input of eligibleInputs) sources.set(input.product, input.provider);
    const providerOf = (product: NormalizedProduct): string => {
      const provider = sources.get(product);
      if (!provider) throw new Error("Não foi possível identificar a origem explícita do produto.");
      return provider;
    };
    const groups = this.matching.group(eligibleInputs.map(({ product }) => product));
    const decisions = this.decision.decide(groups, providerOf);
    let existing;
    try {
      existing = await this.db.providerProduct.findMany({
        where: { OR: eligibleInputs.map(({ provider, product }) => ({ provider, externalId: product.externalId })) },
      });
    } catch (error) {
      failed.push(sanitizedFailure(error, undefined, eligibleInputs.map(({ provider, product }) =>
        productKey(provider, product.externalId))));
      return {
        succeeded: [],
        failed,
        providerLifecycle: successfulProviders.map((provider) =>
          ({ provider, status: "skipped_due_to_failure" as const, inactiveOffers: 0 })),
      };
    }
    const existingByKey = new Map(existing.map((record) => [productKey(record.provider, record.externalId), record]));
    const groupExistingIds = decisions.map(({ group }) => [...new Set(group.products
      .map((product) => existingByKey.get(productKey(providerOf(product), product.externalId))?.canonicalProductId)
      .filter((id): id is string => Boolean(id)))]);
    const splitIds = new Set(groupExistingIds.flat().filter((id) =>
      groupExistingIds.filter((ids) => ids.includes(id)).length > 1));

    const succeeded: PersistenceBatchResult["succeeded"] = [];
    const seenByProvider = new Map<string, Set<string>>();
    const protectedByProvider = new Map<string, Set<string>>();

    for (const decision of decisions) {
      const productKeys = decision.group.products.map((product) => productKey(providerOf(product), product.externalId));
      const providers = new Set(decision.group.products.map(providerOf));
      try {
        const result = await this.db.$transaction(async (tx) =>
          this.persistGroup(tx, decision.group.id, decision.status, decision.group.products, providerOf,
            splitIds, collectionKey, rawContext.collectedAt, rawContext.lifecycleScopeId),
        { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
        succeeded.push(result.success);
        for (const item of result.seen) {
          const set = seenByProvider.get(item.provider) ?? new Set<string>();
          set.add(item.externalOfferId);
          seenByProvider.set(item.provider, set);
        }
        for (const item of result.protectedProducts) {
          const set = protectedByProvider.get(item.provider) ?? new Set<string>();
          set.add(item.providerProductId);
          protectedByProvider.set(item.provider, set);
        }
      } catch (error) {
        providers.forEach((provider) => failedProviders.add(provider));
        failed.push(sanitizedFailure(error, decision.group.id, productKeys));
      }
    }

    const providerLifecycle: PersistenceBatchResult["providerLifecycle"] = [];
    for (const provider of successfulProviders) {
      if (failedProviders.has(provider)) {
        providerLifecycle.push({ provider, status: "skipped_due_to_failure", inactiveOffers: 0 });
        continue;
      }
      try {
        const inactiveOffers = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`offer-lifecycle:${provider}`}, 0)) IS NULL AS locked`;
          return (await new OfferRepository(tx).markMissingInactive(
            provider,
            [...(seenByProvider.get(provider) ?? [])],
            [...(protectedByProvider.get(provider) ?? [])],
            rawContext.collectedAt,
            rawContext.lifecycleScopeId,
          )).count;
        }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
        providerLifecycle.push({ provider, status: "updated", inactiveOffers });
      } catch (error) {
        failed.push(sanitizedFailure(error, undefined, [`provider:${provider}`]));
        providerLifecycle.push({ provider, status: "skipped_due_to_failure", inactiveOffers: 0 });
      }
    }
    return { succeeded, failed, providerLifecycle };
  }

  private async persistGroup(
    tx: PrismaTypes.TransactionClient,
    groupId: string,
    proposedStatus: MatchStatus,
    products: NormalizedProduct[],
    providerOf: (product: NormalizedProduct) => string,
    splitIds: Set<string>,
    collectionKey: string,
    collectedAt: Date,
    lifecycleScopeId?: string,
  ) {
    const canonicals = new CanonicalProductRepository(tx);
    const providerProducts = new ProviderProductRepository(tx);
    const offers = new OfferRepository(tx);
    const observations = new PriceObservationRepository(tx);
    const trackedSearchOffers = new TrackedSearchOfferRepository(tx);
    const keys = products.map((product) => productKey(providerOf(product), product.externalId));
    await providerProducts.lockIdentities(keys);
    const records = [];
    for (const product of products) records.push({ product, provider: providerOf(product),
      record: await providerProducts.upsert(providerOf(product), product, collectedAt) });
    const existingIds = [...new Set(records.map(({ record }) => record.canonicalProductId)
      .filter((id): id is string => Boolean(id)))];
    const existingCanonicals = await Promise.all(existingIds.map((id) => canonicals.get(id)));
    const requiresReview = proposedStatus === MatchStatus.review_required || existingIds.length > 1 ||
      existingCanonicals.some((item) => item.matchStatus === MatchStatus.review_required) ||
      existingIds.some((id) => splitIds.has(id)) ||
      (proposedStatus !== MatchStatus.confirmed &&
        existingCanonicals.some((item) => item.matchStatus === MatchStatus.confirmed) &&
        records.some(({ record }) => !record.canonicalProductId));
    const affectedCanonicalIds = new Set<string>();
    if (requiresReview) {
      for (const { product, record } of records) {
        const canonicalId = record.canonicalProductId ?? (await canonicals.create(product, MatchStatus.review_required)).id;
        await providerProducts.setAssociation(record.id, canonicalId, MatchStatus.review_required);
        affectedCanonicalIds.add(canonicalId);
      }
    } else {
      const canonicalId = existingIds[0] ?? (await canonicals.create(products[0], proposedStatus)).id;
      for (const { record } of records)
        await providerProducts.setAssociation(record.id, canonicalId, proposedStatus);
      affectedCanonicalIds.add(canonicalId);
    }

    const seen: { provider: string; externalOfferId: string }[] = [];
    const protectedProducts: { provider: string; providerProductId: string }[] = [];
    for (const { product, provider, record } of records) {
      if (!product.offers.length) protectedProducts.push({ provider, providerProductId: record.id });
      for (const offer of product.offers) {
        const savedOffer = await offers.upsert(record.id, offer, collectedAt);
        if (lifecycleScopeId) await trackedSearchOffers.markSeen(lifecycleScopeId, savedOffer.id, collectedAt);
        await observations.record(savedOffer.id, offer, collectionKey, collectedAt);
        seen.push({ provider, externalOfferId: offer.externalOfferId });
      }
    }

    let finalStatus = proposedStatus;
    for (const canonicalId of affectedCanonicalIds) {
      const canonical = await canonicals.getWithMembers(canonicalId);
      const status = requiresReview ? MatchStatus.review_required :
        this.statusEvaluator.evaluate(canonical.providerProducts, canonical.matchStatus);
      await canonicals.setStatus(canonicalId, status);
      await providerProducts.setCanonicalMembersStatus(canonicalId, status);
      if (status === MatchStatus.review_required || finalStatus !== MatchStatus.review_required) finalStatus = status;
    }
    return {
      success: { groupId, productKeys: keys, canonicalProductIds: [...affectedCanonicalIds], matchStatus: finalStatus },
      seen,
      protectedProducts,
    };
  }
}

export type { CollectionContext, SourcedProduct } from "./persistence-contracts.js";
export type { PersistenceBatchResult } from "./persistence-result.js";
