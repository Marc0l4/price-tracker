import { MatchStatus, type Prisma } from "../../generated/prisma/client.js";
import type { NormalizedProduct } from "../../types/normalized-product.js";

export class ProviderProductRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async upsert(provider: string, product: NormalizedProduct, collectedAt: Date) {
    const data = { name: product.name, brand: product.brand ?? null, model: product.model ?? null,
      gtin: product.gtin ?? null, imageUrl: product.imageUrl ?? null };
    const where = { provider_externalId: { provider, externalId: product.externalId } };
    const existing = await this.db.providerProduct.findUnique({ where });
    if (!existing) return this.db.providerProduct.create({
      data: { provider, externalId: product.externalId, ...data, lastObservedAt: collectedAt },
    });
    if (collectedAt.getTime() < existing.lastObservedAt.getTime()) return existing;
    return this.db.providerProduct.update({
      where,
      data: { ...data, lastObservedAt: collectedAt },
    });
  }

  async lockIdentities(keys: string[]): Promise<void> {
    for (const key of [...new Set(keys)].sort())
      await this.db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked`;
  }

  find(provider: string, externalId: string) {
    return this.db.providerProduct.findUnique({ where: { provider_externalId: { provider, externalId } } });
  }

  setAssociation(id: string, canonicalProductId: string, matchStatus: MatchStatus) {
    return this.db.providerProduct.update({ where: { id }, data: { canonicalProductId, matchStatus } });
  }

  setStatus(id: string, matchStatus: MatchStatus) {
    return this.db.providerProduct.update({ where: { id }, data: { matchStatus } });
  }

  setCanonicalMembersStatus(canonicalProductId: string, matchStatus: MatchStatus) {
    return this.db.providerProduct.updateMany({ where: { canonicalProductId }, data: { matchStatus } });
  }
}
