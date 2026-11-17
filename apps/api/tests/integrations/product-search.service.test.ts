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

  it("preserva provider rapido e encerra provider lento no budget", async () => {
    const fast: ProductProvider = {
      name: "fast",
      searchProducts: async () => [{ externalId: "1", name: "Produto", offers: [] }],
    };
    const slow: ProductProvider = {
      name: "slow",
      searchProducts: async (_query, signal) => new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new ProviderError("slow", "timeout", "Abortado.")), { once: true });
      }),
    };
    const startedAt = Date.now();
    const result = await new ProductSearchService([fast, slow]).searchDetailed("produto", { budgetMs: 25 });
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(result.products).toHaveLength(1);
    expect(result.providers).toMatchObject([
      { provider: "fast", status: "success" },
      { provider: "slow", status: "failed", error: { code: "timeout" } },
    ]);
  });
});
