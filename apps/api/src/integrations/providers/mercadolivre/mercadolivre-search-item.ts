export interface MercadoLivreSearchItem {
  externalId: string;
  externalOfferId: string;
  name: string;
  productUrl: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  brand?: string;
  model?: string;
  gtin?: string;
  storeName?: string;
  freeShipping?: boolean;
  availability?: "available" | "unavailable" | "unknown";
}

export interface MercadoLivreSearchClient {
  search(query: string): Promise<MercadoLivreSearchItem[]>;
}
