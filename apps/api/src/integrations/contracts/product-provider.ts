import type { NormalizedProduct } from "../../types/normalized-product.js";

export interface ProductProvider {
  readonly name: string;
  searchProducts(query: string): Promise<NormalizedProduct[]>;
}
