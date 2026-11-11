import { describe, expect, it } from "vitest";
import type { NormalizedProduct } from "../../src/types/normalized-product.js";
import { ProductMatcher } from "../../src/matching/product-matcher.js";
import { ProductMatchingService } from "../../src/matching/product-matching.service.js";
import { extractCapacity, extractColors, extractMemory, normalizeText, validGtin } from "../../src/matching/product-normalizer.js";

const product = (name: string, extra: Partial<NormalizedProduct> = {}): NormalizedProduct =>
  ({ externalId: name, name, offers: [], ...extra });
const matcher = new ProductMatcher();

describe("normalização determinística", () => {
  it("normaliza caixa, acento, pontuação, traço e espaços", () => {
    expect(normalizeText("  ÁZUL — 128GB  ")).toBe("azul 128 gb");
    expect(normalizeText("Azul - 128 GB")).toBe("azul 128 gb");
  });
  it("extrai capacidades e cores sem perder variantes", () => {
    expect(extractCapacity("256GB e 1 TB")).toEqual(["1tb", "256gb"]);
    expect(extractColors("Preto / BLUE")).toEqual(["azul", "preto"]);
  });
  it("usa apenas GTIN com dígito verificador válido", () => {
    expect(validGtin("4006381333931")).toBe("4006381333931");
    expect(validGtin("4006381333932")).toBeUndefined();
    expect(validGtin("abc4006381333931")).toBeUndefined();
    expect(validGtin("4006381-333931")).toBe("4006381333931");
  });
  it("separa RAM de armazenamento e iguala 1TB a 1024GB", () => {
    expect(extractMemory("8GB RAM 256GB SSD")).toEqual({ ram: ["8gb"], storage: ["256gb"] });
    expect(extractCapacity("1TB / 1024 GB")).toEqual(["1tb"]);
  });
});

describe("ProductMatcher", () => {
  it("une iPhone 15 de mesma capacidade e cor com score explicável", () => {
    const result = matcher.compare(product("Apple iPhone 15 128 GB Preto"), product("Apple iPhone 15 (128GB) - Preto"));
    expect(result).toMatchObject({ matched: true, confidence: "high", score: 120, conflicts: [] });
    expect(result.reasons).toContain("capacidade igual");
  });
  it("bloqueia capacidade diferente", () => {
    expect(matcher.compare(product("iPhone 15 128GB"), product("iPhone 15 256GB"))).toMatchObject({ matched: false, conflicts: ["capacidade diferente"] });
  });
  it("bloqueia modelo Pro versus base", () => {
    expect(matcher.compare(product("Apple iPhone 15 128GB"), product("Apple iPhone 15 Pro 128GB"))).toMatchObject({ matched: false, conflicts: ["modelo ou versão diferente"] });
  });
  it("bloqueia marcas distintas", () => {
    expect(matcher.compare(product("Galaxy S24 256GB Preto", { brand: "Samsung" }), product("Galaxy S24 256GB Preto", { brand: "Outra" }))).toMatchObject({ matched: false, conflicts: ["marca diferente"] });
  });
  it("GTIN igual gera match forte mesmo com nomes diferentes", () => {
    const result = matcher.compare(product("Produto A", { gtin: "4006381333931" }), product("Nome Comercial B", { gtin: "4006381333931" }));
    expect(result).toMatchObject({ matched: true, confidence: "high", score: 100 });
  });
  it("GTIN diferente bloqueia nomes iguais", () => {
    const result = matcher.compare(product("Apple iPhone 15 128GB Preto", { gtin: "4006381333931" }), product("Apple iPhone 15 128GB Preto", { gtin: "5901234123457" }));
    expect(result).toMatchObject({ matched: false, conflicts: ["GTIN válido diferente"] });
  });
  it("cores diferentes são variantes separadas, inclusive os itens reais observados", () => {
    const amazon = product("Apple iPhone 15 (128 GB) — Preto");
    const mercado = product("Apple iPhone 15 (128 GB) - Azul - Distribuidor Autorizado", { brand: "Apple" });
    expect(matcher.compare(amazon, mercado)).toMatchObject({ matched: false, conflicts: ["cor diferente"] });
  });
  it("aceita ordem diferente e ruído conhecido no título", () => {
    expect(matcher.compare(product("Samsung Galaxy S24 256GB Preto"), product("Galaxy S24 Samsung Preto 256 GB")).matched).toBe(true);
    expect(matcher.compare(product("Apple iPhone 15 128GB Preto - Distribuidor Autorizado"), product("Apple iPhone 15 128 GB Preto")).matched).toBe(true);
  });
  it("não une evidência de variante incompleta sem GTIN", () => {
    const result = matcher.compare(product("Apple iPhone 15 128GB Preto"), product("Apple iPhone 15 Preto"));
    expect(result.matched).toBe(false);
    expect(result.missingEvidence).toContain("capacidade ausente em um lado");
  });
  it.each([
    ["iPhone 15", "iPhone 15 Pro"],
    ["iPhone 15", "iPhone 15 Plus"],
    ["Galaxy S24", "Galaxy S24 FE"],
    ["PlayStation 5", "PlayStation 5 Slim"],
  ])("bloqueia versão explícita: %s vs %s", (base, variant) => {
    const result = matcher.compare(product(`${base} 128GB Preto`, { model: base }), product(`${variant} 128GB Preto`, { model: base }));
    expect(result.matched).toBe(false);
    expect(result.conflicts).toContain("modelo ou versão diferente");
  });
  it("bloqueia Pro Max e geração numérica diferente", () => {
    expect(matcher.compare(product("iPhone 15 Pro 128GB"), product("iPhone 15 Pro Max 128GB")).matched).toBe(false);
    expect(matcher.compare(product("AirPods Pro 2 geracao 128GB"), product("AirPods Pro 3 geracao 128GB")).matched).toBe(false);
  });
  it("bloqueia kit, acessório e condição mesmo com model igual", () => {
    const base = product("Apple iPhone 15 128GB Preto", { model: "iPhone 15" });
    expect(matcher.compare(base, product("Kit Apple iPhone 15 128GB Preto + Capa", { model: "iPhone 15" })).conflicts).toContain("kit ou acessório diferente");
    expect(matcher.compare(base, product("Capa para Apple iPhone 15 128GB Preto", { model: "iPhone 15" })).conflicts).toContain("kit ou acessório diferente");
    expect(matcher.compare(base, product("Apple iPhone 15 128GB Preto Usado", { model: "iPhone 15" })).conflicts).toContain("condição diferente");
    expect(matcher.compare(product("iPhone 15 128GB Novo"), product("iPhone 15 128GB Usado")).conflicts).toContain("condição diferente");
  });
  it("bloqueia TV de 55 e 65 polegadas com model igual", () => {
    const result = matcher.compare(product('Samsung TV 55" Preto', { model: "TV XYZ" }), product("Samsung TV 65 polegadas Preto", { model: "TV XYZ" }));
    expect(result).toMatchObject({ matched: false, conflicts: ["tamanho diferente"] });
    expect(matcher.compare(product("Samsung TV 55-inch Preto", { model: "TV XYZ" }), product("Samsung TV 65 polegadas Preto", { model: "TV XYZ" })).conflicts).toContain("tamanho diferente");
  });
  it("não confunde 64GB RAM com 64GB armazenamento", () => {
    const result = matcher.compare(product("Notebook 64GB RAM 256GB SSD", { model: "Notebook X" }),
      product("Notebook 64GB SSD 256GB RAM", { model: "Notebook X" }));
    expect(result.matched).toBe(false);
    expect(result.conflicts).toContain("capacidade diferente");
    expect(result.conflicts).toContain("RAM diferente");
  });
  it("iguala 1TB e 1024GB sem inventar capacidade", () => {
    const result = matcher.compare(product("Apple iPhone 15 1TB Preto"), product("Apple iPhone 15 1024 GB Preto"));
    expect(result.matched).toBe(true);
    expect(result.reasons).toContain("capacidade igual");
  });
  it.each([["Black", "Preto"], ["Blue", "Azul"]])("iguala cores %s e %s", (a, b) => {
    expect(matcher.compare(product(`Apple iPhone 15 128GB ${a}`), product(`Apple iPhone 15 128GB ${b}`)).matched).toBe(true);
  });
  it("não supõe igualdade de Midnight e Starlight", () => {
    expect(matcher.compare(product("Apple iPhone 15 128GB Midnight", { model: "iPhone 15" }),
      product("Apple iPhone 15 128GB Starlight", { model: "iPhone 15" })).conflicts).toContain("cor diferente");
  });
  it("bloqueia cores não reconhecidas diferentes quando o model é igual", () => {
    const result = matcher.compare(product("Apple iPhone 15 128GB Nebula", { model: "iPhone 15" }),
      product("Apple iPhone 15 128GB Cosmic", { model: "iPhone 15" }));
    expect(result).toMatchObject({ matched: false, conflicts: ["qualificador de título diferente"] });
  });
  it("não pontua atributos de variante ausentes em ambos", () => {
    const result = matcher.compare(product("Apple iPhone 15"), product("Apple iPhone 15"));
    expect(result.matched).toBe(false);
    expect(result.score).toBe(80);
    expect(result.missingEvidence).toContain("capacidade ausente em ambos");
    expect(result.missingEvidence).toContain("cor ausente em ambos");
  });
});

describe("ProductMatchingService", () => {
  it("agrupa Amazon e Mercado Livre iguais, preserva variante distinta e item sem oferta", () => {
    const amazon = product("Apple iPhone 15 (128 GB) - Preto", { externalId: "ASIN1", offers: [] });
    const mercado = product("Apple iPhone 15 128GB Preto - Distribuidor Autorizado", { externalId: "MLB1" });
    const azul = product("Apple iPhone 15 128GB Azul", { externalId: "MLB2" });
    const groups = new ProductMatchingService().group([amazon, mercado, azul]);
    expect(groups.map((group) => group.products.map((entry) => entry.externalId))).toEqual([["ASIN1", "MLB1"], ["MLB2"]]);
    expect(groups.map((group) => group.id)).toEqual(["group-1", "group-2"]);
  });
  it("exige compatibilidade com todos os membros, sem união transitiva insegura", () => {
    const first = product("Apple iPhone 15 128GB Preto", { gtin: "4006381333931" });
    const bridge = product("Nome Comercial", { gtin: "4006381333931" });
    const conflict = product("Apple iPhone 15 128GB Azul", { gtin: "4006381333931" });
    expect(matcher.compare(first, bridge).matched).toBe(true);
    expect(matcher.compare(bridge, conflict).matched).toBe(true);
    expect(matcher.compare(first, conflict).matched).toBe(false);
    expect(new ProductMatchingService().group([first, bridge, conflict]).map((group) => group.products.length)).toEqual([2, 1]);
    const reversed = new ProductMatchingService().group([conflict, bridge, first]);
    expect(reversed.map((group) => group.products.map((entry) => entry.name))).toEqual([[conflict.name, bridge.name], [first.name]]);
  });
  it("não insere duplicata óbvia do mesmo provider e externalId ou oferta", () => {
    const offer = (id: string) => ({ provider: "amazon", externalOfferId: id, price: 100, currency: "BRL", productUrl: "https://example.com", availability: "available" as const });
    const first = product("Apple iPhone 15 128GB Preto", { externalId: "ASIN1", offers: [offer("A")] });
    const sameId = product("Apple iPhone 15 128GB Preto", { externalId: "ASIN1", offers: [offer("B")] });
    const sameOffer = product("Apple iPhone 15 128GB Preto", { externalId: "ASIN2", offers: [offer("A")] });
    const groups = new ProductMatchingService().group([first, sameId, sameOffer]);
    expect(groups).toHaveLength(1);
    expect(groups[0].products).toHaveLength(1);
    expect(groups[0].products[0].offers.map((entry) => entry.externalOfferId)).toEqual(["A", "B"]);
  });
});
