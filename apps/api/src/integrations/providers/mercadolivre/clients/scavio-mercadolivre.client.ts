import { ProviderError } from "../../../../shared/errors/provider-error.js";
import type { MercadoLivreSearchClient, MercadoLivreSearchItem } from "../mercadolivre-search-item.js";
import { scavioMercadoLivreSearchSchema, type ScavioMercadoLivreItem } from "../scavio-mercadolivre.schemas.js";
import { scavioRequestLimiter } from "../../../scavio/scavio-request-limiter.js";

export function translateScavioMercadoLivreItem(item: ScavioMercadoLivreItem): MercadoLivreSearchItem {
  return {
    externalId: item.product_id ?? item.item_id, externalOfferId: item.item_id,
    name: item.title, productUrl: item.url,
    price: item.price ?? undefined, currency: item.currency ?? undefined,
    imageUrl: item.image ?? item.thumbnail ?? undefined, brand: item.brand ?? undefined,
    storeName: item.seller?.name ?? undefined, freeShipping: item.free_shipping ?? undefined,
    availability: "unknown",
  };
}

export class ScavioMercadoLivreClient implements MercadoLivreSearchClient {
  constructor(
    private readonly apiKey: string | undefined = process.env.SCAVIO_API_KEY,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async search(query: string): Promise<MercadoLivreSearchItem[]> {
    if (!this.apiKey?.trim()) throw new ProviderError("mercadolivre", "configuration_error", "SCAVIO_API_KEY não configurada.");
    return scavioRequestLimiter.run(this.apiKey, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn("https://api.scavio.dev/api/v1/mercadolibre/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ country: "br", query }), signal: controller.signal,
      });
      if (!response.ok) throw new ProviderError("mercadolivre", "http_error", `Busca Mercado Livre respondeu HTTP ${response.status}.`);
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new ProviderError("mercadolivre", "invalid_response", "A resposta Mercado Livre não contém JSON válido."); }
      const parsed = scavioMercadoLivreSearchSchema.safeParse(payload);
      if (!parsed.success) throw new ProviderError("mercadolivre", "invalid_response", "A resposta Mercado Livre não tem o formato esperado.");
      return parsed.data.data.results.map(translateScavioMercadoLivreItem);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw new ProviderError("mercadolivre", "timeout", "A busca Mercado Livre excedeu o tempo limite.");
      throw new ProviderError("mercadolivre", "network_error", "Não foi possível consultar a busca Mercado Livre.");
    } finally { clearTimeout(timeout); }
    });
  }
}
