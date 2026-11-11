import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";

export type ProductSearchSort = "history" | "price";

interface RankedProductRow {
  id: string;
  currentPrice: Prisma.Decimal | null;
  historyCount: bigint;
}

export class ProductReadRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string) {
    return this.db.canonicalProduct.findUnique({ where: { id }, include: {
      providerProducts: { select: { provider: true, imageUrl: true } },
    } });
  }

  exists(id: string) { return this.db.canonicalProduct.findUnique({ where: { id }, select: { id: true } }); }

  async search(query: string, page: number, limit: number, currency: string, sort: ProductSearchSort) {
    const where = { OR: [
      { name: { contains: query, mode: "insensitive" as const } },
      { brand: { contains: query, mode: "insensitive" as const } },
      { model: { contains: query, mode: "insensitive" as const } },
    ] };
    const like = `%${query}%`;
    const order = sort === "history"
      ? Prisma.sql`CASE WHEN current_price."currentPrice" IS NULL THEN 1 ELSE 0 END ASC,
        COALESCE(history_coverage."historyCount", 0) DESC,
        current_price."currentPrice" ASC NULLS LAST, product."name" ASC, product."id" ASC`
      : Prisma.sql`CASE WHEN current_price."currentPrice" IS NULL THEN 1 ELSE 0 END ASC,
        current_price."currentPrice" ASC NULLS LAST, product."name" ASC, product."id" ASC`;
    const [total, ranked] = await this.db.$transaction([
      this.db.canonicalProduct.count({ where }),
      this.db.$queryRaw<RankedProductRow[]>(Prisma.sql`
        WITH current_offer AS (
          SELECT DISTINCT ON (offer."id") provider_product."canonicalProductId", offer."id", observation."price"
          FROM "Offer" AS offer
          JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
          JOIN "PriceObservation" AS observation ON observation."offerId" = offer."id"
          WHERE offer."isActive" = true AND observation."currency" = ${currency}
          ORDER BY offer."id", observation."collectedAt" DESC, observation."id" DESC
        ), current_price AS (
          SELECT "canonicalProductId", MIN("price") AS "currentPrice"
          FROM current_offer GROUP BY "canonicalProductId"
        ), history_coverage AS (
          SELECT provider_product."canonicalProductId", COUNT(DISTINCT observation."collectionKey") AS "historyCount"
          FROM "PriceObservation" AS observation
          JOIN "Offer" AS offer ON offer."id" = observation."offerId"
          JOIN "ProviderProduct" AS provider_product ON provider_product."id" = offer."providerProductId"
          WHERE observation."currency" = ${currency}
          GROUP BY provider_product."canonicalProductId"
        )
        SELECT product."id", current_price."currentPrice", COALESCE(history_coverage."historyCount", 0)::bigint AS "historyCount"
        FROM "CanonicalProduct" AS product
        LEFT JOIN current_price ON current_price."canonicalProductId" = product."id"
        LEFT JOIN history_coverage ON history_coverage."canonicalProductId" = product."id"
        WHERE product."name" ILIKE ${like} OR product."brand" ILIKE ${like} OR product."model" ILIKE ${like}
        ORDER BY ${order}
        OFFSET ${(page - 1) * limit} LIMIT ${limit}
      `),
    ]);
    const products = await this.db.canonicalProduct.findMany({
      where: { id: { in: ranked.map((row) => row.id) } },
      include: { providerProducts: { select: { provider: true, imageUrl: true } } },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    return {
      total,
      products: ranked.flatMap((row) => {
        const product = byId.get(row.id);
        return product ? [{ ...product, currentPrice: row.currentPrice, historyCount: Number(row.historyCount) }] : [];
      }),
    };
  }
}
