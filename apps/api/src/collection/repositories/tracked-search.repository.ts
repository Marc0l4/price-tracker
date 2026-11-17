import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";

export function normalizeTrackedQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export class TrackedSearchRepository {
  constructor(private readonly db: PrismaClient) {}

  async ensure(query: string) {
    const normalized = normalizeTrackedQuery(query);
    if (!normalized) throw new Error("A query monitorada é obrigatória.");
    try {
      return await this.db.trackedSearch.upsert({
        where: { query: normalized },
        create: { query: normalized },
        update: {},
      });
    } catch (error) {
      // PostgreSQL can race two native upserts before either transaction commits.
      // The unique constraint is the authority; the losing caller reads it back.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.db.trackedSearch.findUnique({ where: { query: normalized } });
        if (existing) return existing;
      }
      throw error;
    }
  }

  findById(id: string) {
    return this.db.trackedSearch.findUnique({ where: { id } });
  }

  findByQuery(query: string) {
    const normalized = normalizeTrackedQuery(query);
    if (!normalized) return Promise.resolve(null);
    return this.db.trackedSearch.findUnique({ where: { query: normalized } });
  }

  findActive() {
    return this.db.trackedSearch.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  }

  markCollected(id: string, collectedAt: Date) {
    return this.db.trackedSearch.update({ where: { id }, data: { lastCollectedAt: collectedAt } });
  }
}
