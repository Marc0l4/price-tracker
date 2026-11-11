import type { NormalizedProduct } from "../../../types/normalized-product.js";
import type { MercadoLivreSearchItem } from "./mercadolivre.schemas.js";
import type { MercadoLivreSearchItem as InternalItem } from "./mercadolivre-search-item.js";

export function mapMercadoLivreSearchItem(item: InternalItem): NormalizedProduct {
  return {
    externalId: item.externalId, name: item.name, brand: item.brand,
    model: item.model, gtin: item.gtin, imageUrl: item.imageUrl,
    offers: item.price === undefined || item.currency === undefined ? [] : [{
      externalOfferId: item.externalOfferId, price: item.price, currency: item.currency,
      shipping: item.freeShipping === undefined ? undefined : { isFree: item.freeShipping },
      productUrl: item.productUrl, provider: "mercadolivre", storeName: item.storeName,
      availability: item.availability ?? "unknown",
    }],
  };
}

function attributeValue(item: MercadoLivreSearchItem, attributeId: string): string | undefined {
  return item.attributes?.find((attribute) => attribute.id === attributeId)?.value_name ?? undefined;
}

function availability(item: MercadoLivreSearchItem): "available" | "unavailable" | "unknown" {
  if (item.available_quantity === undefined) return "unknown";
  return item.available_quantity > 0 ? "available" : "unavailable";
}

export function mapMercadoLivreItem(item: MercadoLivreSearchItem): NormalizedProduct {
  return {
    externalId: item.id,
    name: item.title,
    brand: attributeValue(item, "BRAND"),
    model: attributeValue(item, "MODEL"),
    gtin: attributeValue(item, "GTIN"),
    imageUrl: item.thumbnail,
    offers: [{
      externalOfferId: item.id,
      price: item.price,
      currency: item.currency_id,
      shipping: item.shipping ? { isFree: item.shipping.free_shipping } : undefined,
      productUrl: item.permalink,
      provider: "mercadolivre",
      storeName: item.seller?.nickname,
      availability: availability(item),
    }],
  };
}
