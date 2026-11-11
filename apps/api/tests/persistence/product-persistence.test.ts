import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MatchStatus, type PrismaClient } from "../../src/generated/prisma/client.js";
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { NormalizedOffer } from "../../src/types/normalized-product.js";
import { ProductPersistenceService, type CollectionContext, type SourcedProduct } from "../../src/persistence/product-persistence.service.js";
import { createPrismaClient, type PrismaDatabase } from "../../src/infrastructure/database/prisma-client.js";

const run = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let dataDir: string | undefined;
let pgCtl: string | undefined;
let db: PrismaClient;
let database: PrismaDatabase;
let service: ProductPersistenceService;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    const database = parsed.pathname.slice(1);
    const schema = parsed.searchParams.get("schema") ?? "";
    if (!database.toLowerCase().includes("test") && !schema.toLowerCase().includes("test"))
      throw new Error("TEST_DATABASE_URL deve apontar explicitamente para um database ou schema de teste.");
  }
  if (!url) {
    let initdb: string;
    const executable = (name: string) => `${name}${process.platform === "win32" ? ".exe" : ""}`;
    const configuredBin = process.env.TEST_POSTGRES_BIN;
    const installedRoots = process.platform === "win32" && existsSync("C:\\Program Files\\PostgreSQL")
      ? readdirSync("C:\\Program Files\\PostgreSQL").sort().reverse()
        .map((version) => path.join("C:\\Program Files\\PostgreSQL", version, "bin")) : [];
    const systemBin = [configuredBin, ...installedRoots].find((candidate): candidate is string =>
      Boolean(candidate && existsSync(path.join(candidate, executable("initdb")))));
    if (systemBin) {
      initdb = path.join(systemBin, executable("initdb"));
      pgCtl = path.join(systemBin, executable("pg_ctl"));
    } else {
      const platform = process.platform === "win32" ? "windows" : process.platform;
      const binaries = await import(`@embedded-postgres/${platform}-${process.arch}`) as {
        initdb: string; pg_ctl: string; postgres: string;
      };
      initdb = binaries.initdb;
      pgCtl = binaries.pg_ctl;
      const packageRoot = path.resolve(path.dirname(binaries.postgres), "../..");
      const hydration = await import(pathToFileURL(path.join(packageRoot, "scripts/hydrate-symlinks.js")).href) as {
        hydrateSymlinks: () => Promise<void>;
      };
      await hydration.hydrateSymlinks();
    }
    dataDir = await mkdtemp(path.join(apiRoot, ".test-postgres-"));
    const port = await freePort();
    await run(initdb, ["-D", dataDir, "--auth=trust", "--username=postgres", "--locale=C", "--encoding=UTF8", "--no-sync"], { timeout: 90_000 });
    await run(pgCtl, ["-D", dataDir, "-o", `-p ${port} -h 127.0.0.1`, "-l", path.join(dataDir, "server.log"), "start", "-w"], { timeout: 30_000 });
    url = `postgresql://postgres@127.0.0.1:${port}/postgres?schema=public`;
  }
  await run(process.execPath, [path.resolve(apiRoot, "../../node_modules/prisma/build/index.js"), "--config", path.resolve(apiRoot, "../../prisma.config.ts"), "migrate", "deploy"], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: url }, timeout: 90_000,
  });
  database = createPrismaClient(url);
  db = database.client;
  service = new ProductPersistenceService(db);
}, 180_000);

afterAll(async () => {
  await database?.close();
  if (pgCtl && dataDir) await run(pgCtl, ["-D", dataDir, "stop", "-m", "immediate", "-w"], { timeout: 30_000 }).catch(() => undefined);
  if (dataDir) {
    const resolved = path.resolve(dataDir);
    if (resolved.startsWith(apiRoot + path.sep) && path.basename(resolved).startsWith(".test-postgres-"))
      await rm(resolved, { recursive: true, force: true });
  }
}, 60_000);

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "PriceObservation", "Offer", "ProviderProduct", "CanonicalProduct" RESTART IDENTITY CASCADE');
});

const at = (hour: number) => new Date(`2026-11-09T${String(hour).padStart(2, "0")}:00:00.000Z`);
const context = (collectionKey: string, providers = ["amazon"], collectedAt = at(12)): CollectionContext =>
  ({ collectionKey, collectedAt, successfulProviders: providers });
const offer = (provider: string, externalOfferId: string, price: number): NormalizedOffer => ({
  provider, externalOfferId, price, currency: "BRL", productUrl: `https://example.com/${externalOfferId}`,
  storeName: "Loja exemplo", availability: "available", shipping: { isFree: true },
});
const product = (provider: string, externalId: string, options: {
  name?: string; price?: number; gtin?: string; brand?: string; model?: string; offers?: NormalizedOffer[];
} = {}): SourcedProduct => ({
  provider,
  product: {
    externalId,
    name: options.name ?? "Apple iPhone 15 128GB Preto",
    brand: options.brand ?? "Apple",
    model: options.model,
    gtin: options.gtin,
    offers: options.offers ?? [offer(provider, `${externalId}-offer`, options.price ?? 4999.99)],
  },
});

describe("persistência PostgreSQL + Prisma", () => {
  it("aplica as migrations incrementais, constraints e trigger", async () => {
    const migrations = await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name
    `;
    expect(migrations.map((item) => item.migration_name)).toEqual([
      "20261108210000_init", "20261109150000_persistence_hardening", "20261109170000_collection_orchestration", "20261109190000_read_analytics_indexes",
    ]);
    expect(migrations.every((item) => item.finished_at)).toBe(true);
    const triggers = await db.$queryRaw<Array<{ name: string }>>`
      SELECT tgname AS name FROM pg_trigger WHERE tgname = 'PriceObservation_immutable'
    `;
    expect(triggers).toHaveLength(1);
  });

  it("cria produto, oferta ativa e observação Decimal com timestamps absolutos", async () => {
    const input = product("amazon", "ASIN1", { price: 3779.10 });
    const result = await service.persist([input], context("run-1"));
    expect(result.failed).toEqual([]);
    const saved = await db.providerProduct.findFirstOrThrow({ include: { offers: { include: { observations: true } } } });
    expect(saved.canonicalProductId).not.toBeNull();
    expect(saved.offers[0]).toMatchObject({ isActive: true, lastSeenAt: at(12) });
    expect(saved.offers[0].observations[0].price.toFixed(4)).toBe("3779.1000");
    expect(saved.offers[0].observations[0].collectedAt.toISOString()).toBe(at(12).toISOString());
  });

  it("retry usa a mesma observação; nova chave preserva o mesmo preço novamente", async () => {
    const input = product("amazon", "ASIN1", { price: 3699 });
    await service.persist([input], context("run-1", ["amazon"], at(12)));
    await service.persist([input], context("run-1", ["amazon"], at(12)));
    await service.persist([input], context("run-2", ["amazon"], at(13)));
    expect(await db.priceObservation.count()).toBe(2);
    expect((await db.priceObservation.findMany({ orderBy: { collectedAt: "asc" } })).map((item) => item.price.toFixed(4)))
      .toEqual(["3699.0000", "3699.0000"]);
  });

  it("retry concorrente não duplica produto, canônico, oferta ou observação", async () => {
    const input = product("amazon", "ASIN1");
    const otherService = new ProductPersistenceService(db);
    const [first, second] = await Promise.all([
      service.persist([input], context("same-run")),
      otherService.persist([structuredClone(input)], context("same-run")),
    ]);
    expect(first.failed).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(await db.canonicalProduct.count()).toBe(1);
    expect(await db.providerProduct.count()).toBe(1);
    expect(await db.offer.count()).toBe(1);
    expect(await db.priceObservation.count()).toBe(1);
  });

  it("degrada confirmed quando GTIN muda e preserva o outro membro e todo o histórico", async () => {
    const amazon = product("amazon", "ASIN1", { gtin: "4006381333931" });
    const mercado = product("mercadolivre", "MLB1", { gtin: "4006381333931" });
    await service.persist([amazon, mercado], context("run-1", ["amazon", "mercadolivre"], at(12)));
    amazon.product.gtin = "5901234123457";
    const result = await service.persist([amazon], context("run-2", ["amazon"], at(13)));
    expect(result.succeeded[0].matchStatus).toBe("review_required");
    const canonical = await db.canonicalProduct.findFirstOrThrow({ include: { providerProducts: true } });
    expect(canonical.matchStatus).toBe("review_required");
    expect(canonical.providerProducts).toHaveLength(2);
    expect(await db.offer.count()).toBe(2);
    expect(await db.priceObservation.count()).toBe(3);
  });

  it.each([
    ["GTIN removido", (item: SourcedProduct) => { item.product.gtin = undefined; }, "provisional"],
    ["marca alterada", (item: SourcedProduct) => { item.product.brand = "Outra"; }, "review_required"],
    ["modelo alterado", (item: SourcedProduct) => { item.product.model = "iPhone 16"; }, "review_required"],
  ])("reavalia confirmed quando %s", async (_label, change, expected) => {
    const amazon = product("amazon", "ASIN1", { gtin: "4006381333931", model: "iPhone 15" });
    const mercado = product("mercadolivre", "MLB1", { gtin: "4006381333931", model: "iPhone 15" });
    await service.persist([amazon, mercado], context("run-1", ["amazon", "mercadolivre"], at(12)));
    change(amazon);
    await service.persist([amazon], context("run-2", ["amazon"], at(13)));
    expect((await db.canonicalProduct.findFirstOrThrow()).matchStatus).toBe(expected);
  });

  it("oferta ausente em resposta válida fica inativa e reaparecimento reativa", async () => {
    const input = product("amazon", "ASIN1");
    await service.persist([input], context("run-1", ["amazon"], at(12)));
    await service.persist([], context("run-2", ["amazon"], at(13)));
    expect((await db.offer.findFirstOrThrow()).isActive).toBe(false);
    await service.persist([input], context("run-3", ["amazon"], at(14)));
    expect(await db.offer.findFirstOrThrow()).toMatchObject({ isActive: true, lastSeenAt: at(14) });
    expect(await db.priceObservation.count()).toBe(2);
  });

  it("provider com falha não inativa oferta", async () => {
    await service.persist([product("amazon", "ASIN1")], context("run-1", ["amazon"], at(12)));
    const result = await service.persist([], context("run-2", [], at(13)));
    expect(result.providerLifecycle).toEqual([]);
    expect((await db.offer.findFirstOrThrow()).isActive).toBe(true);
  });

  it("coleta antiga concorrente não reativa oferta ausente em coleta mais nova", async () => {
    const input = product("amazon", "ASIN1");
    await service.persist([input], context("seed", ["amazon"], at(12)));
    await Promise.all([
      service.persist([], context("new-missing", ["amazon"], at(14))),
      new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
        service.persist([input], context("old-seen", ["amazon"], at(13)))),
    ]);
    expect(await db.offer.findFirstOrThrow()).toMatchObject({ isActive: false, lastCheckedAt: at(14) });
  });

  it("coleta antiga não sobrescreve a identidade mais nova do ProviderProduct", async () => {
    const initial = product("amazon", "ASIN1", { name: "Apple iPhone 15 128GB Preto", model: "iPhone 15" });
    await service.persist([initial], context("seed", ["amazon"], at(12)));
    const newer = product("amazon", "ASIN1", { name: "Apple iPhone 16 128GB Preto", model: "iPhone 16" });
    const older = product("amazon", "ASIN1", { name: "Apple iPhone 14 128GB Preto", model: "iPhone 14" });
    await Promise.all([
      service.persist([newer], context("newer", ["amazon"], at(14))),
      new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
        service.persist([older], context("older", ["amazon"], at(13)))),
    ]);
    expect(await db.providerProduct.findFirstOrThrow()).toMatchObject({
      name: "Apple iPhone 16 128GB Preto",
      model: "iPhone 16",
      lastObservedAt: at(14),
    });
  });

  it("falha de uma unidade do provider impede inativação daquela resposta", async () => {
    await service.persist([product("amazon", "ASIN1")], context("seed", ["amazon"], at(12)));
    const invalid = product("amazon", "BROKEN", { price: 0 });
    const result = await service.persist([invalid], context("run-2", ["amazon"], at(13)));
    expect(result.providerLifecycle).toEqual([{ provider: "amazon", status: "skipped_due_to_failure", inactiveOffers: 0 }]);
    expect((await db.offer.findFirstOrThrow()).isActive).toBe(true);
  });

  it("produto encontrado sem preço atualiza identidade sem criar preço nem inativar histórico", async () => {
    const priced = product("amazon", "ASIN1");
    await service.persist([priced], context("run-1", ["amazon"], at(12)));
    const withoutPrice = product("amazon", "ASIN1", { offers: [] });
    withoutPrice.product.name += " Atualizado";
    const result = await service.persist([withoutPrice], context("run-2", ["amazon"], at(13)));
    expect(result.failed).toEqual([]);
    expect((await db.providerProduct.findFirstOrThrow()).name).toContain("Atualizado");
    expect((await db.offer.findFirstOrThrow()).isActive).toBe(true);
    expect(await db.priceObservation.count()).toBe(1);
  });

  it.each([
    ["provider vazio", product("", "A")],
    ["externalId vazio", product("amazon", "  ")],
    ["externalOfferId vazio", product("amazon", "A", { offers: [offer("amazon", " ", 1)] })],
    ["price zero", product("amazon", "A", { price: 0 })],
    ["currency inválida", product("amazon", "A", { offers: [{ ...offer("amazon", "A", 1), currency: "brl" }] })],
  ])("rejeita %s sem impedir outra unidade válida", async (_label, invalid) => {
    const valid = product("mercadolivre", `VALID-${_label}`);
    const result = await service.persist([invalid, valid], context(`run-${_label}`, ["amazon", "mercadolivre"]));
    expect(result.failed).toHaveLength(1);
    expect(result.succeeded).toHaveLength(1);
    expect(await db.providerProduct.count()).toBe(1);
  });

  it("rejeita collectionKey vazia antes de escrever", async () => {
    await expect(service.persist([product("amazon", "A")], context("   "))).rejects.toThrow("Chave");
    expect(await db.providerProduct.count()).toBe(0);
  });

  it("rejeita collectedAt inválido antes de escrever", async () => {
    await expect(service.persist([product("amazon", "A")], {
      collectionKey: "run", collectedAt: new Date("inválida"), successfulProviders: ["amazon"],
    })).rejects.toThrow("instante");
    expect(await db.providerProduct.count()).toBe(0);
  });

  it("consolida duplicata equivalente no lote", async () => {
    const first = product("amazon", "ASIN1", { offers: [offer("amazon", "OFFER-1", 10)] });
    const second = product("amazon", "ASIN1", { offers: [offer("amazon", "OFFER-2", 20)] });
    const result = await service.persist([first, second], context("run-1"));
    expect(result.failed).toEqual([]);
    expect(await db.providerProduct.count()).toBe(1);
    expect(await db.offer.count()).toBe(2);
    expect(await db.canonicalProduct.count()).toBe(1);
  });

  it("isola duplicata conflitante e preserva grupos válidos", async () => {
    const first = product("amazon", "ASIN1");
    const conflicting = product("amazon", "ASIN1", { name: "Apple iPhone 15 Pro 128GB Preto" });
    const valid = product("mercadolivre", "MLB1", { name: "Samsung Galaxy S24 256GB Azul", brand: "Samsung" });
    const result = await service.persist([first, conflicting, valid], context("run-1", ["amazon", "mercadolivre"]));
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].code).toBe("duplicate_conflict");
    expect(result.succeeded).toHaveLength(1);
    expect(await db.canonicalProduct.count()).toBe(1);
    expect(await db.providerProduct.findFirstOrThrow()).toMatchObject({ provider: "mercadolivre", externalId: "MLB1" });
  });

  it("falha no meio de um grupo reverte a unidade e não elimina outro grupo", async () => {
    await service.persist([product("amazon", "OWNER", { offers: [offer("amazon", "SHARED", 10)] })], context("seed"));
    const conflict = product("amazon", "CONFLICT", { name: "Samsung Galaxy S24 256GB Azul", brand: "Samsung",
      offers: [offer("amazon", "SHARED", 20)] });
    const valid = product("mercadolivre", "VALID", { name: "Sony PlayStation 5 Slim 1TB Branco", brand: "Sony" });
    const result = await service.persist([conflict, valid], context("run-2", ["amazon", "mercadolivre"], at(13)));
    expect(result.failed).toHaveLength(1);
    expect(result.succeeded).toHaveLength(1);
    expect(await db.providerProduct.findUnique({ where: { provider_externalId: { provider: "amazon", externalId: "CONFLICT" } } })).toBeNull();
    expect(await db.providerProduct.findUnique({ where: { provider_externalId: { provider: "mercadolivre", externalId: "VALID" } } })).not.toBeNull();
  });

  it("CHECK impede confirmed sem canonicalProductId e entradas vazias no banco", async () => {
    await expect(db.providerProduct.create({ data: {
      provider: "amazon", externalId: "A", name: "Produto", matchStatus: MatchStatus.confirmed,
    } })).rejects.toThrow();
    await expect(db.providerProduct.create({ data: { provider: " ", externalId: "A", name: "Produto" } })).rejects.toThrow();
    expect(await db.providerProduct.count()).toBe(0);
  });

  it("split e merge preservam ofertas e observações", async () => {
    await service.persist([product("amazon", "A"), product("mercadolivre", "B")],
      context("run-1", ["amazon", "mercadolivre"]));
    const [a, b] = await db.providerProduct.findMany({ orderBy: { provider: "asc" } });
    const originalCanonicalId = a.canonicalProductId!;
    const newCanonical = await db.canonicalProduct.create({ data: { name: "Candidato separado" } });
    await db.providerProduct.update({ where: { id: b.id }, data: { canonicalProductId: newCanonical.id, matchStatus: "provisional" } });
    expect(await db.offer.count({ where: { providerProductId: b.id } })).toBe(1);
    expect(await db.priceObservation.count({ where: { offer: { providerProductId: b.id } } })).toBe(1);
    await db.providerProduct.update({ where: { id: b.id }, data: { canonicalProductId: originalCanonicalId, matchStatus: "provisional" } });
    expect(await db.offer.count()).toBe(2);
    expect(await db.priceObservation.count()).toBe(2);
    expect(await db.canonicalProduct.count({ where: { id: newCanonical.id, providerProducts: { none: {} } } })).toBe(1);
  });

  it("documenta que coletas independentes sem associação podem criar canônicos duplicados", async () => {
    await service.persist([product("amazon", "A")], context("run-1", ["amazon"], at(12)));
    await service.persist([product("mercadolivre", "B")], context("run-2", ["mercadolivre"], at(13)));
    expect(await db.canonicalProduct.count()).toBe(2);
  });

  it("PriceObservation continua imutável", async () => {
    await service.persist([product("amazon", "A")], context("run-1"));
    const observation = await db.priceObservation.findFirstOrThrow();
    await expect(db.priceObservation.update({ where: { id: observation.id }, data: { price: 1 } })).rejects.toThrow();
    await expect(db.priceObservation.delete({ where: { id: observation.id } })).rejects.toThrow();
    expect(await db.priceObservation.count()).toBe(1);
  });

  it("processa lote maior sem uma transação monolítica", async () => {
    const inputs = Array.from({ length: 30 }, (_, index) => product("amazon", `P${index}`, {
      name: `Produto único ${index} 128GB Preto`,
    }));
    const result = await service.persist(inputs, context("large-run"));
    expect(result.failed).toEqual([]);
    expect(result.succeeded).toHaveLength(30);
    expect(await db.providerProduct.count()).toBe(30);
    expect(await db.priceObservation.count()).toBe(30);
  });

  it("executa o fluxo end-to-end de três coletas e retry", async () => {
    const amazon = product("amazon", "ASIN1", { price: 3779.10 });
    const mercado = product("mercadolivre", "MLB1", { price: 3699 });
    await service.persist([amazon, mercado], context("collect-1", ["amazon", "mercadolivre"], at(12)));
    amazon.product.offers[0].price = 3599.90;
    await service.persist([amazon, mercado], context("collect-2", ["amazon", "mercadolivre"], at(13)));
    await service.persist([amazon, mercado], context("collect-2", ["amazon", "mercadolivre"], at(13)));
    expect(await db.priceObservation.count()).toBe(4);
    await service.persist([amazon, mercado], context("collect-3", ["amazon", "mercadolivre"], at(14)));
    expect(await db.canonicalProduct.count()).toBe(1);
    expect(await db.providerProduct.count()).toBe(2);
    expect(await db.offer.count()).toBe(2);
    expect(await db.priceObservation.count()).toBe(6);
  });
});
