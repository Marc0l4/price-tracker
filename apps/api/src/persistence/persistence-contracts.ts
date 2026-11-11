import type { NormalizedProduct } from "../types/normalized-product.js";

export interface SourcedProduct {
  provider: string;
  product: NormalizedProduct;
}

export interface CollectionContext {
  /** Stable identifier of one logical collection run. Retries must reuse it. */
  collectionKey: string;
  /** Absolute instant at which this collection observed the provider response. */
  collectedAt: Date;
  /** Providers whose search completed successfully, including successful empty responses. */
  successfulProviders: string[];
  /** Optional monitored-query scope. Lifecycle changes are limited to its known offers. */
  lifecycleScopeId?: string;
}
