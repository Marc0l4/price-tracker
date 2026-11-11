export type Availability = "available" | "unavailable" | "unknown";

export interface NormalizedOffer {
  externalOfferId: string;
  price: number;
  currency: string;
  shipping?: {
    isFree?: boolean;
  };
  productUrl: string;
  provider: string;
  storeName?: string;
  availability: Availability;
}

export interface NormalizedProduct {
  externalId: string;
  name: string;
  brand?: string;
  model?: string;
  gtin?: string;
  imageUrl?: string;
  offers: NormalizedOffer[];
}

export interface NormalizedSearchResult {
  products: NormalizedProduct[];
  providerErrors: ProviderSearchError[];
}

export interface ProviderSearchError {
  provider: string;
  code: "configuration_error" | "http_error" | "network_error" | "timeout" | "invalid_response";
  message: string;
}
