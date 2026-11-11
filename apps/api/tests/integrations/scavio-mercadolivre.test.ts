import fixture from "./fixtures/scavio-mercadolivre-search.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scavioMercadoLivreSearchSchema } from "../../src/integrations/providers/mercadolivre/scavio-mercadolivre.schemas.js";
import { ScavioMercadoLivreClient, translateScavioMercadoLivreItem } from "../../src/integrations/providers/mercadolivre/clients/scavio-mercadolivre.client.js";
import { MercadoLivreProvider } from "../../src/integrations/providers/mercadolivre/mercadolivre.provider.js";
import { mapMercadoLivreSearchItem } from "../../src/integrations/providers/mercadolivre/mercadolivre.mapper.js";
import { AmazonProvider } from "../../src/integrations/providers/amazon/amazon.provider.js";
import { ProductSearchService } from "../../src/services/product-search.service.js";
import { ProviderError } from "../../src/shared/errors/provider-error.js";
import type { ProductProvider } from "../../src/integrations/contracts/product-provider.js";

afterEach(() => vi.useRealTimers());

describe("Mercado Livre via Scavio", () => {
  it("valida schema, traduz para tipo interno e mapeia sem nome Scavio", () => {
    const parsed = scavioMercadoLivreSearchSchema.parse(fixture);
    const internal = translateScavioMercadoLivreItem(parsed.data.results[0]);
    expect(internal).toMatchObject({ externalId: "MLB52845211", externalOfferId: "MLB5879981504", name: "Fone Bluetooth Samsung Galaxy Buds Core Preto", price: 242.48, currency: "BRL", brand: "Samsung", imageUrl: "https://http2.mlstatic.com/D_NQ_NP_EXAMPLE-O.webp" });
    expect(mapMercadoLivreSearchItem(internal)).toMatchObject({ externalId: "MLB52845211", offers: [{ externalOfferId: "MLB5879981504", provider: "mercadolivre", storeName: "Samsung", shipping: { isFree: true } }] });
  });

  it("busca Brasil via POST e retorna produto normalizado", async () => {
    const fetchMock = vi.fn(async () => Response.json(fixture));
    const products = await new MercadoLivreProvider(new ScavioMercadoLivreClient("test-key", fetchMock)).searchProducts("fone bluetooth");
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.scavio.dev/api/v1/mercadolibre/search");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ country: "br", query: "fone bluetooth" });
    expect(options.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(products[0].offers[0].provider).toBe("mercadolivre");
  });

  it("chave ausente produz configuration_error sem chamar HTTP", async () => {
    const fetchMock = vi.fn(async () => Response.json(fixture));
    await expect(new ScavioMercadoLivreClient("", fetchMock).search("fone")).rejects.toMatchObject({ code: "configuration_error", provider: "mercadolivre" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP não-2xx preserva status", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 429 }));
    await expect(new ScavioMercadoLivreClient("test-key", fetchMock).search("fone")).rejects.toMatchObject({ code: "http_error", message: "Busca Mercado Livre respondeu HTTP 429." });
  });

  it("timeout produz erro controlado", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit): Promise<Response> => new Promise((_resolve, reject) =>
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })));
    const request = new ScavioMercadoLivreClient("test-key", fetchMock, 100).search("fone");
    const assertion = expect(request).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("JSON malformado e schema inválido produzem invalid_response", async () => {
    const broken = vi.fn(async () => new Response("{broken", { status: 200 }));
    const invalid = vi.fn(async () => Response.json({ data: { results: [{ item_id: "MLB1" }] } }));
    await expect(new ScavioMercadoLivreClient("test-key", broken).search("fone")).rejects.toMatchObject({ code: "invalid_response" });
    await expect(new ScavioMercadoLivreClient("test-key", invalid).search("fone")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("falha de rede produz network_error", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => { throw new TypeError("private detail"); });
    await expect(new ScavioMercadoLivreClient("test-key", fetchMock).search("fone")).rejects.toMatchObject({ code: "network_error" });
  });

  it("aceita array vazio sem erro", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { results: [] } }));
    expect(await new MercadoLivreProvider(new ScavioMercadoLivreClient("test-key", fetchMock)).searchProducts("fone")).toEqual([]);
  });

  it("preserva produto sem preço como produto sem oferta", () => {
    const item = scavioMercadoLivreSearchSchema.parse(fixture).data.results[0];
    expect(mapMercadoLivreSearchItem(translateScavioMercadoLivreItem({ ...item, price: null })).offers).toEqual([]);
  });
});

describe("agregação Amazon + Mercado Livre intermediário", () => {
  const mercado = new MercadoLivreProvider(new ScavioMercadoLivreClient("test-key", vi.fn(async () => Response.json(fixture))));
  const amazon: ProductProvider = { name: "amazon", searchProducts: async () => [{ externalId: "ASIN1", name: "Amazon", offers: [] }] };
  const failing = (name: string): ProductProvider => ({ name, searchProducts: async () => { throw new ProviderError(name, "http_error", `${name} falhou`); } });

  it("ambos funcionando", async () => {
    const result = await new ProductSearchService([mercado, amazon]).search("fone");
    expect(result.products.map((product) => product.externalId)).toEqual(["MLB52845211", "ASIN1"]);
    expect(result.providerErrors).toEqual([]);
  });
  it("Amazon falha e Mercado Livre permanece", async () => {
    const result = await new ProductSearchService([mercado, failing("amazon")]).search("fone");
    expect(result.products).toHaveLength(1);
    expect(result.providerErrors[0].provider).toBe("amazon");
  });
  it("Mercado Livre falha e Amazon permanece", async () => {
    const result = await new ProductSearchService([failing("mercadolivre"), amazon]).search("fone");
    expect(result.products).toHaveLength(1);
    expect(result.providerErrors[0].provider).toBe("mercadolivre");
  });
  it("ambos falham", async () => {
    const result = await new ProductSearchService([failing("mercadolivre"), failing("amazon")]).search("fone");
    expect(result.products).toEqual([]);
    expect(result.providerErrors).toHaveLength(2);
  });
});
