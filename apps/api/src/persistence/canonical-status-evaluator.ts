import { MatchStatus, type ProviderProduct } from "../generated/prisma/client.js";
import type { NormalizedProduct } from "../types/normalized-product.js";
import { ProductMatcher } from "../matching/product-matcher.js";
import { validGtin } from "../matching/product-normalizer.js";

const normalized = (product: ProviderProduct): NormalizedProduct => ({
  externalId: product.externalId,
  name: product.name,
  brand: product.brand ?? undefined,
  model: product.model ?? undefined,
  gtin: product.gtin ?? undefined,
  imageUrl: product.imageUrl ?? undefined,
  offers: [],
});

export class CanonicalStatusEvaluator {
  constructor(private readonly matcher = new ProductMatcher()) {}

  evaluate(products: ProviderProduct[], currentStatus?: MatchStatus): MatchStatus {
    if (currentStatus === MatchStatus.review_required) return MatchStatus.review_required;
    if (products.length < 2 || new Set(products.map((product) => product.provider)).size < 2)
      return MatchStatus.provisional;
    for (let left = 0; left < products.length; left++)
      for (let right = left + 1; right < products.length; right++)
        if (this.matcher.compare(normalized(products[left]), normalized(products[right])).conflicts.length)
          return MatchStatus.review_required;
    const gtins = products.map((product) => validGtin(product.gtin ?? undefined));
    return gtins.every((gtin) => Boolean(gtin) && gtin === gtins[0])
      ? MatchStatus.confirmed : MatchStatus.provisional;
  }
}
