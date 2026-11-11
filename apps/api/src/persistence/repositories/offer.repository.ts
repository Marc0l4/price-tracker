import { Prisma, type Offer, type Prisma as PrismaTypes } from "../../generated/prisma/client.js";
import type { NormalizedOffer } from "../../types/normalized-product.js";

export class OfferRepository {
  constructor(private readonly db: PrismaTypes.TransactionClient) {}

  async upsert(providerProductId: string, offer: NormalizedOffer, collectedAt: Date): Promise<Offer> {
    const rows = await this.db.$queryRaw<Offer[]>(Prisma.sql`
      INSERT INTO "Offer" (
        "id", "providerProductId", "provider", "externalOfferId", "storeName",
        "productUrl", "availability", "isActive", "lastSeenAt", "lastCheckedAt", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), ${providerProductId}::uuid, ${offer.provider}, ${offer.externalOfferId},
        ${offer.storeName ?? null}, ${offer.productUrl}, ${offer.availability}, true,
        ${collectedAt}, ${collectedAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("provider", "externalOfferId") DO UPDATE SET
        "storeName" = CASE WHEN EXCLUDED."lastCheckedAt" >= "Offer"."lastCheckedAt" THEN EXCLUDED."storeName" ELSE "Offer"."storeName" END,
        "productUrl" = CASE WHEN EXCLUDED."lastCheckedAt" >= "Offer"."lastCheckedAt" THEN EXCLUDED."productUrl" ELSE "Offer"."productUrl" END,
        "availability" = CASE WHEN EXCLUDED."lastCheckedAt" >= "Offer"."lastCheckedAt" THEN EXCLUDED."availability" ELSE "Offer"."availability" END,
        "isActive" = CASE WHEN EXCLUDED."lastCheckedAt" >= "Offer"."lastCheckedAt" THEN true ELSE "Offer"."isActive" END,
        "lastSeenAt" = GREATEST("Offer"."lastSeenAt", EXCLUDED."lastSeenAt"),
        "lastCheckedAt" = GREATEST("Offer"."lastCheckedAt", EXCLUDED."lastCheckedAt"),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "Offer"."providerProductId" = EXCLUDED."providerProductId"
      RETURNING *
    `);
    if (!rows[0]) throw new Error("A oferta já pertence a outro produto externo; associação requer revisão.");
    return rows[0];
  }

  markMissingInactive(
    provider: string,
    seenOfferIds: string[],
    protectedProviderProductIds: string[],
    collectedAt: Date,
    lifecycleScopeId?: string,
  ) {
    if (lifecycleScopeId) return this.markMissingInactiveInScope(
      provider, seenOfferIds, protectedProviderProductIds, collectedAt, lifecycleScopeId,
    );
    return this.db.offer.updateMany({
      where: {
        provider,
        isActive: true,
        lastCheckedAt: { lt: collectedAt },
        ...(seenOfferIds.length ? { externalOfferId: { notIn: seenOfferIds } } : {}),
        ...(protectedProviderProductIds.length ? { providerProductId: { notIn: protectedProviderProductIds } } : {}),
      },
      data: { isActive: false, lastCheckedAt: collectedAt },
    });
  }

  private async markMissingInactiveInScope(
    provider: string,
    seenOfferIds: string[],
    protectedProviderProductIds: string[],
    collectedAt: Date,
    trackedSearchId: string,
  ) {
    const result = await this.db.trackedSearchOffer.updateMany({
      where: {
        trackedSearchId,
        isActive: true,
        lastCheckedAt: { lt: collectedAt },
        offer: {
          provider,
          ...(seenOfferIds.length ? { externalOfferId: { notIn: seenOfferIds } } : {}),
          ...(protectedProviderProductIds.length ? { providerProductId: { notIn: protectedProviderProductIds } } : {}),
        },
      },
      data: { isActive: false, lastCheckedAt: collectedAt },
    });
    await this.db.$executeRaw(Prisma.sql`
      UPDATE "Offer" AS offer
      SET
        "isActive" = EXISTS (
          SELECT 1 FROM "TrackedSearchOffer" AS scope
          WHERE scope."offerId" = offer."id" AND scope."isActive" = true
        ),
        "lastCheckedAt" = GREATEST(offer."lastCheckedAt", ${collectedAt}),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE EXISTS (
        SELECT 1 FROM "TrackedSearchOffer" AS scope
        WHERE scope."offerId" = offer."id" AND scope."trackedSearchId" = ${trackedSearchId}::uuid
      )
    `);
    return result;
  }
}
