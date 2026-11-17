import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient, CollectionTrigger } from "../../src/generated/prisma/client.js";
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CollectionOrchestrator } from "../../src/collection/collection-orchestrator.js";
import { CollectionScheduler } from "../../src/collection/collection-scheduler.js";
import { noopCollectionLogger } from "../../src/collection/collection-logger.js";
import type { CollectionSearchPort } from "../../src/collection/collection-contracts.js";
import { ProductPersistenceService } from "../../src/persistence/product-persistence.service.js";
import { OnDemandProductSearchService } from "../../src/read/on-demand-product-search.service.js";
import { ProductSearchService } from "../../src/services/product-search.service.js";
import type { ProductProvider } from "../../src/integrations/contracts/product-provider.js";
import { ProviderError } from "../../src/shared/errors/provider-error.js";
import type { DetailedSearchResult, ProviderSearchOutcome } from "../../src/services/product-search.service.js";
import type { NormalizedProduct, ProviderSearchError } from "../../src/types/normalized-product.js";
import { createPrismaClient, type PrismaDatabase } from "../../src/infrastructure/database/prisma-client.js";

const run = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let dataDir: string | undefined;
let pgCtl: string | undefined;
let db: PrismaClient;
let database: PrismaDatabase;

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
    if (!parsed.pathname.toLowerCase().includes("test") && !(parsed.searchParams.get("schema") ?? "").toLowerCase().includes("test"))
      throw new Error("TEST_DATABASE_URL deve apontar explicitamente para um database ou schema de teste.");
  }
  if (!url) {
    const executable = (name: string) => `${name}${process.platform === "win32" ? ".exe" : ""}`;
    const configuredBin = process.env.TEST_POSTGRES_BIN;
    const installed = process.platform === "win32" && existsSync("C:\\Program Files\\PostgreSQL")
      ? readdirSync("C:\\Program Files\\PostgreSQL").sort().reverse().map((version) => path.join("C:\\Program Files\\PostgreSQL", version, "bin")) : [];
    const bin = [configuredBin, ...installed].find((candidate): candidate is string => Boolean(candidate && existsSync(path.join(candidate, executable("initdb")))));
    let initdb: string;
    if (bin) {
      initdb = path.join(bin, executable("initdb"));
      pgCtl = path.join(bin, executable("pg_ctl"));
    } else {
      const platform = process.platform === "win32" ? "windows" : process.platform;
      const binaries = await import(`@embedded-postgres/${platform}-${process.arch}`) as { initdb: string; pg_ctl: string; postgres: string };
      initdb = binaries.initdb;
      pgCtl = binaries.pg_ctl;
      const packageRoot = path.resolve(path.dirname(binaries.postgres), "../..");
      const hydration = await import(pathToFileURL(path.join(packageRoot, "scripts/hydrate-symlinks.js")).href) as { hydrateSymlinks: () => Promise<void> };
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
}, 180_000);

afterAll(async () => {
  await database?.close();
  if (pgCtl && dataDir) await run(pgCtl, ["-D", dataDir, "stop", "-m", "immediate", "-w"], { timeout: 30_000 }).catch(() => undefined);
  if (dataDir && path.resolve(dataDir).startsWith(apiRoot + path.sep)) await rm(dataDir, { recursive: true, force: true });
}, 60_000);

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "OnDemandRateLimit", "PriceObservation", "TrackedSearchOffer", "ProviderCollectionRun", "CollectionRun", "Offer", "ProviderProduct", "CanonicalProduct", "TrackedSearch" RESTART IDENTITY CASCADE');
});

type ProviderPlan = { products?: NormalizedProduct[]; errorCode?: ProviderSearchError["code"]; delayMs?: number };

class PlannedSearch implements CollectionSearchPort {
  private call = 0;
  readonly providerNames: string[];

  constructor(private readonly plans: Array<Record<string, ProviderPlan>>, providers = ["amazon", "mercadolivre"]) {
    this.providerNames = providers;
  }

  get callCount() { return this.call; }

  async searchDetailed(_query: string): Promise<DetailedSearchResult> {
    const plan = this.plans[Math.min(this.call++, this.plans.length - 1)] ?? {};
    const providers: ProviderSearchOutcome[] = await Promise.all(this.providerNames.map(async (provider) => {
      const item = plan[provider] ?? { products: [] };
      const startedAt = new Date();
      if (item.delayMs) await new Promise((resolve) => setTimeout(resolve, item.delayMs));
      const finishedAt = new Date();
      if (item.errorCode) return {
        provider, status: "failed" as const, products: [], startedAt, finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: { provider, code: item.errorCode, message: "Falha simulada." },
      };
      return { provider, status: "success" as const, products: item.products ?? [], startedAt, finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime() };
    }));
    return {
      providers,
      products: providers.flatMap((provider) => provider.products),
      providerErrors: providers.flatMap((provider) => provider.error ? [provider.error] : []),
    };
  }
}

function product(provider: string, externalId: string, price = 100, offerId = `${externalId}-offer`): NormalizedProduct {
  return {
    externalId,
    name: "Apple iPhone 15 128GB Preto",
    brand: "Apple",
    gtin: "4006381333931",
    offers: [{ provider, externalOfferId: offerId, price, currency: "BRL", productUrl: `https://example.com/${offerId}`,
      storeName: "Loja exemplo", availability: "available", shipping: { isFree: true } }],
  };
}

function createOrchestrator(search: CollectionSearchPort, timeoutMs = 30_000, onDemandBudgetMs = timeoutMs) {
  return new CollectionOrchestrator(
    db,
    search,
    new ProductPersistenceService(db),
    undefined,
    noopCollectionLogger,
    { collectionTimeoutMs: timeoutMs, onDemandCollectionBudgetMs: onDemandBudgetMs, staleRunMs: 1_000 },
  );
}

function createOnDemandSearch(search: CollectionSearchPort, options: Partial<{
  enabled: boolean; ttlMs: number; rateLimitMax: number; rateLimitWindowMs: number; now: () => Date;
  onDemandBudgetMs: number;
}> = {}) {
  return new OnDemandProductSearchService(db, createOrchestrator(search, 30_000, options.onDemandBudgetMs ?? 30_000), {
    enabled: options.enabled ?? true,
    ttlMs: options.ttlMs ?? 6 * 60 * 60 * 1_000,
    rateLimitMax: options.rateLimitMax ?? 3,
    rateLimitWindowMs: options.rateLimitWindowMs ?? 10 * 60 * 1_000,
  }, undefined, options.now ?? (() => new Date()));
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(await condition()).toBe(true);
}

async function createTracked(query: string, active = true) {
  return db.trackedSearch.create({ data: { query, active } });
}

describe("CollectionOrchestrator", () => {
  it("executa manualmente, cria run estável e registra sucesso dos dois providers", async () => {
    const result = await createOrchestrator(new PlannedSearch([{ amazon: { products: [product("amazon", "A", 3779.10)] }, mercadolivre: { products: [product("mercadolivre", "M", 3699)] } }]))
      .runManual("  iPhone   15 ");
    expect(result.status).toBe("completed");
    expect(result.collectionRun).toMatchObject({ query: "iphone 15", collectionKey: result.collectionRun?.id, status: "completed" });
    expect(await db.providerCollectionRun.findMany({ orderBy: { provider: "asc" } })).toMatchObject([
      { provider: "amazon", status: "success", resultCount: 1 }, { provider: "mercadolivre", status: "success", resultCount: 1 },
    ]);
    expect(await db.priceObservation.count()).toBe(2);
  });

  it("executa TrackedSearch ativa com trigger scheduled", async () => {
    await createTracked("galaxy s24");
    const results = await createOrchestrator(new PlannedSearch([{ amazon: { products: [] }, mercadolivre: { products: [] } }])).runScheduled();
    expect(results).toHaveLength(1);
    expect(await db.collectionRun.findFirstOrThrow()).toMatchObject({ trigger: "scheduled", status: "completed" });
  });

  it("marca partial quando Amazon funciona e Mercado Livre falha", async () => {
    const result = await createOrchestrator(new PlannedSearch([{ amazon: { products: [product("amazon", "A")] }, mercadolivre: { errorCode: "timeout" } }])).runManual("iphone 15");
    expect(result.status).toBe("partial");
    expect(await db.priceObservation.count()).toBe(1);
    expect(await db.providerCollectionRun.findFirstOrThrow({ where: { provider: "mercadolivre" } })).toMatchObject({ status: "failed", errorCode: "timeout" });
  });

  it("marca partial quando Mercado Livre funciona e Amazon falha", async () => {
    const result = await createOrchestrator(new PlannedSearch([{ amazon: { errorCode: "http_error" }, mercadolivre: { products: [product("mercadolivre", "M")] } }])).runManual("iphone 15");
    expect(result.status).toBe("partial");
    expect(await db.priceObservation.count()).toBe(1);
  });

  it("marca failed quando todos os providers falham e não persiste preços", async () => {
    const result = await createOrchestrator(new PlannedSearch([{ amazon: { errorCode: "network_error" }, mercadolivre: { errorCode: "invalid_response" } }])).runManual("iphone 15");
    expect(result.status).toBe("failed");
    expect(await db.priceObservation.count()).toBe(0);
    expect(result.collectionRun).toMatchObject({ errorCode: "all_providers_failed" });
  });

  it("mantém grupos válidos quando uma unidade de persistência falha", async () => {
    await new ProductPersistenceService(db).persist([{ provider: "amazon", product: product("amazon", "owner", 100, "shared") }], {
      collectionKey: "seed", collectedAt: new Date(), successfulProviders: ["amazon"],
    });
    const conflict = product("amazon", "conflict", 200, "shared");
    conflict.name = "Samsung Galaxy S24 256GB Azul";
    const result = await createOrchestrator(new PlannedSearch([{ amazon: { products: [conflict] }, mercadolivre: { products: [product("mercadolivre", "valid", 300)] } }])).runManual("iphone 15");
    expect(result.status).toBe("partial");
    expect(result.collectionRun).toMatchObject({ failedGroupCount: 1, persistedGroupCount: 1 });
    expect((await db.trackedSearch.findFirstOrThrow()).lastCollectedAt).toBeNull();
  });

  it("retry reutiliza collectionKey e não duplica PriceObservation", async () => {
    const orchestrator = createOrchestrator(new PlannedSearch([{ amazon: { products: [product("amazon", "A")] }, mercadolivre: { products: [] } }]));
    const first = await orchestrator.runManual("iphone 15");
    const retry = await orchestrator.retry(first.collectionRun!.id);
    expect(retry).toMatchObject({ status: "completed" });
    expect(retry.collectionRun).toMatchObject({ id: first.collectionRun!.id, collectionKey: first.collectionRun!.collectionKey, attempt: 2 });
    expect(retry.collectionRun!.startedAt).toEqual(first.collectionRun!.startedAt);
    expect(await db.priceObservation.count()).toBe(1);
    expect(await db.providerCollectionRun.count({ where: { collectionRunId: first.collectionRun!.id } })).toBe(4);
  });

  it("nova CollectionRun gera nova collectionKey e novo histórico mesmo com preço igual", async () => {
    const orchestrator = createOrchestrator(new PlannedSearch([{ amazon: { products: [product("amazon", "A")] }, mercadolivre: { products: [] } }]));
    const first = await orchestrator.runManual("iphone 15");
    const second = await orchestrator.runManual("iphone 15");
    expect(second.collectionRun!.collectionKey).not.toBe(first.collectionRun!.collectionKey);
    expect(await db.priceObservation.count()).toBe(2);
  });

  it("executa fluxo end-to-end com retry, falha parcial e lifecycle", async () => {
    const orchestrator = createOrchestrator(new PlannedSearch([
      { amazon: { products: [product("amazon", "A", 3779.10)] }, mercadolivre: { products: [product("mercadolivre", "M", 3699)] } },
      { amazon: { products: [product("amazon", "A", 3599.90)] }, mercadolivre: { products: [product("mercadolivre", "M", 3699)] } },
      { amazon: { products: [product("amazon", "A", 3599.90)] }, mercadolivre: { products: [product("mercadolivre", "M", 3699)] } },
      { amazon: { products: [product("amazon", "A", 3599.90)] }, mercadolivre: { errorCode: "timeout" } },
      { amazon: { products: [product("amazon", "A", 3599.90)] }, mercadolivre: { products: [] } },
    ]));
    const run1 = await orchestrator.runManual("iphone 15");
    const run2 = await orchestrator.runManual("iphone 15");
    expect(run1.status).toBe("completed");
    expect(run2.status).toBe("completed");
    expect(await db.priceObservation.count()).toBe(4);
    await orchestrator.retry(run2.collectionRun!.id);
    expect(await db.priceObservation.count()).toBe(4);
    const run3 = await orchestrator.runManual("iphone 15");
    expect(run3.status).toBe("partial");
    expect(await db.offer.findFirstOrThrow({ where: { provider: "mercadolivre" } })).toMatchObject({ isActive: true });
    const run4 = await orchestrator.runManual("iphone 15");
    expect(run4.status).toBe("completed");
    expect(await db.offer.findFirstOrThrow({ where: { provider: "mercadolivre" } })).toMatchObject({ isActive: false });
    expect(await db.priceObservation.count()).toBe(6);
  });

  it("inativa oferta ausente após resposta completa do provider", async () => {
    const orchestrator = createOrchestrator(new PlannedSearch([
      { amazon: { products: [product("amazon", "A")] }, mercadolivre: { products: [] } },
      { amazon: { products: [] }, mercadolivre: { products: [] } },
    ]));
    await orchestrator.runManual("iphone 15");
    await orchestrator.runManual("iphone 15");
    expect(await db.offer.findFirstOrThrow({ where: { provider: "amazon" } })).toMatchObject({ isActive: false });
  });

  it("não inativa oferta quando o provider falha", async () => {
    const orchestrator = createOrchestrator(new PlannedSearch([
      { amazon: { products: [product("amazon", "A")] }, mercadolivre: { products: [] } },
      { amazon: { errorCode: "timeout" }, mercadolivre: { products: [] } },
    ]));
    await orchestrator.runManual("iphone 15");
    await orchestrator.runManual("iphone 15");
    expect(await db.offer.findFirstOrThrow({ where: { provider: "amazon" } })).toMatchObject({ isActive: true });
  });

  it("reativa oferta quando ela reaparece", async () => {
    const orchestrator = createOrchestrator(new PlannedSearch([
      { amazon: { products: [product("amazon", "A")] }, mercadolivre: { products: [] } },
      { amazon: { products: [] }, mercadolivre: { products: [] } },
      { amazon: { products: [product("amazon", "A")] }, mercadolivre: { products: [] } },
    ]));
    await orchestrator.runManual("iphone 15");
    await orchestrator.runManual("iphone 15");
    await orchestrator.runManual("iphone 15");
    expect(await db.offer.findFirstOrThrow({ where: { provider: "amazon" } })).toMatchObject({ isActive: true });
  });

  it("limita lifecycle ao escopo da TrackedSearch", async () => {
    const first = createOrchestrator(new PlannedSearch([{ amazon: { products: [product("amazon", "A")] }, mercadolivre: { products: [] } }]));
    await first.runManual("iphone 15");
    await first.runManual("galaxy s24");
    const second = createOrchestrator(new PlannedSearch([{ amazon: { products: [] }, mercadolivre: { products: [] } }]));
    await second.runManual("iphone 15");
    expect(await db.offer.findFirstOrThrow({ where: { provider: "amazon" } })).toMatchObject({ isActive: true });
    expect(await db.trackedSearchOffer.count()).toBe(2);
    await second.runManual("galaxy s24");
    expect(await db.offer.findFirstOrThrow({ where: { provider: "amazon" } })).toMatchObject({ isActive: false });
  });

  it("rejeita query vazia", async () => {
    await expect(createOrchestrator(new PlannedSearch([])).runManual("   ")).rejects.toThrow("query");
  });

  it("não executa TrackedSearch inativa", async () => {
    const inactive = await createTracked("playstation 5", false);
    const result = await createOrchestrator(new PlannedSearch([])).runTrackedSearch(inactive.id, "scheduled" as CollectionTrigger);
    expect(result.status).toBe("skipped_inactive");
    expect(await db.collectionRun.count()).toBe(0);
  });

  it("processa múltiplas TrackedSearch ativas", async () => {
    await createTracked("iphone 15");
    await createTracked("galaxy s24");
    const results = await createOrchestrator(new PlannedSearch([{ amazon: { products: [] }, mercadolivre: { products: [] } }])).runScheduled();
    expect(results.map((result) => result.status)).toEqual(["completed", "completed"]);
    expect(await db.collectionRun.count()).toBe(2);
  });

  it("impede colisão entre execução manual e scheduler da mesma TrackedSearch", async () => {
    const orchestrator = createOrchestrator(new PlannedSearch([{ amazon: { delayMs: 100 }, mercadolivre: { delayMs: 100 } }]));
    const manual = orchestrator.runManual("iphone 15");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tracked = await db.trackedSearch.findFirstOrThrow();
    expect(await orchestrator.runTrackedSearch(tracked.id, "scheduled" as CollectionTrigger)).toEqual({ status: "skipped_overlap" });
    await manual;
    expect(await db.collectionRun.count()).toBe(1);
  });

  it("registra duração e contagens da run", async () => {
    const result = await createOrchestrator(new PlannedSearch([{ amazon: { products: [product("amazon", "A")] }, mercadolivre: { products: [] } }])).runManual("iphone 15");
    expect(result.collectionRun).toMatchObject({ productsReceived: 1, matchedGroupCount: 1, persistedGroupCount: 1, failedGroupCount: 0 });
    expect(result.collectionRun!.finishedAt).not.toBeNull();
    expect(result.collectionRun!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("timeout global finaliza run e providers como failed", async () => {
    const result = await createOrchestrator(new PlannedSearch([{ amazon: { delayMs: 50 }, mercadolivre: { delayMs: 50 } }]), 5).runManual("iphone 15");
    expect(result.collectionRun).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(await db.providerCollectionRun.count({ where: { status: "failed", errorCode: "timeout" } })).toBe(2);
  });

  it("recupera runs antigas presas em running", async () => {
    const tracked = await createTracked("iphone 15");
    const stale = await db.collectionRun.create({ data: {
      collectionKey: "stale-run", trackedSearchId: tracked.id, query: tracked.query, trigger: "manual",
      startedAt: new Date(Date.now() - 10_000), attemptStartedAt: new Date(Date.now() - 10_000),
    } });
    await db.providerCollectionRun.create({ data: { collectionRunId: stale.id, provider: "amazon", attempt: 1, startedAt: stale.startedAt } });
    const recovered = await createOrchestrator(new PlannedSearch([])).recoverInterruptedRuns();
    expect(recovered).toBe(1);
    expect(await db.collectionRun.findFirstOrThrow()).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect(await db.providerCollectionRun.findFirstOrThrow()).toMatchObject({ status: "failed", errorCode: "interrupted" });
  });
});

describe("OnDemandProductSearchService", () => {
  const playstation = (provider = "amazon", externalId = "PS5") => {
    const item = product(provider, externalId, 3499, `${externalId}-offer`);
    item.name = "PlayStation 5 Slim Digital";
    return item;
  };

  it("reutiliza catálogo de uma coleta recente sem chamar providers ou criar outra run", async () => {
    const planned = new PlannedSearch([{ amazon: { products: [playstation()] }, mercadolivre: { products: [] } }]);
    const onDemand = createOnDemandSearch(planned);
    const first = await onDemand.search("PlayStation 5", 1, 20, "BRL", "history", "198.51.100.1");
    const runsBefore = await db.collectionRun.count();
    const second = await onDemand.search("playstation     5", 1, 20, "BRL", "history", "198.51.100.1");
    expect(first.total).toBe(1);
    expect(second.total).toBe(1);
    expect(planned.callCount).toBe(1);
    expect(await db.collectionRun.count()).toBe(runsBefore);
  });

  it("coleta uma query inédita, normaliza a TrackedSearch e devolve a leitura persistida", async () => {
    const planned = new PlannedSearch([{ amazon: { products: [playstation()] }, mercadolivre: { products: [] } }]);
    const result = await createOnDemandSearch(planned).search("  PlayStation   5  ", 1, 20, "BRL", "history", "198.51.100.2");
    expect(result).toMatchObject({ total: 1, items: [{ name: "PlayStation 5 Slim Digital" }] });
    expect(planned.callCount).toBe(1);
    expect(await db.trackedSearch.findMany()).toMatchObject([{ query: "playstation 5" }]);
    expect(await db.collectionRun.findFirstOrThrow()).toMatchObject({ status: "completed", productsReceived: 1 });
  });

  it("permite refresh quando o TTL expirou", async () => {
    const planned = new PlannedSearch([
      { amazon: { products: [playstation()] }, mercadolivre: { products: [] } },
      { amazon: { products: [playstation()] }, mercadolivre: { products: [] } },
    ]);
    let clock = new Date();
    const onDemand = createOnDemandSearch(planned, { ttlMs: 60_000, now: () => clock });
    await onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.3");
    clock = new Date(Date.now() + 61_000);
    await onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.3");
    await waitFor(() => planned.callCount === 2);
    await waitFor(async () => await db.collectionRun.count() === 2);
    await waitFor(async () => (await db.collectionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } })).status !== "running");
  });

  it("retorna dados stale sem esperar refresh expirado e inicia uma unica coleta", async () => {
    const planned = new PlannedSearch([
      { amazon: { products: [playstation()] }, mercadolivre: { products: [] } },
      { amazon: { products: [playstation()], delayMs: 100 }, mercadolivre: { products: [], delayMs: 100 } },
    ]);
    let clock = new Date();
    const onDemand = createOnDemandSearch(planned, { ttlMs: 1, now: () => clock });
    await onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.30");
    clock = new Date(Date.now() + 1_000);
    const startedAt = Date.now();
    const stale = await onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.30");
    expect(Date.now() - startedAt).toBeLessThan(80);
    expect(stale.total).toBe(1);
    await waitFor(() => planned.callCount === 2);
    await waitFor(async () => (await db.collectionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } })).status !== "running");
    expect(await db.collectionRun.count()).toBe(2);
  });

  it("coordena duas instâncias para a mesma query e executa providers uma única vez", async () => {
    const planned = new PlannedSearch([{ amazon: { products: [playstation()], delayMs: 50 }, mercadolivre: { products: [], delayMs: 50 } }]);
    const first = createOnDemandSearch(planned);
    const second = createOnDemandSearch(planned);
    const [a, b] = await Promise.all([
      first.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.4"),
      second.search("PlayStation  5", 1, 20, "BRL", "history", "198.51.100.4"),
    ]);
    expect(a.total).toBe(1);
    expect(b.total).toBe(1);
    expect(planned.callCount).toBe(1);
    expect(await db.collectionRun.count()).toBe(1);
    expect(await db.onDemandRateLimit.findFirstOrThrow()).toMatchObject({ requestCount: 1 });
  });

  it("preserva resultado parcial e continua retornando o provider que funcionou", async () => {
    const planned = new PlannedSearch([{ amazon: { products: [playstation()] }, mercadolivre: { errorCode: "timeout" } }]);
    const result = await createOnDemandSearch(planned).search("playstation 5", 1, 20, "BRL", "history", "198.51.100.6");
    expect(result.total).toBe(1);
    expect(await db.collectionRun.findFirstOrThrow()).toMatchObject({ status: "partial" });
    expect(await db.providerCollectionRun.findFirstOrThrow({ where: { provider: "mercadolivre" } })).toMatchObject({ status: "failed", errorCode: "timeout" });
  });

  it("persiste provider rapido quando o budget encerra o provider lento", async () => {
    const fast: ProductProvider = { name: "amazon", searchProducts: async () => [playstation()] };
    const slow: ProductProvider = {
      name: "mercadolivre",
      searchProducts: async (_query, signal) => new Promise((_, reject) =>
        signal?.addEventListener("abort", () => reject(new ProviderError("mercadolivre", "timeout", "Budget.")), { once: true })),
    };
    const productSearch = new ProductSearchService([fast, slow]);
    const search: CollectionSearchPort = { providerNames: productSearch.providerNames, searchDetailed: (query, options) => productSearch.searchDetailed(query, options) };
    const onDemand = new OnDemandProductSearchService(db, createOrchestrator(search, 30_000, 25), {
      enabled: true, ttlMs: 60_000, rateLimitMax: 3, rateLimitWindowMs: 600_000,
    });
    const result = await onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.31");
    expect(result.total).toBe(1);
    expect(await db.collectionRun.findFirstOrThrow()).toMatchObject({ status: "partial" });
    expect(await db.providerCollectionRun.findFirstOrThrow({ where: { provider: "mercadolivre" } })).toMatchObject({ status: "failed", errorCode: "timeout" });
  });

  it("falha de todos providers mantém a run controlada e permite nova tentativa", async () => {
    const planned = new PlannedSearch([{ amazon: { errorCode: "network_error" }, mercadolivre: { errorCode: "timeout" } }]);
    const onDemand = createOnDemandSearch(planned);
    await expect(onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.7"))
      .rejects.toMatchObject({ status: 502, code: "on_demand_collection_failed" });
    expect(await db.collectionRun.findFirstOrThrow()).toMatchObject({ status: "failed", errorCode: "all_providers_failed" });
    expect((await db.trackedSearch.findFirstOrThrow()).lastCollectedAt).toBeNull();
  });

  it("limita somente novas coletas e não bloqueia uma leitura recente", async () => {
    const planned = new PlannedSearch([{ amazon: { products: [playstation()] }, mercadolivre: { products: [] } }]);
    const onDemand = createOnDemandSearch(planned, { rateLimitMax: 1 });
    await onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.8");
    await expect(onDemand.search("galaxy s24", 1, 20, "BRL", "history", "198.51.100.8"))
      .rejects.toMatchObject({ status: 429, code: "on_demand_rate_limited" });
    await expect(onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.8")).resolves.toMatchObject({ total: 1 });
    expect(planned.callCount).toBe(1);
  });

  it("mantém a API somente leitura quando a feature flag está desligada", async () => {
    const planned = new PlannedSearch([{ amazon: { products: [playstation()] }, mercadolivre: { products: [] } }]);
    const result = await createOnDemandSearch(planned, { enabled: false }).search("playstation 5", 1, 20, "BRL", "history", "198.51.100.9");
    expect(result).toMatchObject({ total: 0, items: [] });
    expect(planned.callCount).toBe(0);
    expect(await db.trackedSearch.count()).toBe(0);
  });
  it("permite tres novas queries e bloqueia a quarta na mesma janela", async () => {
    const planned = new PlannedSearch([{ amazon: { products: [playstation()] }, mercadolivre: { products: [] } }]);
    const onDemand = createOnDemandSearch(planned, { rateLimitMax: 3 });
    for (const query of ["playstation 5", "galaxy s24", "nintendo switch"])
      await onDemand.search(query, 1, 20, "BRL", "history", "198.51.100.10");
    await expect(onDemand.search("iphone 15", 1, 20, "BRL", "history", "198.51.100.10"))
      .rejects.toMatchObject({ status: 429, code: "on_demand_rate_limited" });
    expect(await db.onDemandRateLimit.findFirstOrThrow()).toMatchObject({ requestCount: 3 });
    expect(planned.callCount).toBe(3);
  });

  it("consumes only the final rate-limit slot under concurrent requests", async () => {
    const planned = new PlannedSearch([{ amazon: { products: [playstation()], delayMs: 20 }, mercadolivre: { products: [], delayMs: 20 } }]);
    const first = createOnDemandSearch(planned, { rateLimitMax: 3 });
    const second = createOnDemandSearch(planned, { rateLimitMax: 3 });
    const client = "198.51.100.11";
    await first.search("playstation 5", 1, 20, "BRL", "history", client);
    await first.search("galaxy s24", 1, 20, "BRL", "history", client);
    const results = await Promise.allSettled([
      first.search("nintendo switch", 1, 20, "BRL", "history", client),
      second.search("iphone 15", 1, 20, "BRL", "history", client),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejection?.reason).toMatchObject({ status: 429, code: "on_demand_rate_limited" });
    expect(await db.onDemandRateLimit.findFirstOrThrow()).toMatchObject({ requestCount: 3 });
  });

  it("releases on-demand coordination after timeout so a later retry can run", async () => {
    const planned = new PlannedSearch([
      { amazon: { products: [playstation()], delayMs: 50 }, mercadolivre: { products: [], delayMs: 50 } },
      { amazon: { products: [playstation()] }, mercadolivre: { products: [] } },
    ]);
    const onDemand = new OnDemandProductSearchService(db, createOrchestrator(planned, 5), {
      enabled: true, ttlMs: 1, rateLimitMax: 3, rateLimitWindowMs: 10 * 60 * 1_000,
    });
    await expect(onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.12"))
      .rejects.toMatchObject({ status: 502, code: "on_demand_collection_failed" });
    await expect(onDemand.search("playstation 5", 1, 20, "BRL", "history", "198.51.100.12"))
      .resolves.toMatchObject({ total: 1 });
    expect(planned.callCount).toBe(2);
    expect(await db.collectionRun.count()).toBe(2);
    expect(await db.collectionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } })).toMatchObject({ status: "completed" });
  });
});

describe("CollectionScheduler", () => {
  it("não inicia duas vezes e ignora tick sobreposto", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const port = { recoverInterruptedRuns: async () => 0, runScheduled: async () => waiting };
    const scheduler = new CollectionScheduler(port, 60_000, noopCollectionLogger);
    expect(await scheduler.start()).toBe(true);
    expect(await scheduler.start()).toBe(false);
    const first = scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(await scheduler.tick()).toBe(false);
    release();
    expect(await first).toBe(true);
    scheduler.stop();
  });
});
