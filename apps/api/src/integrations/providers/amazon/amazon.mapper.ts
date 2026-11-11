import type { NormalizedProduct } from "../../../types/normalized-product.js";
import type { AmazonSearchItem } from "./amazon-search-item.js";

export function mapAmazonItem(item: AmazonSearchItem): NormalizedProduct {
  return {
    externalId: item.externalId,
    name: item.name,
    imageUrl: item.imageUrl,
    // Produto encontrado sem preço/moeda permanece visível, mas sem oferta.
    offers: item.price === undefined || item.currency === undefined ? [] : [{
      externalOfferId: item.externalId,
      price: item.price,
      currency: item.currency,
      productUrl: item.productUrl,
      provider: "amazon",
      availability: "unknown",
    }],
  };
}
