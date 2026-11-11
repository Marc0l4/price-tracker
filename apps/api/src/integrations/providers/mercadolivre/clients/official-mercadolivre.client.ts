import { ProviderError } from "../../../../shared/errors/provider-error.js";
import type { MercadoLivreSearchClient, MercadoLivreSearchItem } from "../mercadolivre-search-item.js";
import { mercadoLivreSearchSchema } from "../mercadolivre.schemas.js";

/** Cliente oficial experimental, preservado para uso futuro com OAuth. */
export class OfficialMercadoLivreClient implements MercadoLivreSearchClient {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = "https://api.mercadolibre.com",
    private readonly timeoutMs = 5_000,
    private readonly accessToken: string | undefined = process.env.MERCADOLIVRE_ACCESS_TOKEN,
  ) {}

  async search(query: string): Promise<MercadoLivreSearchItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = new URL("/sites/MLB/search", this.baseUrl);
    url.searchParams.set("q", query);
    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        ...(this.accessToken?.trim() ? { headers: { Authorization: `Bearer ${this.accessToken}` } } : {}),
      });
      if (!response.ok) throw new ProviderError("mercadolivre", "http_error", `Mercado Livre respondeu HTTP ${response.status}.`);
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new ProviderError("mercadolivre", "invalid_response", "A resposta oficial não contém JSON válido."); }
      const parsed = mercadoLivreSearchSchema.safeParse(payload);
      if (!parsed.success) throw new ProviderError("mercadolivre", "invalid_response", "A resposta oficial não tem o formato esperado.");
      return parsed.data.results.map((item) => ({
        externalId: item.id, externalOfferId: item.id, name: item.title,
        productUrl: item.permalink, price: item.price, currency: item.currency_id,
        imageUrl: item.thumbnail,
        brand: item.attributes?.find((attribute) => attribute.id === "BRAND")?.value_name ?? undefined,
        model: item.attributes?.find((attribute) => attribute.id === "MODEL")?.value_name ?? undefined,
        gtin: item.attributes?.find((attribute) => attribute.id === "GTIN")?.value_name ?? undefined,
        storeName: item.seller?.nickname, freeShipping: item.shipping?.free_shipping,
        availability: item.available_quantity === undefined ? "unknown" : item.available_quantity > 0 ? "available" : "unavailable",
      }));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw new ProviderError("mercadolivre", "timeout", "A busca no Mercado Livre excedeu o tempo limite.");
      throw new ProviderError("mercadolivre", "network_error", "Não foi possível consultar o Mercado Livre.");
    } finally { clearTimeout(timeout); }
  }
}
