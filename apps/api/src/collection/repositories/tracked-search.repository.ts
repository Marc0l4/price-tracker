import type { PrismaClient } from "../../generated/prisma/client.js";

export function normalizeTrackedQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export class TrackedSearchRepository {
  constructor(private readonly db: PrismaClient) {}

  async ensure(query: string) {
    const normalized = normalizeTrackedQuery(query);
    if (!normalized) throw new Error("A query monitorada é obrigatória.");
    return this.db.trackedSearch.upsert({
      where: { query: normalized },
      create: { query: normalized },
      update: {},
    });
  }

  findById(id: string) {
    return this.db.trackedSearch.findUnique({ where: { id } });
  }

  findActive() {
    return this.db.trackedSearch.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  }

  markCollected(id: string, collectedAt: Date) {
    return this.db.trackedSearch.update({ where: { id }, data: { lastCollectedAt: collectedAt } });
  }
}
