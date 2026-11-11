import { ProviderError } from "../../../../shared/errors/provider-error.js";
import { scavioAmazonSearchSchema, type ScavioAmazonItem } from "../amazon.schemas.js";
import type { AmazonSearchItem } from "../amazon-search-item.js";
import type { AmazonSearchClient } from "../amazon.provider.js";
import { scavioRequestLimiter } from "../../../scavio/scavio-request-limiter.js";
import { scavioAmazonTimeoutMsFromEnvironment } from "../../../../collection/collection-config.js";

export function translateScavioAmazonItem(item: ScavioAmazonItem): AmazonSearchItem {
  return {
    externalId: item.asin,
    name: item.title,
    productUrl: item.url,
    imageUrl: item.image ?? undefined,
    price: item.price ?? undefined,
    currency: item.currency ?? undefined,
  };
}

export class ScavioAmazonClient implements AmazonSearchClient {
  constructor(
    private readonly apiKey: string | undefined = process.env.SCAVIO_API_KEY,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = scavioAmazonTimeoutMsFromEnvironment(),
  ) {}

  async search(query: string): Promise<AmazonSearchItem[]> {
    if (!this.apiKey?.trim()) {
      throw new ProviderError("amazon", "configuration_error", "SCAVIO_API_KEY não configurada.");
    }

    return scavioRequestLimiter.run(this.apiKey, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn("https://api.scavio.dev/api/v1/amazon/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, country: "br" }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProviderError("amazon", "http_error", `Busca Amazon respondeu HTTP ${response.status}.`);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ProviderError("amazon", "invalid_response", "A resposta da busca Amazon não contém JSON válido.");
      }
      const parsed = scavioAmazonSearchSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ProviderError("amazon", "invalid_response", "A resposta da busca Amazon não tem o formato esperado.");
      }
      return parsed.data.data.products.map(translateScavioAmazonItem);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ProviderError("amazon", "timeout", "A busca Amazon excedeu o tempo limite.");
      }
      throw new ProviderError("amazon", "network_error", "Não foi possível consultar a busca Amazon.");
    } finally {
      clearTimeout(timeout);
    }
    });
  }
}
