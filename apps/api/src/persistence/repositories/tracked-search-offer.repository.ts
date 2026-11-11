import { Prisma, type Prisma as PrismaTypes } from "../../generated/prisma/client.js";

export class TrackedSearchOfferRepository {
  constructor(private readonly db: PrismaTypes.TransactionClient) {}

  async markSeen(trackedSearchId: string, offerId: string, collectedAt: Date): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO "TrackedSearchOffer" (
        "trackedSearchId", "offerId", "isActive", "lastSeenAt", "lastCheckedAt", "createdAt"
      ) VALUES (${trackedSearchId}::uuid, ${offerId}::uuid, true, ${collectedAt}, ${collectedAt}, CURRENT_TIMESTAMP)
      ON CONFLICT ("trackedSearchId", "offerId") DO UPDATE SET
        "isActive" = CASE WHEN EXCLUDED."lastCheckedAt" >= "TrackedSearchOffer"."lastCheckedAt" THEN true ELSE "TrackedSearchOffer"."isActive" END,
        "lastSeenAt" = GREATEST("TrackedSearchOffer"."lastSeenAt", EXCLUDED."lastSeenAt"),
        "lastCheckedAt" = GREATEST("TrackedSearchOffer"."lastCheckedAt", EXCLUDED."lastCheckedAt")
    `);
  }
}
