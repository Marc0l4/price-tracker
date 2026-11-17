import { describe, expect, it } from "vitest";
import { collectionEnvironmentFromEnvironment, readApiEnvironmentFromEnvironment } from "../../src/shared/config/environment.js";

const readEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/price_tracker_test?schema=public",
  API_PORT: "3001",
  CORS_ORIGIN: "http://localhost:3000",
};

describe("configuração de ambiente", () => {
  it("valida configuração de leitura e mantém scheduler desligado por padrão", () => {
    expect(readApiEnvironmentFromEnvironment(readEnvironment)).toMatchObject({ apiPort: 3001, corsOrigin: "http://localhost:3000", schedulerEnabled: false });
  });

  it("prioriza PORT da plataforma sem alterar o fallback local", () => {
    expect(readApiEnvironmentFromEnvironment({ ...readEnvironment, PORT: "10000" }).apiPort).toBe(10_000);
  });

  it("aceita scheduler explicitamente habilitado", () => {
    expect(readApiEnvironmentFromEnvironment({ ...readEnvironment, COLLECTION_SCHEDULER_ENABLED: "true" }).schedulerEnabled).toBe(true);
  });

  it("mantém coleta sob demanda desligada por padrão e valida sua configuração", () => {
    expect(readApiEnvironmentFromEnvironment(readEnvironment)).toMatchObject({
      onDemandCollectionEnabled: false,
      onDemandCollectionTtlMs: 21_600_000,
      onDemandRateLimitMax: 3,
      onDemandRateLimitWindowMs: 600_000,
      onDemandTrustProxy: false,
    });
    expect(readApiEnvironmentFromEnvironment({
      ...readEnvironment,
      ON_DEMAND_COLLECTION_ENABLED: "true",
      ON_DEMAND_COLLECTION_TTL_MINUTES: "45",
      ON_DEMAND_RATE_LIMIT_MAX: "4",
      ON_DEMAND_RATE_LIMIT_WINDOW_MINUTES: "12",
      ON_DEMAND_TRUST_PROXY: "true",
    })).toMatchObject({ onDemandCollectionEnabled: true, onDemandCollectionTtlMs: 2_700_000, onDemandRateLimitMax: 4, onDemandRateLimitWindowMs: 720_000, onDemandTrustProxy: true });
    expect(() => readApiEnvironmentFromEnvironment({ ...readEnvironment, ON_DEMAND_RATE_LIMIT_MAX: "0" })).toThrow("ON_DEMAND_RATE_LIMIT_MAX");
  });

  it("falha cedo com mensagem sanitizada quando configuração obrigatória está ausente", () => {
    expect(() => readApiEnvironmentFromEnvironment({ CORS_ORIGIN: "http://localhost:3000" })).toThrow("DATABASE_URL");
    expect(() => readApiEnvironmentFromEnvironment({ ...readEnvironment, DATABASE_URL: "https://database.example.test" })).toThrow("DATABASE_URL");
    expect(() => collectionEnvironmentFromEnvironment({ ...readEnvironment })).toThrow("SCAVIO_API_KEY");
  });

  it("monta dependências externas apenas a partir de configuração explícita", () => {
    const config = collectionEnvironmentFromEnvironment({ ...readEnvironment, SCAVIO_API_KEY: "test-key", SCAVIO_AMAZON_TIMEOUT_MS: "18000", SCAVIO_MERCADOLIVRE_TIMEOUT_MS: "11000", ON_DEMAND_COLLECTION_BUDGET_MS: "25000" });
    expect(config).toMatchObject({ scavioApiKey: "test-key", scavioAmazonTimeoutMs: 18_000, scavioMercadoLivreTimeoutMs: 11_000, onDemandCollectionBudgetMs: 25_000, collectionIntervalMs: 1_800_000 });
  });
});
