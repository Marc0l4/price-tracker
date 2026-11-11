import { apiGet } from "./client";
import type { Analytics, HistoryPeriod, HistoryResponse, OffersResponse, ProductDetail, ProductSearchResponse, ProductSearchSort } from "../types/api";

const params = (input: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined) search.set(key, String(value));
  return search.toString();
};

export const searchProducts = (query: string, page = 1, sort: ProductSearchSort = "history") => apiGet<ProductSearchResponse>(`/products?${params({ query, page, limit: 20, sort })}`);
export const getProduct = (id: string) => apiGet<ProductDetail>(`/products/${encodeURIComponent(id)}`);
export const getOffers = (id: string) => apiGet<OffersResponse>(`/products/${encodeURIComponent(id)}/offers`);
export const getAnalytics = (id: string, period: HistoryPeriod) => apiGet<Analytics>(`/products/${encodeURIComponent(id)}/analytics?${params({ period })}`);
export const getHistory = (id: string, period: HistoryPeriod) => apiGet<HistoryResponse>(`/products/${encodeURIComponent(id)}/history?${params({ period })}`);
