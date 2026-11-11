import type { PrismaClient } from "../generated/prisma/client.js";
import { notFound, ReadApiError } from "./read-errors.js";
import { PriceAnalyticsRepository } from "./repositories/price-analytics.repository.js";
import { ProductReadRepository, type ProductSearchSort } from "./repositories/product-read.repository.js";

export class ProductQueryService {
  private readonly products: ProductReadRepository;
  private readonly analytics: PriceAnalyticsRepository;

  constructor(db: PrismaClient) {
    this.products = new ProductReadRepository(db);
    this.analytics = new PriceAnalyticsRepository(db);
  }

  async product(id: string) {
    const product = await this.products.findById(id);
    if (!product) throw notFound("product");
    const activeOffers = await this.analytics.currentOffers(id);
    return {
      id: product.id, name: product.name, brand: product.brand, model: product.model, gtin: product.gtin,
      matchStatus: product.matchStatus, imageUrl: product.providerProducts.find((item) => item.imageUrl)?.imageUrl ?? null,
      providers: [...new Set(product.providerProducts.map((item) => item.provider))],
      activeOffers: activeOffers.map((offer) => ({
        id: offer.id, provider: offer.provider, storeName: offer.storeName, productUrl: offer.productUrl,
        availability: offer.availability, shippingIsFree: offer.shippingIsFree, lastSeenAt: offer.lastSeenAt,
        currency: offer.currency, currentPrice: offer.price.toFixed(4), observedAt: offer.observedAt,
      })),
    };
  }

  async requireProduct(id: string): Promise<void> {
    if (!await this.products.exists(id)) throw notFound("product");
  }

  async search(query: string, page: number, limit: number, currency = "BRL", sort: ProductSearchSort = "history") {
    if (!query.trim()) throw new ReadApiError(400, "invalid_query", "Query é obrigatória.");
    if (!/^[A-Z]{3}$/.test(currency)) throw new ReadApiError(400, "invalid_currency", "Currency deve usar três letras maiúsculas.");
    const result = await this.products.search(query.trim(), page, limit, currency, sort);
    return {
      page, limit, total: result.total,
      items: result.products.map((product) => ({
        id: product.id, name: product.name, brand: product.brand, model: product.model, matchStatus: product.matchStatus,
        imageUrl: product.providerProducts.find((item) => item.imageUrl)?.imageUrl ?? null,
        currentPrice: product.currentPrice?.toFixed(4) ?? null,
        currency: product.currentPrice ? currency : null,
      })),
    };
  }
}
