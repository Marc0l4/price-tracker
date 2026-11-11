import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { PrismaClient } from "../generated/prisma/client.js";
import { PriceHistoryService, type HistoryPeriod } from "../read/price-history.service.js";
import { ProductQueryService } from "../read/product-query.service.js";
import type { ProductSearchSort } from "../read/repositories/product-read.repository.js";
import { ReadApiError } from "../read/read-errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIODS = new Set<HistoryPeriod>(["30d", "90d", "180d", "all"]);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PRODUCT_SORTS = new Set<ProductSearchSort>(["history", "price"]);

export interface ReadApiServerOptions {
  corsOrigin: string;
  version?: string;
}

function json(response: ServerResponse, status: number, body: unknown, corsOrigin: string): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(body));
}

function requiredUuid(value: string): string {
  if (!UUID.test(value)) throw new ReadApiError(400, "invalid_uuid", "UUID inválido.");
  return value;
}

function positiveInt(value: string | null, fallback: number, name: string, max?: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new ReadApiError(400, `invalid_${name}`, `${name} inválido.`);
  const parsed = Number(value);
  if (parsed < 1 || (max !== undefined && parsed > max)) throw new ReadApiError(400, `invalid_${name}`, `${name} inválido.`);
  return parsed;
}

function currency(value: string | null): string {
  const result = value ?? "BRL";
  if (!/^[A-Z]{3}$/.test(result)) throw new ReadApiError(400, "invalid_currency", "Currency deve usar três letras maiúsculas.");
  return result;
}

function productSort(value: string | null): ProductSearchSort {
  const result = value ?? "history";
  if (!PRODUCT_SORTS.has(result as ProductSearchSort)) throw new ReadApiError(400, "invalid_sort", "Ordenação inválida.");
  return result as ProductSearchSort;
}

function date(value: string | null, endOfDay = false): Date | undefined {
  if (value === null) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ReadApiError(400, "invalid_date", "Data inválida.");
  return parsed;
}

function historyOptions(params: URLSearchParams) {
  const from = date(params.get("from"));
  const to = date(params.get("to"), true);
  const periodValue = params.get("period");
  if (periodValue !== null && (from || to)) throw new ReadApiError(400, "invalid_history_filter", "Use period ou from/to, não ambos.");
  if (periodValue !== null && !PERIODS.has(periodValue as HistoryPeriod)) throw new ReadApiError(400, "invalid_period", "Período inválido.");
  return { period: periodValue === null ? undefined : periodValue as HistoryPeriod, from, to };
}

export function createReadApiServer(db: PrismaClient, options: ReadApiServerOptions = { corsOrigin: "http://localhost:3000" }): Server {
  const products = new ProductQueryService(db);
  const history = new PriceHistoryService(db);
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": options.corsOrigin,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Accept, Content-Type",
          "Access-Control-Max-Age": "86400",
        });
        response.end();
        return;
      }
      if (request.method !== "GET") throw new ReadApiError(404, "route_not_found", "Rota não encontrada.");
      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.pathname === "/health") {
        try {
          await db.$queryRaw`SELECT 1`;
          return json(response, 200, { status: "ok", database: "ok", timestamp: new Date().toISOString(), ...(options.version ? { version: options.version } : {}) }, options.corsOrigin);
        } catch {
          return json(response, 503, { status: "degraded", database: "unavailable", timestamp: new Date().toISOString() }, options.corsOrigin);
        }
      }
      if (url.pathname === "/products") {
        const query = url.searchParams.get("query");
        if (!query?.trim()) throw new ReadApiError(400, "invalid_query", "Query é obrigatória.");
        return json(response, 200, await products.search(query, positiveInt(url.searchParams.get("page"), 1, "page"),
          positiveInt(url.searchParams.get("limit"), DEFAULT_LIMIT, "limit", MAX_LIMIT), currency(url.searchParams.get("currency")), productSort(url.searchParams.get("sort"))), options.corsOrigin);
      }
      if (parts[0] === "products" && parts.length >= 2) {
        const id = requiredUuid(parts[1]);
        if (parts.length === 2) return json(response, 200, await products.product(id), options.corsOrigin);
        await products.requireProduct(id);
        if (parts[2] === "offers" && parts.length === 3) {
          const selectedCurrency = url.searchParams.get("currency") ?? undefined;
          const offers = await history.activeOffers(id, selectedCurrency);
          return json(response, 200, { offers, bestOffers: await history.bestOffers(id, selectedCurrency) }, options.corsOrigin);
        }
        if (parts[2] === "history" && parts.length === 3)
          return json(response, 200, await history.history(id, currency(url.searchParams.get("currency")), historyOptions(url.searchParams)), options.corsOrigin);
        if (parts[2] === "analytics" && parts.length === 3)
          return json(response, 200, await history.statistics(id, currency(url.searchParams.get("currency")), historyOptions(url.searchParams)), options.corsOrigin);
      }
      if (parts[0] === "offers" && parts.length === 3 && parts[2] === "history")
        return json(response, 200, await history.offerHistory(requiredUuid(parts[1]), currency(url.searchParams.get("currency")), historyOptions(url.searchParams)), options.corsOrigin);
      throw new ReadApiError(404, "route_not_found", "Rota não encontrada.");
    } catch (error) {
      if (error instanceof ReadApiError) return json(response, error.status, { error: { code: error.code, message: error.message } }, options.corsOrigin);
      return json(response, 500, { error: { code: "internal_error", message: "Erro interno ao consultar dados." } }, options.corsOrigin);
    }
  });
}

export { DEFAULT_LIMIT, MAX_LIMIT };
