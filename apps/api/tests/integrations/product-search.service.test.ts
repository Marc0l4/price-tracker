import { describe, expect, it } from "vitest";
import type { ProductProvider } from "../../src/integrations/contracts/product-provider.js";
import { ProviderError } from "../../src/shared/errors/provider-error.js";
import { ProductSearchService } from "../../src/services/product-search.service.js";

describe("ProductSearchService", () => {
  it("retorna resultados disponíveis quando outro provider falha", async () => {
    const successfulProvider: ProductProvider = {
      name: "provider-ok",
      searchProducts: async () => [{ externalId: "1", name: "Produto", offers: [] }],
    };
    const failingProvider: ProductProvider = {
      name: "provider-falhou",
      searchProducts: async () => { throw new ProviderError("provider-falhou", "timeout", "Tempo esgotado."); },
    };

    const result = await new ProductSearchService([successfulProvider, failingProvider]).search("produto");

    expect(result.products).toHaveLength(1);
    expect(result.providerErrors).toEqual([{
      provider: "provider-falhou",
      code: "timeout",
      message: "Tempo esgotado.",
    }]);
  });

  it("registra sucesso completo inclusive para resposta vazia", async () => {
    const provider: ProductProvider = { name: "provider-vazio", searchProducts: async () => [] };
    const detailed = await new ProductSearchService([provider]).searchDetailed("produto");
    expect(detailed.providers).toMatchObject([{ provider: "provider-vazio", status: "success", products: [] }]);
    expect(detailed.providers[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
