import fixture from "./fixtures/scavio-amazon-search.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonProvider } from "../../src/integrations/providers/amazon/amazon.provider.js";
import { mapAmazonItem } from "../../src/integrations/providers/amazon/amazon.mapper.js";
import { scavioAmazonSearchSchema } from "../../src/integrations/providers/amazon/amazon.schemas.js";
import { ScavioAmazonClient, translateScavioAmazonItem } from "../../src/integrations/providers/amazon/clients/scavio-amazon.client.js";
import { ProductSearchService } from "../../src/services/product-search.service.js";
import { ProviderError } from "../../src/shared/errors/provider-error.js";
import type { ProductProvider } from "../../src/integrations/contracts/product-provider.js";
import type { NormalizedProduct } from "../../src/types/normalized-product.js";

const amazonProduct: NormalizedProduct = {
  externalId: "B0EXAMPLE1",
  name: "Fone Bluetooth Exemplo",
  imageUrl: "https://m.media-amazon.com/images/I/example.jpg",
  offers: [{ externalOfferId: "B0EXAMPLE1", price: 199.9, currency: "BRL",
    productUrl: "https://www.amazon.com.br/dp/B0EXAMPLE1", provider: "amazon", availability: "unknown" }],
};

afterEach(() => vi.useRealTimers());

describe("Amazon via Scavio", () => {
  it("traduz Scavio para tipo interno Amazon e mapeia o produto", () => {
    const item = scavioAmazonSearchSchema.parse(fixture).data.products[0];
    const internal = translateScavioAmazonItem(item);
    expect(internal).toEqual({ externalId: "B0EXAMPLE1", name: "Fone Bluetooth Exemplo",
      productUrl: "https://www.amazon.com.br/dp/B0EXAMPLE1",
      imageUrl: "https://m.media-amazon.com/images/I/example.jpg", price: 199.9, currency: "BRL" });
    expect(mapAmazonItem(internal)).toEqual(amazonProduct);
  });

  it("preserva produto sem preço, sem criar oferta", async () => {
    const item = translateScavioAmazonItem(scavioAmazonSearchSchema.parse(fixture).data.products[0]);
    const provider = new AmazonProvider({ search: async () => [{ ...item, price: undefined }] });
    expect(await provider.searchProducts("fone")).toEqual([{ ...amazonProduct, offers: [] }]);
  });

  it("preserva produto sem moeda, sem criar oferta", async () => {
    const item = translateScavioAmazonItem(scavioAmazonSearchSchema.parse(fixture).data.products[0]);
    const provider = new AmazonProvider({ search: async () => [{ ...item, currency: undefined }] });
    expect(await provider.searchProducts("fone")).toEqual([{ ...amazonProduct, offers: [] }]);
  });

  it("aceita array vazio de resultados", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { products: [] } }));
    expect(await new AmazonProvider(new ScavioAmazonClient("test-key", fetchMock)).searchProducts("fone"))
      .toEqual([]);
  });

  it("envia POST ao Brasil e retorna produto normalizado", async () => {
    const fetchMock = vi.fn(async () => Response.json(fixture));
    const provider = new AmazonProvider(new ScavioAmazonClient("test-key", fetchMock));
    expect(await provider.searchProducts("fone bluetooth")).toEqual([amazonProduct]);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.scavio.dev/api/v1/amazon/search");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ query: "fone bluetooth", country: "br" });
    expect(options.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("recusa chave ausente sem chamar HTTP", async () => {
    const fetchMock = vi.fn(async () => Response.json(fixture));
    await expect(new AmazonProvider(new ScavioAmazonClient("", fetchMock)).searchProducts("fone"))
      .rejects.toMatchObject({ provider: "amazon", code: "configuration_error", message: "SCAVIO_API_KEY não configurada." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converte HTTP não-2xx em http_error sem expor o corpo", async () => {
    const fetchMock = vi.fn(async () => new Response("secret", { status: 401 }));
    await expect(new AmazonProvider(new ScavioAmazonClient("test-key", fetchMock)).searchProducts("fone"))
      .rejects.toMatchObject({ provider: "amazon", code: "http_error", message: "Busca Amazon respondeu HTTP 401." });
  });

  it("cancela fetch no timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")), { once: true })));
    const request = new AmazonProvider(new ScavioAmazonClient("test-key", fetchMock, 100)).searchProducts("fone");
    const assertion = expect(request).rejects.toMatchObject({ provider: "amazon", code: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("converte payload inválido em invalid_response", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { products: [{ asin: "B0EXAMPLE1" }] } }));
    await expect(new AmazonProvider(new ScavioAmazonClient("test-key", fetchMock)).searchProducts("fone"))
      .rejects.toMatchObject({ provider: "amazon", code: "invalid_response" });
  });

  it("converte JSON malformado em invalid_response", async () => {
    const fetchMock = vi.fn(async () => new Response("{broken", { status: 200 }));
    await expect(new AmazonProvider(new ScavioAmazonClient("test-key", fetchMock)).searchProducts("fone"))
      .rejects.toMatchObject({ provider: "amazon", code: "invalid_response" });
  });

  it("converte falha de rede em network_error", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => { throw new TypeError("private network detail"); });
    await expect(new AmazonProvider(new ScavioAmazonClient("test-key", fetchMock)).searchProducts("fone"))
      .rejects.toMatchObject({ provider: "amazon", code: "network_error", message: "Não foi possível consultar a busca Amazon." });
  });
});

describe("agregação Mercado Livre + Amazon", () => {
  const mercadoProduct: NormalizedProduct = { externalId: "MLB1", name: "Fone ML", offers: [] };
  const mercado: ProductProvider = { name: "mercadolivre", searchProducts: async () => [mercadoProduct] };
  const amazon: ProductProvider = { name: "amazon", searchProducts: async () => [amazonProduct] };

  it("combina resultados simultâneos", async () => {
    expect(await new ProductSearchService([mercado, amazon]).search("fone"))
      .toEqual({ products: [mercadoProduct, amazonProduct], providerErrors: [] });
  });

  it("preserva Mercado Livre quando Amazon falha", async () => {
    const failingAmazon: ProductProvider = { name: "amazon", searchProducts: async () => {
      throw new ProviderError("amazon", "http_error", "Busca Amazon respondeu HTTP 503.");
    } };
    expect(await new ProductSearchService([mercado, failingAmazon]).search("fone"))
      .toEqual({ products: [mercadoProduct], providerErrors: [{ provider: "amazon", code: "http_error", message: "Busca Amazon respondeu HTTP 503." }] });
  });

  it("preserva Amazon quando Mercado Livre falha", async () => {
    const failingMercado: ProductProvider = { name: "mercadolivre", searchProducts: async () => {
      throw new ProviderError("mercadolivre", "timeout", "Tempo esgotado.");
    } };
    expect(await new ProductSearchService([failingMercado, amazon]).search("fone"))
      .toEqual({ products: [amazonProduct], providerErrors: [{ provider: "mercadolivre", code: "timeout", message: "Tempo esgotado." }] });
  });

  it("retorna ambos os erros quando ambos falham", async () => {
    const failing = (name: string): ProductProvider => ({ name, searchProducts: async () => {
      throw new ProviderError(name, "http_error", `${name} falhou`);
    } });
    expect(await new ProductSearchService([failing("mercadolivre"), failing("amazon")]).search("fone"))
      .toEqual({ products: [], providerErrors: [
        { provider: "mercadolivre", code: "http_error", message: "mercadolivre falhou" },
        { provider: "amazon", code: "http_error", message: "amazon falhou" },
      ] });
  });
});
