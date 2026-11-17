import type { ProductProvider } from "../../contracts/product-provider.js";
import type { NormalizedProduct } from "../../../types/normalized-product.js";
import { mapAmazonItem } from "./amazon.mapper.js";
import type { AmazonSearchItem } from "./amazon-search-item.js";
import { ScavioAmazonClient } from "./clients/scavio-amazon.client.js";

export interface AmazonSearchClient {
  search(query: string, signal?: AbortSignal): Promise<AmazonSearchItem[]>;
}

export class AmazonProvider implements ProductProvider {
  readonly name = "amazon";

  constructor(private readonly client: AmazonSearchClient = new ScavioAmazonClient()) {}

  async searchProducts(query: string, signal?: AbortSignal): Promise<NormalizedProduct[]> {
    const items = await this.client.search(query, signal);
    return items.map(mapAmazonItem);
  }
}
