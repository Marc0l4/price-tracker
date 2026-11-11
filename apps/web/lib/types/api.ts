export type PriceClassification = "low" | "normal" | "high" | "insufficient_data";
export type MatchStatus = "confirmed" | "provisional" | "review_required";
export type HistoryPeriod = "30d" | "90d" | "180d" | "all";
export type ProductSearchSort = "history" | "price";

export interface ProductSummary { id: string; name: string; brand: string | null; model: string | null; matchStatus: MatchStatus; imageUrl: string | null; currentPrice: string | null; currency: string | null; }
export interface ProductSearchResponse { page: number; limit: number; total: number; items: ProductSummary[]; }
export interface ProductActiveOffer { id: string; provider: string; storeName: string | null; productUrl: string; availability: string; shippingIsFree: boolean | null; lastSeenAt: string; currency: string; currentPrice: string; observedAt: string; }
export interface ProductDetail { id: string; name: string; brand: string | null; model: string | null; gtin: string | null; matchStatus: MatchStatus; imageUrl: string | null; providers: string[]; activeOffers: ProductActiveOffer[]; }
export interface Offer { id: string; provider: string; storeName: string | null; productUrl: string; availability: string; shippingIsFree: boolean | null; lastSeenAt: string; currency: string; price: string; observedAt: string; }
export interface OffersResponse { offers: Offer[]; bestOffers: Offer[]; }
export interface Analytics { currency: string; currentPrice: string | null; lowestPrice: string | null; lowestPriceAt: string | null; highestPrice: string | null; averagePrice: string | null; observationCount: number; firstObservedAt: string | null; lastObservedAt: string | null; percentFromAverage: string | null; classification: PriceClassification; }
export interface HistoryPoint { periodStart: string; periodEnd: string; minPrice: string; maxPrice: string; averagePrice: string; lastPrice: string; lastObservedAt: string; observationCount: number; }
export interface HistoryResponse { currency: string; granularity: "raw" | "day" | "week"; from: string | null; to: string | null; points: HistoryPoint[]; }
