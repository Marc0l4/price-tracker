import fixture from "./fixtures/mercadolivre-search.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficialMercadoLivreClient } from "../../src/integrations/providers/mercadolivre/clients/official-mercadolivre.client.js";
import { MercadoLivreProvider } from "../../src/integrations/providers/mercadolivre/mercadolivre.provider.js";
import { ProviderError } from "../../src/shared/errors/provider-error.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("OfficialMercadoLivreClient via MercadoLivreProvider", () => {
  it("busca por query e normaliza uma resposta HTTP 2xx válida", async () => {
    const fetchMock = vi.fn(async () => Response.json(fixture));
    const provider = new MercadoLivreProvider(new OfficialMercadoLivreClient(fetchMock));

    const products = await provider.searchProducts("iphone 15");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/sites/MLB/search");
    expect(url.searchParams.get("q")).toBe("iphone 15");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(products).toHaveLength(1);
    expect(products[0].externalId).toBe("MLB1234567890");
    expect(products[0].offers[0]).toMatchObject({
      price: 4999.9,
      currency: "BRL",
      provider: "mercadolivre",
    });
  });

  it("envia o access token quando configurado, sem colocá-lo na URL", async () => {
    const fetchMock = vi.fn(async () => Response.json({ results: [] }));
    const provider = new MercadoLivreProvider(new OfficialMercadoLivreClient(fetchMock, "https://api.mercadolibre.com", 5_000, "test-token"));

    expect(await provider.searchProducts("iphone 15")).toEqual([]);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(options.headers).toEqual({ Authorization: "Bearer test-token" });
  });

  it("converte resposta HTTP não-2xx em http_error", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(new MercadoLivreProvider(new OfficialMercadoLivreClient(fetchMock)).searchProducts("iphone"))
      .rejects.toMatchObject({
        name: "ProviderError",
        provider: "mercadolivre",
        code: "http_error",
        message: "Mercado Livre respondeu HTTP 503.",
      } satisfies Partial<ProviderError>);
  });

  it("cancela a requisição ao atingir o timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    );
    const request = new MercadoLivreProvider(new OfficialMercadoLivreClient(fetchMock, "https://api.mercadolibre.com", 100))
      .searchProducts("iphone");
    const assertion = expect(request).rejects.toMatchObject({
      name: "ProviderError",
      provider: "mercadolivre",
      code: "timeout",
    } satisfies Partial<ProviderError>);

    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("converte resposta incompatível com o schema em invalid_response", async () => {
    const fetchMock = vi.fn(async () => Response.json({ results: [{ id: "MLB123", price: "inválido" }] }));

    await expect(new MercadoLivreProvider(new OfficialMercadoLivreClient(fetchMock)).searchProducts("iphone"))
      .rejects.toMatchObject({
        name: "ProviderError",
        provider: "mercadolivre",
        code: "invalid_response",
      } satisfies Partial<ProviderError>);
  });

  it("converte falha de fetch em network_error", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError("Network failed");
    });

    await expect(new MercadoLivreProvider(new OfficialMercadoLivreClient(fetchMock)).searchProducts("iphone"))
      .rejects.toMatchObject({
        name: "ProviderError",
        provider: "mercadolivre",
        code: "network_error",
      } satisfies Partial<ProviderError>);
  });
});
