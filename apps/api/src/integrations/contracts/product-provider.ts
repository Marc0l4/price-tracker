import type { NormalizedProduct } from "../../types/normalized-product.js";

export interface ProductProvider {
  readonly name: string;
  searchProducts(query: string, signal?: AbortSignal): Promise<NormalizedProduct[]>;
}
