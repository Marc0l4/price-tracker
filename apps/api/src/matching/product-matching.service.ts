import type { NormalizedProduct } from "../types/normalized-product.js";
import type { ProductGroup } from "./product-match-result.js";
import { ProductMatcher } from "./product-matcher.js";

function sameSourceProduct(left: NormalizedProduct, right: NormalizedProduct): boolean {
  if (left === right) return true;
  const leftOffers = left.offers;
  const rightOffers = right.offers;
  return leftOffers.some((offer) => rightOffers.some((other) =>
    offer.provider === other.provider && (
      offer.externalOfferId === other.externalOfferId || left.externalId === right.externalId)));
}

export class ProductMatchingService {
  constructor(private readonly matcher = new ProductMatcher()) {}

  group(products: NormalizedProduct[]): ProductGroup<NormalizedProduct>[] {
    const groups: ProductGroup<NormalizedProduct>[] = [];
    for (const product of products) {
      const group = groups.find((candidate) => candidate.products.every((member) =>
        this.matcher.compare(member, product).matched));
      if (group) {
        const duplicateIndex = group.products.findIndex((member) => sameSourceProduct(member, product));
        if (duplicateIndex < 0) group.products.push(product);
        else {
          const existing = group.products[duplicateIndex];
          const newOffers = product.offers.filter((offer) => !existing.offers.some((other) =>
            other.provider === offer.provider && other.externalOfferId === offer.externalOfferId));
          group.products[duplicateIndex] = { ...existing, offers: [...existing.offers, ...newOffers] };
        }
      } else groups.push({ id: `group-${groups.length + 1}`, products: [product] });
    }
    return groups;
  }
}
