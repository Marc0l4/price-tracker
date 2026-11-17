import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

type QueryExecutor = PrismaClient | Prisma.TransactionClient;

/** A fixed-window counter kept in PostgreSQL so Render replicas share quota. */
export class OnDemandRateLimitRepository {
  constructor(private readonly db: PrismaClient) {}

  async consume(clientKey: string, maximum: number, windowMs: number, now = new Date(), executor: QueryExecutor = this.db): Promise<boolean> {
    const windowStartedAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const accepted = await executor.$queryRaw<Array<{ requestCount: number }>>`
      INSERT INTO "OnDemandRateLimit" ("clientKey", "windowStartedAt", "requestCount", "createdAt", "updatedAt")
      VALUES (${clientKey}, ${windowStartedAt}, 1, ${now}, ${now})
      ON CONFLICT ("clientKey", "windowStartedAt") DO UPDATE
      SET "requestCount" = "OnDemandRateLimit"."requestCount" + 1,
          "updatedAt" = EXCLUDED."updatedAt"
      WHERE "OnDemandRateLimit"."requestCount" < ${maximum}
      RETURNING "requestCount"
    `;
    return accepted.length === 1;
  }
}
