import { Prisma, type Prisma as PrismaTypes, type PrismaClient } from "../../generated/prisma/client.js";

export interface CurrentOfferRow {
  id: string; provider: string; storeName: string | null; productUrl: string; availability: string;
  shippingIsFree: boolean | null; lastSeenAt: Date; currency: string; price: Prisma.Decimal; observedAt: Date;
}
interface AggregateRow {
  observationCount: bigint; lowestPrice: Prisma.Decimal | null; highestPrice: Prisma.Decimal | null;
  averagePrice: Prisma.Decimal | null; firstObservedAt: Date | null; lastObservedAt: Date | null;
}
interface HistoryRow {
  periodStart: Date; periodEnd: Date; minPrice: Prisma.Decimal; maxPrice: Prisma.Decimal;
  averagePrice: Prisma.Decimal; lastPrice: Prisma.Decimal; lastObservedAt: Date; observationCount: bigint;
}

export class PriceAnalyticsRepository {
  constructor(private readonly db: PrismaClient) {}

  currentOffers(canonicalProductId: string, currency?: string, from?: Date, to?: Date): Promise<CurrentOfferRow[]> {
    const currencyFilter = currency ? Prisma.sql`AND observation."currency" = ${currency}` : Prisma.empty;
    const range = this.range(from, to);
    return this.db.$queryRaw<CurrentOfferRow[]>(Prisma.sql`
      SELECT DISTINCT ON (offer."id")
        offer."id", offer."provider", offer."storeName", offer."productUrl", offer."availability",
        observation."shippingIsFree", offer."lastSeenAt", observation."currency", observation."price",
        observation."collectedAt" AS "observedAt"
      FROM "Offer" AS offer
      JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
      JOIN "PriceObservation" AS observation ON observation."offerId" = offer."id"
      WHERE provider_product."canonicalProductId" = ${canonicalProductId}::uuid
        AND offer."isActive" = true ${currencyFilter} ${range}
      ORDER BY offer."id", observation."collectedAt" DESC, observation."id" DESC
    `);
  }

  currentOffersForProducts(canonicalProductIds: string[], currency: string): Promise<Array<CurrentOfferRow & { canonicalProductId: string }>> {
    if (!canonicalProductIds.length) return Promise.resolve([]);
    return this.db.$queryRaw<Array<CurrentOfferRow & { canonicalProductId: string }>>(Prisma.sql`
      SELECT DISTINCT ON (offer."id")
        provider_product."canonicalProductId", offer."id", offer."provider", offer."storeName", offer."productUrl",
        offer."availability", observation."shippingIsFree", offer."lastSeenAt", observation."currency",
        observation."price", observation."collectedAt" AS "observedAt"
      FROM "Offer" AS offer
      JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
      JOIN "PriceObservation" AS observation ON observation."offerId" = offer."id"
      WHERE provider_product."canonicalProductId" IN (${Prisma.join(canonicalProductIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND offer."isActive" = true AND observation."currency" = ${currency}
      ORDER BY offer."id", observation."collectedAt" DESC, observation."id" DESC
    `);
  }

  aggregate(canonicalProductId: string, currency: string, from?: Date, to?: Date): Promise<AggregateRow> {
    const range = this.range(from, to);
    return this.db.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT COUNT(*) AS "observationCount", MIN(observation."price") AS "lowestPrice",
        MAX(observation."price") AS "highestPrice", AVG(observation."price") AS "averagePrice",
        MIN(observation."collectedAt") AS "firstObservedAt", MAX(observation."collectedAt") AS "lastObservedAt"
      FROM "PriceObservation" AS observation
      JOIN "Offer" AS offer ON offer."id" = observation."offerId"
      JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
      WHERE provider_product."canonicalProductId" = ${canonicalProductId}::uuid
        AND observation."currency" = ${currency} ${range}
    `).then(([row]) => row);
  }

  lowest(canonicalProductId: string, currency: string, from?: Date, to?: Date) {
    const range = this.range(from, to);
    return this.db.$queryRaw<Array<{ price: Prisma.Decimal; collectedAt: Date }>>(Prisma.sql`
      SELECT observation."price", observation."collectedAt"
      FROM "PriceObservation" AS observation
      JOIN "Offer" AS offer ON offer."id" = observation."offerId"
      JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
      WHERE provider_product."canonicalProductId" = ${canonicalProductId}::uuid
        AND observation."currency" = ${currency} ${range}
      ORDER BY observation."price" ASC, observation."collectedAt" ASC LIMIT 1
    `).then(([row]) => row);
  }

  count(canonicalProductId: string, currency: string, from?: Date, to?: Date) {
    const range = this.range(from, to);
    return this.db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count FROM "PriceObservation" AS observation
      JOIN "Offer" AS offer ON offer."id" = observation."offerId"
      JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
      WHERE provider_product."canonicalProductId" = ${canonicalProductId}::uuid
        AND observation."currency" = ${currency} ${range}
    `).then(([row]) => Number(row.count));
  }

  history(canonicalProductId: string, currency: string, from: Date | undefined, to: Date | undefined, granularity: "day" | "week"): Promise<HistoryRow[]> {
    const range = this.range(from, to);
    const interval = granularity === "day" ? Prisma.raw("'day'") : Prisma.raw("'week'");
    return this.db.$queryRaw<HistoryRow[]>(Prisma.sql`
      WITH scoped AS (
        SELECT observation."id", observation."price", observation."collectedAt", date_trunc(${interval}, observation."collectedAt") AS bucket
        FROM "PriceObservation" AS observation
        JOIN "Offer" AS offer ON offer."id" = observation."offerId"
        JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
        WHERE provider_product."canonicalProductId" = ${canonicalProductId}::uuid
          AND observation."currency" = ${currency} ${range}
      ), aggregate AS (
        SELECT bucket AS "periodStart", MIN("price") AS "minPrice", MAX("price") AS "maxPrice",
          AVG("price") AS "averagePrice", MAX("collectedAt") AS "lastObservedAt", COUNT(*) AS "observationCount"
        FROM scoped GROUP BY bucket
      ), latest AS (
        SELECT DISTINCT ON (bucket) bucket, "price", "collectedAt"
        FROM scoped ORDER BY bucket, "collectedAt" DESC, "id" DESC
      )
      SELECT aggregate."periodStart", aggregate."periodStart" + ${granularity === "day" ? Prisma.raw("interval '1 day'") : Prisma.raw("interval '1 week'")} AS "periodEnd",
        aggregate."minPrice", aggregate."maxPrice", aggregate."averagePrice", latest."price" AS "lastPrice",
        aggregate."lastObservedAt", aggregate."observationCount"
      FROM aggregate JOIN latest ON latest.bucket = aggregate."periodStart"
      ORDER BY aggregate."periodStart" ASC
    `);
  }

  rawHistory(canonicalProductId: string, currency: string, from?: Date, to?: Date) {
    const range = this.range(from, to);
    return this.db.$queryRaw<Array<{ price: Prisma.Decimal; collectedAt: Date }>>(Prisma.sql`
      SELECT observation."price", observation."collectedAt"
      FROM "PriceObservation" AS observation
      JOIN "Offer" AS offer ON offer."id" = observation."offerId"
      JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
      WHERE provider_product."canonicalProductId" = ${canonicalProductId}::uuid
        AND observation."currency" = ${currency} ${range}
      ORDER BY observation."collectedAt" ASC, observation."id" ASC
    `);
  }

  offerHistory(offerId: string, currency: string, from?: Date, to?: Date) {
    const range = this.offerRange(from, to);
    return this.db.$queryRaw<Array<{ price: Prisma.Decimal; currency: string; collectedAt: Date }>>(Prisma.sql`
      SELECT "price", "currency", "collectedAt" FROM "PriceObservation"
      WHERE "offerId" = ${offerId}::uuid AND "currency" = ${currency} ${range}
      ORDER BY "collectedAt" ASC, "id" ASC
    `);
  }

  offerExists(offerId: string) { return this.db.offer.findUnique({ where: { id: offerId }, select: { id: true } }); }

  private range(from?: Date, to?: Date): PrismaTypes.Sql {
    return Prisma.sql`${from ? Prisma.sql`AND observation."collectedAt" >= ${from}` : Prisma.empty}
      ${to ? Prisma.sql`AND observation."collectedAt" <= ${to}` : Prisma.empty}`;
  }

  private offerRange(from?: Date, to?: Date): PrismaTypes.Sql {
    return Prisma.sql`${from ? Prisma.sql`AND "collectedAt" >= ${from}` : Prisma.empty}
      ${to ? Prisma.sql`AND "collectedAt" <= ${to}` : Prisma.empty}`;
  }
}
