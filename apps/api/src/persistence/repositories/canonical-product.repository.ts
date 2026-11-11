import { MatchStatus, type Prisma } from "../../generated/prisma/client.js";
import type { NormalizedProduct } from "../../types/normalized-product.js";

export class CanonicalProductRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  create(product: NormalizedProduct, matchStatus: MatchStatus) {
    return this.db.canonicalProduct.create({ data: {
      name: product.name, brand: product.brand, model: product.model, gtin: product.gtin, matchStatus,
    } });
  }

  setStatus(id: string, matchStatus: MatchStatus) {
    return this.db.canonicalProduct.update({ where: { id }, data: { matchStatus } });
  }

  get(id: string) {
    return this.db.canonicalProduct.findUniqueOrThrow({ where: { id } });
  }

  getWithMembers(id: string) {
    return this.db.canonicalProduct.findUniqueOrThrow({
      where: { id },
      include: { providerProducts: true },
    });
  }
}
