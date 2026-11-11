import amazonFixture from "./fixtures/scavio-amazon-search.json";
import mercadoFixture from "./fixtures/scavio-mercadolivre-search.json";
import { describe, expect, it, vi } from "vitest";
import { AmazonProvider } from "../../src/integrations/providers/amazon/amazon.provider.js";
import { ScavioAmazonClient } from "../../src/integrations/providers/amazon/clients/scavio-amazon.client.js";
import { MercadoLivreProvider } from "../../src/integrations/providers/mercadolivre/mercadolivre.provider.js";
import { ScavioMercadoLivreClient } from "../../src/integrations/providers/mercadolivre/clients/scavio-mercadolivre.client.js";
import { ProductSearchService } from "../../src/services/product-search.service.js";
import type { ProductProvider } from "../../src/integrations/contracts/product-provider.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("limite de concorrência Scavio", () => {
  it("serializa clientes Amazon e Mercado Livre com a mesma chave, sem perder chamadas", async () => {
    const first = deferred<Response>();
    const events: string[] = [];
    const amazonFetch = vi.fn(async () => { events.push("amazon:start"); return first.promise; });
    const mercadoFetch = vi.fn(async () => { events.push("mercado:start"); return Response.json(mercadoFixture); });
    const amazon = new AmazonProvider(new ScavioAmazonClient("shared-key-a", amazonFetch));
    const mercado = new MercadoLivreProvider(new ScavioMercadoLivreClient("shared-key-a", mercadoFetch));
    const search = new ProductSearchService([amazon, mercado]).search("iphone 15");

    await vi.waitFor(() => expect(amazonFetch).toHaveBeenCalledOnce());
    expect(mercadoFetch).not.toHaveBeenCalled();
    first.resolve(Response.json(amazonFixture));
    const result = await search;

    expect(events).toEqual(["amazon:start", "mercado:start"]);
    expect(mercadoFetch).toHaveBeenCalledOnce();
    expect(result.products).toHaveLength(2);
    expect(result.providerErrors).toEqual([]);
  });

  it("libera a próxima chamada quando a primeira falha", async () => {
    const first = deferred<Response>();
    const amazonFetch = vi.fn(async () => first.promise);
    const mercadoFetch = vi.fn(async () => Response.json(mercadoFixture));
    const search = new ProductSearchService([
      new AmazonProvider(new ScavioAmazonClient("shared-key-b", amazonFetch)),
      new MercadoLivreProvider(new ScavioMercadoLivreClient("shared-key-b", mercadoFetch)),
    ]).search("iphone 15");

    await vi.waitFor(() => expect(amazonFetch).toHaveBeenCalledOnce());
    expect(mercadoFetch).not.toHaveBeenCalled();
    first.reject(new TypeError("network failed"));
    const result = await search;

    expect(mercadoFetch).toHaveBeenCalledOnce();
    expect(result.products).toHaveLength(1);
    expect(result.providerErrors).toMatchObject([{ provider: "amazon", code: "network_error" }]);
  });

  it("não bloqueia provider independente enquanto Scavio está ocupada", async () => {
    const first = deferred<Response>();
    const amazonFetch = vi.fn(async () => first.promise);
    const independent = vi.fn(async () => [{ externalId: "other-1", name: "Outro", offers: [] }]);
    const other: ProductProvider = { name: "other", searchProducts: independent };
    const search = new ProductSearchService([
      new AmazonProvider(new ScavioAmazonClient("shared-key-c", amazonFetch)), other,
    ]).search("iphone 15");

    await vi.waitFor(() => expect(amazonFetch).toHaveBeenCalledOnce());
    expect(independent).toHaveBeenCalledOnce();
    first.resolve(Response.json(amazonFixture));
    expect((await search).products).toHaveLength(2);
  });
});
