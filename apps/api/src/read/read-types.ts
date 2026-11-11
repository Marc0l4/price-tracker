export type PriceClassification = "low" | "normal" | "high" | "insufficient_data";
export type HistoryGranularity = "raw" | "day" | "week";

export interface CurrentOffer {
  id: string;
  provider: string;
  storeName: string | null;
  productUrl: string;
  availability: string;
  shippingIsFree: boolean | null;
  lastSeenAt: Date;
  currency: string;
  price: string;
  observedAt: Date;
}

export interface PriceStatistics {
  currency: string;
  currentPrice: string | null;
  lowestPrice: string | null;
  lowestPriceAt: Date | null;
  highestPrice: string | null;
  averagePrice: string | null;
  observationCount: number;
  firstObservedAt: Date | null;
  lastObservedAt: Date | null;
  percentFromAverage: string | null;
  classification: PriceClassification;
}

export interface HistoryPoint {
  periodStart: Date;
  periodEnd: Date;
  minPrice: string;
  maxPrice: string;
  averagePrice: string;
  lastPrice: string;
  lastObservedAt: Date;
  observationCount: number;
}

export interface HistoryResult {
  currency: string;
  granularity: HistoryGranularity;
  from: Date | null;
  to: Date | null;
  points: HistoryPoint[];
}
