import fixture from "./fixtures/mercadolivre-search.json";
import { describe, expect, it } from "vitest";
import { mercadoLivreSearchSchema } from "../../src/integrations/providers/mercadolivre/mercadolivre.schemas.js";
import { mapMercadoLivreItem } from "../../src/integrations/providers/mercadolivre/mercadolivre.mapper.js";

describe("mapMercadoLivreItem", () => {
  it("normaliza uma publicação sem expor o formato externo", () => {
    const item = mercadoLivreSearchSchema.parse(fixture).results[0];

    expect(mapMercadoLivreItem(item)).toEqual({
      externalId: "MLB1234567890",
      name: "Apple iPhone 15 128 GB Preto",
      brand: "Apple",
      model: "iPhone 15",
      gtin: "0195949030000",
      imageUrl: "https://http2.mlstatic.com/D_TEST-I.jpg",
      offers: [{
        externalOfferId: "MLB1234567890",
        price: 4999.9,
        currency: "BRL",
        shipping: { isFree: true },
        productUrl: "https://produto.mercadolivre.com.br/MLB-1234567890-iphone-15-_JM",
        provider: "mercadolivre",
        storeName: "loja-exemplo",
        availability: "available",
      }],
    });
  });
});
