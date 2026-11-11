import { MatchStatus } from "../generated/prisma/client.js";
import type { NormalizedProduct } from "../types/normalized-product.js";
import type { ProductGroup } from "../matching/product-match-result.js";
import { ProductMatcher } from "../matching/product-matcher.js";
import { validGtin } from "../matching/product-normalizer.js";

export interface GroupDecision {
  group: ProductGroup<NormalizedProduct>;
  status: MatchStatus;
  ambiguousWith: string[];
}

export class PersistenceDecision {
  constructor(private readonly matcher = new ProductMatcher()) {}

  decide(groups: ProductGroup<NormalizedProduct>[], providerOf: (product: NormalizedProduct) => string): GroupDecision[] {
    return groups.map((group) => {
      const ambiguousWith = groups.filter((other) => other !== group && group.products.some((left) =>
        other.products.some((right) => this.matcher.compare(left, right).matched))).map((other) => other.id);
      const gtins = group.products.map((product) => validGtin(product.gtin));
      const distinctProviders = new Set(group.products.map(providerOf));
      const sameStrongGtin = group.products.length > 1 && gtins.every((gtin) => Boolean(gtin) && gtin === gtins[0]);
      const status = ambiguousWith.length ? MatchStatus.review_required :
        sameStrongGtin && distinctProviders.size > 1 ? MatchStatus.confirmed : MatchStatus.provisional;
      return { group, status, ambiguousWith };
    });
  }
}
