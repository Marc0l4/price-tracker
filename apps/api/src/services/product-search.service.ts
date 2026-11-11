import type { ProductProvider } from "../integrations/contracts/product-provider.js";
import type { NormalizedSearchResult, ProviderSearchError } from "../types/normalized-product.js";
import { ProviderError } from "../shared/errors/provider-error.js";

export interface ProviderSearchOutcome {
  provider: string;
  status: "success" | "failed";
  products: NormalizedSearchResult["products"];
  error?: ProviderSearchError;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

export interface DetailedSearchResult extends NormalizedSearchResult {
  providers: ProviderSearchOutcome[];
}

export class ProductSearchService {
  constructor(private readonly providers: ProductProvider[]) {}

  get providerNames(): string[] {
    return this.providers.map((provider) => provider.name);
  }

  async search(query: string): Promise<NormalizedSearchResult> {
    const detailed = await this.searchDetailed(query);
    return { products: detailed.products, providerErrors: detailed.providerErrors };
  }

  async searchDetailed(query: string): Promise<DetailedSearchResult> {
    const providers = await Promise.all(
      this.providers.map(async (provider) => {
        const startedAt = new Date();
        try {
          const products = await provider.searchProducts(query);
          const finishedAt = new Date();
          return { provider: provider.name, status: "success" as const, products, startedAt, finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime() };
        } catch (error) {
          const finishedAt = new Date();
          const providerError = error instanceof ProviderError ? error.toSearchError() : {
            provider: provider.name,
            code: "network_error" as const,
            message: "O provider falhou inesperadamente.",
          };
          return { provider: provider.name, status: "failed" as const, products: [], error: providerError, startedAt,
            finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime() };
        }
      }),
    );
    return {
      products: providers.flatMap((provider) => provider.products),
      providerErrors: providers.flatMap((provider) => provider.error ? [provider.error] : []),
      providers,
    };
  }
}
