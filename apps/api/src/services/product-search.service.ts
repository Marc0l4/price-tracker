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

export interface ProductSearchOptions {
  budgetMs?: number;
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

  async searchDetailed(query: string, options: ProductSearchOptions = {}): Promise<DetailedSearchResult> {
    const controller = new AbortController();
    const startedAt = this.providers.map(() => new Date());
    const pending = this.providers.map((provider, index) => {
      return (async (): Promise<ProviderSearchOutcome> => {
        const providerStartedAt = startedAt[index];
        try {
          const products = await provider.searchProducts(query, controller.signal);
          const finishedAt = new Date();
          return { provider: provider.name, status: "success" as const, products, startedAt: providerStartedAt, finishedAt,
            durationMs: finishedAt.getTime() - providerStartedAt.getTime() };
        } catch (error) {
          const finishedAt = new Date();
          const providerError = error instanceof ProviderError ? error.toSearchError() : {
            provider: provider.name,
            code: "network_error" as const,
            message: "O provider falhou inesperadamente.",
          };
          return { provider: provider.name, status: "failed" as const, products: [], error: providerError, startedAt: providerStartedAt,
            finishedAt, durationMs: finishedAt.getTime() - providerStartedAt.getTime() };
        }
      })();
    });
    const providers = await this.untilBudget(pending, this.providers, options.budgetMs, controller, startedAt);
    return {
      products: providers.flatMap((provider) => provider.products),
      providerErrors: providers.flatMap((provider) => provider.error ? [provider.error] : []),
      providers,
    };
  }

  private async untilBudget(
    pending: Promise<ProviderSearchOutcome>[],
    definitions: ProductProvider[],
    budgetMs: number | undefined,
    controller: AbortController,
    startedAt: Date[],
  ): Promise<ProviderSearchOutcome[]> {
    if (!budgetMs || !Number.isFinite(budgetMs) || budgetMs <= 0) return Promise.all(pending);
    const settled = new Array<ProviderSearchOutcome | undefined>(pending.length);
    let remaining = pending.length;
    let finishBudget!: () => void;
    const deadline = new Promise<void>((resolve) => { finishBudget = resolve; });
    const timer = setTimeout(finishBudget, budgetMs);
    pending.forEach((promise, index) => void promise.then((outcome) => {
      settled[index] = outcome;
      remaining -= 1;
      if (remaining === 0) finishBudget();
    }));
    await deadline;
    clearTimeout(timer);
    if (remaining > 0) controller.abort();
    const finishedAt = new Date();
    return definitions.map((provider, index) => settled[index] ?? {
      provider: provider.name,
      status: "failed" as const,
      products: [],
      error: { provider: provider.name, code: "timeout" as const, message: "A busca excedeu o budget interativo." },
      startedAt: startedAt[index],
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt[index].getTime(),
    });
  }
}
