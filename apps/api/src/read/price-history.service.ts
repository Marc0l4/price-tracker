import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { notFound, ReadApiError } from "./read-errors.js";
import type { CurrentOffer, HistoryResult, PriceStatistics } from "./read-types.js";
import { PriceAnalyticsRepository, type CurrentOfferRow } from "./repositories/price-analytics.repository.js";

const MINIMUM_OBSERVATIONS = 2;
const MAX_RAW_OBSERVATIONS = 500;

export type HistoryPeriod = "30d" | "90d" | "180d" | "all";
export interface HistoryOptions { period?: HistoryPeriod; from?: Date; to?: Date; now?: Date; }

function amount(value: Prisma.Decimal | null): string | null { return value ? value.toFixed(4) : null; }
function mapOffer(row: CurrentOfferRow): CurrentOffer {
  return { ...row, price: row.price.toFixed(4) };
}

export class PriceHistoryService {
  private readonly analytics: PriceAnalyticsRepository;

  constructor(db: PrismaClient) { this.analytics = new PriceAnalyticsRepository(db); }

  async statistics(canonicalProductId: string, currency = "BRL", options: HistoryOptions = {}): Promise<PriceStatistics> {
    this.assertCurrency(currency);
    const range = this.resolveRange(options);
    const [aggregate, lowest, offers] = await Promise.all([
      this.analytics.aggregate(canonicalProductId, currency, range.from, range.to),
      this.analytics.lowest(canonicalProductId, currency, range.from, range.to),
      this.analytics.currentOffers(canonicalProductId, currency, range.from, range.to),
    ]);
    const current = this.lowestCurrent(offers);
    const observationCount = Number(aggregate?.observationCount ?? 0n);
    const average = aggregate?.averagePrice ?? null;
    const classification = this.classify(current?.price ?? null, average, observationCount);
    const percent = classification !== "insufficient_data" && current && average && !average.isZero()
      ? current.price.minus(average).div(average).mul(100).toDecimalPlaces(2).toFixed(2) : null;
    return {
      currency,
      currentPrice: current ? amount(current.price) : null,
      lowestPrice: amount(aggregate?.lowestPrice ?? null),
      lowestPriceAt: lowest?.collectedAt ?? null,
      highestPrice: amount(aggregate?.highestPrice ?? null),
      averagePrice: amount(average),
      observationCount,
      firstObservedAt: aggregate?.firstObservedAt ?? null,
      lastObservedAt: aggregate?.lastObservedAt ?? null,
      percentFromAverage: percent,
      classification,
    };
  }

  async history(canonicalProductId: string, currency = "BRL", options: HistoryOptions = {}): Promise<HistoryResult> {
    this.assertCurrency(currency);
    const range = this.resolveRange(options);
    const count = await this.analytics.count(canonicalProductId, currency, range.from, range.to);
    const spanDays = range.from && range.to ? (range.to.getTime() - range.from.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
    if (count <= MAX_RAW_OBSERVATIONS) {
      const rows = await this.analytics.rawHistory(canonicalProductId, currency, range.from, range.to);
      return { currency, granularity: "raw", from: range.from ?? null, to: range.to ?? null, points: rows.map((row) => ({
        periodStart: row.collectedAt, periodEnd: row.collectedAt, minPrice: row.price.toFixed(4), maxPrice: row.price.toFixed(4),
        averagePrice: row.price.toFixed(4), lastPrice: row.price.toFixed(4), lastObservedAt: row.collectedAt, observationCount: 1,
      })) };
    }
    const granularity = spanDays > 180 ? "week" : "day";
    const rows = await this.analytics.history(canonicalProductId, currency, range.from, range.to, granularity);
    return { currency, granularity, from: range.from ?? null, to: range.to ?? null, points: rows.map((row) => ({
      periodStart: row.periodStart, periodEnd: row.periodEnd, minPrice: row.minPrice.toFixed(4), maxPrice: row.maxPrice.toFixed(4),
      averagePrice: row.averagePrice.toFixed(4), lastPrice: row.lastPrice.toFixed(4), lastObservedAt: row.lastObservedAt,
      observationCount: Number(row.observationCount),
    })) };
  }

  async activeOffers(canonicalProductId: string, currency?: string): Promise<CurrentOffer[]> {
    if (currency) this.assertCurrency(currency);
    return (await this.analytics.currentOffers(canonicalProductId, currency)).map(mapOffer)
      .sort((left, right) => left.currency.localeCompare(right.currency) || new Prisma.Decimal(left.price).cmp(new Prisma.Decimal(right.price)));
  }

  async bestOffers(canonicalProductId: string, currency?: string): Promise<CurrentOffer[]> {
    const offers = await this.activeOffers(canonicalProductId, currency);
    const best = new Map<string, CurrentOffer>();
    for (const offer of offers) if (!best.has(offer.currency)) best.set(offer.currency, offer);
    return [...best.values()];
  }

  async offerHistory(offerId: string, currency = "BRL", options: HistoryOptions = {}) {
    this.assertCurrency(currency);
    if (!await this.analytics.offerExists(offerId)) throw notFound("offer");
    const range = this.resolveRange(options);
    const observations = await this.analytics.offerHistory(offerId, currency, range.from, range.to);
    return { offerId, currency, observations: observations.map((item) => ({ price: item.price.toFixed(4), collectedAt: item.collectedAt })) };
  }

  resolveRange(options: HistoryOptions): { from?: Date; to?: Date } {
    const hasCustom = options.from !== undefined || options.to !== undefined;
    if (hasCustom && (!options.from || !options.to)) throw new ReadApiError(400, "invalid_date_range", "from e to devem ser informados juntos.");
    if (hasCustom) {
      if (!Number.isFinite(options.from!.getTime()) || !Number.isFinite(options.to!.getTime()) || options.from! > options.to!)
        throw new ReadApiError(400, "invalid_date_range", "Intervalo de datas inválido.");
      return { from: options.from, to: options.to };
    }
    const period = options.period ?? "30d";
    if (period === "all") return {};
    const days = period === "30d" ? 30 : period === "90d" ? 90 : period === "180d" ? 180 : undefined;
    if (!days) throw new ReadApiError(400, "invalid_period", "Período inválido.");
    const to = options.now ?? new Date();
    return { from: new Date(to.getTime() - days * 86_400_000), to };
  }

  private lowestCurrent(offers: CurrentOfferRow[]): CurrentOfferRow | undefined {
    return offers.reduce<CurrentOfferRow | undefined>((lowest, offer) => !lowest || offer.price.lessThan(lowest.price) ? offer : lowest, undefined);
  }

  private classify(current: Prisma.Decimal | null, average: Prisma.Decimal | null, observationCount: number): PriceStatistics["classification"] {
    if (!current || !average || average.isZero() || observationCount < MINIMUM_OBSERVATIONS) return "insufficient_data";
    if (current.lessThanOrEqualTo(average.mul(0.95))) return "low";
    if (current.greaterThanOrEqualTo(average.mul(1.05))) return "high";
    return "normal";
  }

  private assertCurrency(currency: string): void {
    if (!/^[A-Z]{3}$/.test(currency)) throw new ReadApiError(400, "invalid_currency", "Currency deve usar três letras maiúsculas.");
  }
}

export { MINIMUM_OBSERVATIONS };
