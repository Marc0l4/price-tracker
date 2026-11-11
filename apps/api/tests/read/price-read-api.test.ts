import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createReadApiServer } from "../../src/http/read-api.server.js";
import { PriceHistoryService } from "../../src/read/price-history.service.js";
import { ProductQueryService } from "../../src/read/product-query.service.js";
import { createPrismaClient, type PrismaDatabase } from "../../src/infrastructure/database/prisma-client.js";

const run = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let dataDir: string | undefined;
let pgCtl: string | undefined;
let db: PrismaClient;
let database: PrismaDatabase;
const now = new Date("2026-11-09T12:00:00.000Z");

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta indisponível.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

beforeAll(async () => {
  const executable = (name: string) => `${name}${process.platform === "win32" ? ".exe" : ""}`;
  const installed = process.platform === "win32" && existsSync("C:\\Program Files\\PostgreSQL")
    ? readdirSync("C:\\Program Files\\PostgreSQL").sort().reverse().map((version) => path.join("C:\\Program Files\\PostgreSQL", version, "bin")) : [];
  const bin = [process.env.TEST_POSTGRES_BIN, ...installed].find((candidate): candidate is string => Boolean(candidate && existsSync(path.join(candidate, executable("initdb")))));
  let initdb: string;
  if (bin) { initdb = path.join(bin, executable("initdb")); pgCtl = path.join(bin, executable("pg_ctl")); }
  else {
    const platform = process.platform === "win32" ? "windows" : process.platform;
    const binaries = await import(`@embedded-postgres/${platform}-${process.arch}`) as { initdb: string; pg_ctl: string; postgres: string };
    initdb = binaries.initdb; pgCtl = binaries.pg_ctl;
    const packageRoot = path.resolve(path.dirname(binaries.postgres), "../..");
    const hydration = await import(pathToFileURL(path.join(packageRoot, "scripts/hydrate-symlinks.js")).href) as { hydrateSymlinks: () => Promise<void> };
    await hydration.hydrateSymlinks();
  }
  dataDir = await mkdtemp(path.join(apiRoot, ".test-postgres-"));
  const port = await freePort();
  await run(initdb, ["-D", dataDir, "--auth=trust", "--username=postgres", "--locale=C", "--encoding=UTF8", "--no-sync"], { timeout: 90_000 });
  await run(pgCtl, ["-D", dataDir, "-o", `-p ${port} -h 127.0.0.1`, "-l", path.join(dataDir, "server.log"), "start", "-w"], { timeout: 30_000 });
  const url = `postgresql://postgres@127.0.0.1:${port}/postgres?schema=public`;
  await run(process.execPath, [path.resolve(apiRoot, "../../node_modules/prisma/build/index.js"), "--config", path.resolve(apiRoot, "../../prisma.config.ts"), "migrate", "deploy"], { cwd: apiRoot, env: { ...process.env, DATABASE_URL: url }, timeout: 90_000 });
  database = createPrismaClient(url);
  db = database.client;
}, 180_000);

afterAll(async () => {
  await database?.close();
  if (pgCtl && dataDir) await run(pgCtl, ["-D", dataDir, "stop", "-m", "immediate", "-w"], { timeout: 30_000 }).catch(() => undefined);
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}, 60_000);

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "PriceObservation", "TrackedSearchOffer", "ProviderCollectionRun", "CollectionRun", "Offer", "ProviderProduct", "CanonicalProduct", "TrackedSearch" RESTART IDENTITY CASCADE');
});

async function seed() {
  const canonical = await db.canonicalProduct.create({ data: { name: "Apple iPhone 15 128GB Preto", brand: "Apple", model: "iPhone 15", gtin: "4006381333931", matchStatus: "confirmed" } });
  const amazonProduct = await db.providerProduct.create({ data: { provider: "amazon", externalId: "A", name: canonical.name, brand: "Apple", canonicalProductId: canonical.id, matchStatus: "confirmed", imageUrl: "https://img.example/iphone.jpg", lastObservedAt: now } });
  const mercadoProduct = await db.providerProduct.create({ data: { provider: "mercadolivre", externalId: "M", name: canonical.name, brand: "Apple", canonicalProductId: canonical.id, matchStatus: "confirmed", lastObservedAt: now } });
  const amazon = await db.offer.create({ data: { providerProductId: amazonProduct.id, provider: "amazon", externalOfferId: "AO", storeName: "Amazon", productUrl: "https://amazon.example", availability: "available", lastSeenAt: now, lastCheckedAt: now } });
  const mercado = await db.offer.create({ data: { providerProductId: mercadoProduct.id, provider: "mercadolivre", externalOfferId: "MO", storeName: "Mercado Livre", productUrl: "https://ml.example", availability: "available", lastSeenAt: now, lastCheckedAt: now } });
  const add = async (offerId: string, price: number, daysAgo: number, currency = "BRL") => db.priceObservation.create({ data: { offerId, price, currency, collectedAt: new Date(now.getTime() - daysAgo * 86_400_000), collectionKey: `${offerId}-${currency}-${daysAgo}` } });
  for (const [price, days] of [[4200, 120], [4000, 90], [3779, 30], [3599, 0]] as const) await add(amazon.id, price, days);
  for (const [price, days] of [[4100, 120], [3900, 90], [3699, 30], [3499, 0]] as const) await add(mercado.id, price, days);
  await add(amazon.id, 1000, 10, "USD");
  return { canonical, amazon, mercado };
}

async function seedSearchProduct(name: string, observations: Array<{ price: number; collectionKey: string }>) {
  const canonical = await db.canonicalProduct.create({ data: { name, matchStatus: "confirmed" } });
  if (!observations.length) return canonical;
  const providerProduct = await db.providerProduct.create({ data: { provider: "amazon", externalId: `provider-${name}`, name, canonicalProductId: canonical.id, matchStatus: "confirmed", lastObservedAt: now } });
  const offer = await db.offer.create({ data: { providerProductId: providerProduct.id, provider: "amazon", externalOfferId: `offer-${name}`, productUrl: "https://amazon.example", availability: "available", lastSeenAt: now, lastCheckedAt: now } });
  await db.priceObservation.createMany({ data: observations.map((observation, index) => ({
    offerId: offer.id, price: observation.price, currency: "BRL", collectionKey: observation.collectionKey,
    collectedAt: new Date(now.getTime() - (observations.length - index) * 60_000),
  })) });
  return canonical;
}

async function addOfferWithObservation(canonicalProductId: string, externalId: string, price: number, collectionKey: string) {
  const providerProduct = await db.providerProduct.create({ data: { provider: "mercadolivre", externalId, name: externalId, canonicalProductId, matchStatus: "confirmed", lastObservedAt: now } });
  const offer = await db.offer.create({ data: { providerProductId: providerProduct.id, provider: "mercadolivre", externalOfferId: externalId, productUrl: "https://mercadolivre.example", availability: "available", lastSeenAt: now, lastCheckedAt: now } });
  await db.priceObservation.create({ data: { offerId: offer.id, price, currency: "BRL", collectionKey, collectedAt: now } });
}

async function api() {
  const server = createReadApiServer(db);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Servidor indisponível.");
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("PriceHistoryService e read API", () => {
  it("calcula current, mínimo, máximo, média, percentual e melhor oferta em BRL", async () => {
    const { canonical } = await seed();
    const service = new PriceHistoryService(db);
    const stats = await service.statistics(canonical.id, "BRL", { period: "all", now });
    expect(stats).toMatchObject({ currentPrice: "3499.0000", lowestPrice: "3499.0000", highestPrice: "4200.0000", observationCount: 8, classification: "low" });
    expect(stats.averagePrice).toBe("3847.0000");
    expect(stats.percentFromAverage).toBe("-9.05");
    const offers = await service.activeOffers(canonical.id, "BRL");
    expect(offers[0]).toMatchObject({ provider: "mercadolivre", price: "3499.0000", storeName: "Mercado Livre" });
    expect(await service.bestOffers(canonical.id, "BRL")).toMatchObject([{ provider: "mercadolivre", price: "3499.0000" }]);
  });

  it("não usa Offer inativa no currentPrice, mas preserva seu histórico", async () => {
    const { canonical, mercado } = await seed();
    await db.offer.update({ where: { id: mercado.id }, data: { isActive: false } });
    const service = new PriceHistoryService(db);
    expect((await service.statistics(canonical.id, "BRL", { period: "all" })).currentPrice).toBe("3599.0000");
    expect((await service.statistics(canonical.id, "BRL", { period: "all" })).lowestPrice).toBe("3499.0000");
  });

  it("classifica normal e high com regra determinística", async () => {
    const { canonical, amazon, mercado } = await seed();
    const add = (offerId: string, price: number, key: string, hour: number) => db.priceObservation.create({ data: {
      offerId, price, currency: "BRL", collectedAt: new Date(`2026-11-10T${String(hour).padStart(2, "0")}:00:00.000Z`), collectionKey: key,
    } });
    await add(amazon.id, 3847, "normal-amazon", 10);
    await add(mercado.id, 3847, "normal-mercado", 10);
    const service = new PriceHistoryService(db);
    expect((await service.statistics(canonical.id, "BRL", { period: "all" })).classification).toBe("normal");
    await add(amazon.id, 5000, "high-amazon", 11);
    await add(mercado.id, 5000, "high-mercado", 11);
    expect((await service.statistics(canonical.id, "BRL", { period: "all" })).classification).toBe("high");
  });

  it("separa currencies e não mistura USD nas estatísticas BRL", async () => {
    const { canonical } = await seed();
    const service = new PriceHistoryService(db);
    expect(await service.statistics(canonical.id, "USD", { period: "all" })).toMatchObject({ currentPrice: "1000.0000", averagePrice: "1000.0000", observationCount: 1, percentFromAverage: null, classification: "insufficient_data" });
    expect((await service.statistics(canonical.id, "BRL", { period: "all" })).observationCount).toBe(8);
  });

  it("classifica zero ou uma observação como insuficiente e permite classificação com duas", async () => {
    const empty = await seedSearchProduct("iPhone sem histórico", []);
    const one = await seedSearchProduct("iPhone uma observação", [{ price: 3500, collectionKey: "one" }]);
    const two = await seedSearchProduct("iPhone duas observações", [{ price: 3500, collectionKey: "two-a" }, { price: 3500, collectionKey: "two-b" }]);
    const service = new PriceHistoryService(db);
    expect((await service.statistics(empty.id, "BRL", { period: "all" })).classification).toBe("insufficient_data");
    expect(await service.statistics(one.id, "BRL", { period: "all" })).toMatchObject({ classification: "insufficient_data", percentFromAverage: null });
    expect((await service.statistics(two.id, "BRL", { period: "all" })).classification).toBe("normal");
  });

  it("classifica quatro observações válidas pelo preço, nunca como histórico insuficiente", async () => {
    const product = await seedSearchProduct("iPhone quatro observações", [
      { price: 4000, collectionKey: "four-a" },
      { price: 4200, collectionKey: "four-b" },
      { price: 4000, collectionKey: "four-c" },
      { price: 3600, collectionKey: "four-d" },
    ]);
    const service = new PriceHistoryService(db);
    const statistics = await service.statistics(product.id, "BRL", { period: "all", now });
    expect(statistics).toMatchObject({ observationCount: 4, classification: "low" });
    expect(statistics.percentFromAverage).not.toBeNull();
  });

  it("respeita 30d, 90d, 180d, all e intervalo customizado inclusivo", async () => {
    const { canonical } = await seed();
    const service = new PriceHistoryService(db);
    expect((await service.statistics(canonical.id, "BRL", { period: "30d", now })).observationCount).toBe(4);
    expect((await service.statistics(canonical.id, "BRL", { period: "90d", now })).observationCount).toBe(6);
    expect((await service.statistics(canonical.id, "BRL", { period: "180d", now })).observationCount).toBe(8);
    expect((await service.history(canonical.id, "BRL", { period: "all", now })).granularity).toBe("raw");
    expect((await service.statistics(canonical.id, "BRL", { from: new Date("2026-10-10T12:00:00Z"), to: now })).observationCount).toBe(4);
    await expect(service.statistics(canonical.id, "BRL", { from: now, to: new Date("2026-01-01T00:00:00Z") })).rejects.toMatchObject({ code: "invalid_date_range" });
  });

  it("preserva uma mudança recente ao ampliar o período de histórico", async () => {
    const { canonical, amazon } = await seed();
    const service = new PriceHistoryService(db);
    for (const period of ["30d", "90d", "180d", "all"] as const) {
      const history = await service.history(canonical.id, "BRL", { period, now });
      expect(history.granularity).toBe("raw");
      expect(history.points.map((point) => point.lastPrice)).toContain("3499.0000");
      expect(history.points.map((point) => point.lastPrice)).toContain("3699.0000");
    }
    expect((await service.offerHistory(amazon.id, "BRL", { period: "all" })).observations).toHaveLength(4);
  });

  it("preserva quatro observações recentes com preços diferentes em todos os períodos", async () => {
    const product = await seedSearchProduct("iPhone histórico recente", [
      { price: 3779, collectionKey: "recent-a" },
      { price: 4650, collectionKey: "recent-b" },
      { price: 3779.09, collectionKey: "recent-c" },
      { price: 4280, collectionKey: "recent-d" },
    ]);
    const service = new PriceHistoryService(db);
    for (const period of ["30d", "90d", "180d", "all"] as const) {
      const history = await service.history(product.id, "BRL", { period, now });
      expect(history.granularity).toBe("raw");
      expect(history.points).toHaveLength(4);
      expect(new Set(history.points.map((point) => point.lastPrice)).size).toBeGreaterThan(1);
    }
  });

  it("retorna produto sem histórico com insufficient_data e histórico vazio", async () => {
    const product = await db.canonicalProduct.create({ data: { name: "Produto sem preço", matchStatus: "review_required" } });
    const service = new PriceHistoryService(db);
    expect((await service.statistics(product.id)).classification).toBe("insufficient_data");
    expect((await service.history(product.id)).points).toEqual([]);
    expect((await new ProductQueryService(db).product(product.id)).matchStatus).toBe("review_required");
  });

  it("agrega 10 mil observações no PostgreSQL sem materializar a série para analytics", async () => {
    const { canonical, amazon } = await seed();
    await db.priceObservation.createMany({ data: Array.from({ length: 10_000 }, (_, index) => ({
      offerId: amazon.id, price: 3600 + (index % 10), currency: "BRL",
      collectedAt: new Date(now.getTime() - (index + 1) * 60_000), collectionKey: `bulk-${index}`,
    })) });
    const statistics = await new PriceHistoryService(db).statistics(canonical.id, "BRL", { period: "all" });
    expect(statistics.observationCount).toBe(10_008);
  }, 30_000);

  it("busca catálogo persistido com paginação e preço atual", async () => {
    const { canonical } = await seed();
    await db.canonicalProduct.create({ data: { name: "Samsung Galaxy S24", matchStatus: "provisional" } });
    const service = new ProductQueryService(db);
    expect((await service.search("iphone", 1, 20)).items).toMatchObject([{ id: canonical.id, currentPrice: "3499.0000", currency: "BRL" }]);
    await expect(service.search("", 1, 20)).rejects.toMatchObject({ code: "invalid_query" });
  });

  it("ordena globalmente por histórico ou preço antes da paginação", async () => {
    const highHistory = await seedSearchProduct("iPhone alta cobertura", [
      { price: 4000, collectionKey: "high-1" }, { price: 4000, collectionKey: "high-2" }, { price: 4000, collectionKey: "high-3" },
    ]);
    const lowerPrice = await seedSearchProduct("iPhone empate barato", [{ price: 3000, collectionKey: "tie-1" }, { price: 3000, collectionKey: "tie-2" }]);
    const higherPrice = await seedSearchProduct("iPhone empate caro", [{ price: 3500, collectionKey: "tie-3" }, { price: 3500, collectionKey: "tie-4" }]);
    const noPrice = await seedSearchProduct("iPhone sem preço", []);
    const service = new ProductQueryService(db);
    const firstHistoryPage = await service.search("iphone", 1, 2, "BRL");
    expect(firstHistoryPage.items.map((item) => item.id)).toEqual([highHistory.id, lowerPrice.id]);
    const secondHistoryPage = await service.search("iphone", 2, 2, "BRL", "history");
    expect(secondHistoryPage.items.map((item) => item.id)).toEqual([higherPrice.id, noPrice.id]);
    const priceOrder = await service.search("iphone", 1, 10, "BRL", "price");
    expect(priceOrder.items.map((item) => item.id)).toEqual([lowerPrice.id, higherPrice.id, highHistory.id, noPrice.id]);
  });

  it("mede histórico por coleta lógica, sem multiplicar cobertura por oferta", async () => {
    const oneCollection = await seedSearchProduct("iPhone duas ofertas uma coleta", [{ price: 3500, collectionKey: "shared-run" }]);
    await addOfferWithObservation(oneCollection.id, "second-offer", 3500, "shared-run");
    const twoCollections = await seedSearchProduct("iPhone uma oferta duas coletas", [{ price: 3500, collectionKey: "run-a" }, { price: 3500, collectionKey: "run-b" }]);
    const result = await new ProductQueryService(db).search("iphone", 1, 10, "BRL", "history");
    expect(result.items.map((item) => item.id)).toEqual([twoCollections.id, oneCollection.id]);
  });

  it("trata catálogo vazio como resultado válido, não como erro", async () => {
    const service = new ProductQueryService(db);
    expect(await service.search("iphone 15", 1, 20)).toEqual({ page: 1, limit: 20, total: 0, items: [] });
    const server = await api();
    try {
      const response = await fetch(`${server.base}/products?query=iphone%2015&page=1&limit=20`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ page: 1, limit: 20, total: 0, items: [] });
    } finally { await server.close(); }
  });

  it("expõe healthcheck leve, CORS explícito e headers seguros", async () => {
    const server = createReadApiServer(db, { corsOrigin: "http://localhost:3000", version: "test" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Servidor indisponível.");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.json()).toMatchObject({ status: "ok", database: "ok", version: "test" });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it("expõe endpoints, valida entradas e sanitiza erros", async () => {
    const { canonical, amazon } = await seed();
    const server = await api();
    try {
      const analytics = await fetch(`${server.base}/products/${canonical.id}/analytics?period=all`);
      expect(analytics.status).toBe(200);
      expect(await analytics.json()).toMatchObject({ currentPrice: "3499.0000", observationCount: 8 });
      expect((await fetch(`${server.base}/products?query=iphone&page=1&limit=1`)).status).toBe(200);
      expect((await fetch(`${server.base}/products?query=iphone&limit=101`)).status).toBe(400);
      expect(await (await fetch(`${server.base}/products?query=iphone&sort=unknown`)).json()).toEqual({ error: { code: "invalid_sort", message: "Ordenação inválida." } });
      expect(await (await fetch(`${server.base}/products/not-a-uuid`)).json()).toEqual({ error: { code: "invalid_uuid", message: "UUID inválido." } });
      expect((await fetch(`${server.base}/products/11111111-1111-4111-8111-111111111111`)).status).toBe(404);
      expect((await fetch(`${server.base}/offers/${amazon.id}/history?currency=brl`)).status).toBe(400);
      expect((await fetch(`${server.base}/offers/${amazon.id}/history?period=all`)).status).toBe(200);
    } finally { await server.close(); }
  });
});
