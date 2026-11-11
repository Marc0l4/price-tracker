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
  await db.$executeRawUnsafe('TRUNCATE TABLE "PriceObservation", "TrackedSearchOffer", "ProviderCollectionRun", "CollectionRun", "Offer", "ProviderProduct", "CanonicalProduct", "TrackedSearch" RESTART IDENTITY CASCADE');
});

type ProviderPlan = { products?: NormalizedProduct[]; errorCode?: ProviderSearchError["code"]; delayMs?: number };

class PlannedSearch implements CollectionSearchPort {
  private call = 0;
  readonly providerNames: string[];

  constructor(private readonly plans: Array<Record<string, ProviderPlan>>, providers = ["amazon", "mercadolivre"]) {
    this.providerNames = providers;
  }

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

function createOrchestrator(search: CollectionSearchPort, timeoutMs = 30_000) {
  return new CollectionOrchestrator(
    db,
    search,
    new ProductPersistenceService(db),
    undefined,
    noopCollectionLogger,
    { collectionTimeoutMs: timeoutMs, staleRunMs: 1_000 },
  );
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
