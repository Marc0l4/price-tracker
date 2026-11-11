import { Prisma, type PriceObservation, type Prisma as PrismaTypes } from "../../generated/prisma/client.js";
import type { NormalizedOffer } from "../../types/normalized-product.js";

export class PriceObservationRepository {
  constructor(private readonly db: PrismaTypes.TransactionClient) {}

  async record(offerId: string, offer: NormalizedOffer, collectionKey: string, collectedAt: Date): Promise<PriceObservation> {
    const price = new Prisma.Decimal(offer.price.toString());
    const shippingIsFree = offer.shipping?.isFree ?? null;
    const inserted = await this.db.$queryRaw<PriceObservation[]>(Prisma.sql`
      INSERT INTO "PriceObservation" (
        "id", "offerId", "price", "currency", "shippingAmount", "shippingIsFree",
        "collectedAt", "collectionKey", "createdAt"
      ) VALUES (
        gen_random_uuid(), ${offerId}::uuid, ${price}, ${offer.currency}, NULL,
        ${shippingIsFree}, ${collectedAt}, ${collectionKey}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("offerId", "collectionKey") DO NOTHING
      RETURNING *
    `);
    if (inserted[0]) return inserted[0];
    const existing = await this.db.priceObservation.findUniqueOrThrow({
      where: { offerId_collectionKey: { offerId, collectionKey } },
    });
    if (!existing.price.equals(price) || existing.currency !== offer.currency ||
      existing.shippingIsFree !== shippingIsFree || existing.collectedAt.getTime() !== collectedAt.getTime())
      throw new Error("A chave de coleta já existe com dados diferentes.");
    return existing;
  }
}
