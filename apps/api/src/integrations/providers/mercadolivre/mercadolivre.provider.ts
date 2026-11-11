import type { ProductProvider } from "../../contracts/product-provider.js";
import type { NormalizedProduct } from "../../../types/normalized-product.js";
import { mapMercadoLivreSearchItem } from "./mercadolivre.mapper.js";
import type { MercadoLivreSearchClient } from "./mercadolivre-search-item.js";
import { ScavioMercadoLivreClient } from "./clients/scavio-mercadolivre.client.js";

export class MercadoLivreProvider implements ProductProvider {
  readonly name = "mercadolivre";

  constructor(private readonly client: MercadoLivreSearchClient = new ScavioMercadoLivreClient()) {}

  async searchProducts(query: string): Promise<NormalizedProduct[]> {
    return (await this.client.search(query)).map(mapMercadoLivreSearchItem);
  }
}
