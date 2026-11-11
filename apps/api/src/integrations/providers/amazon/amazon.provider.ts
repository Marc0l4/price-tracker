import type { ProductProvider } from "../../contracts/product-provider.js";
import type { NormalizedProduct } from "../../../types/normalized-product.js";
import { mapAmazonItem } from "./amazon.mapper.js";
import type { AmazonSearchItem } from "./amazon-search-item.js";
import { ScavioAmazonClient } from "./clients/scavio-amazon.client.js";

export interface AmazonSearchClient {
  search(query: string): Promise<AmazonSearchItem[]>;
}

export class AmazonProvider implements ProductProvider {
  readonly name = "amazon";

  constructor(private readonly client: AmazonSearchClient = new ScavioAmazonClient()) {}

  async searchProducts(query: string): Promise<NormalizedProduct[]> {
    const items = await this.client.search(query);
    return items.map(mapAmazonItem);
  }
}
