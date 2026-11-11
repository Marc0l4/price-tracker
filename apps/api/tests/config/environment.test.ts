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

  it("falha cedo com mensagem sanitizada quando configuração obrigatória está ausente", () => {
    expect(() => readApiEnvironmentFromEnvironment({ CORS_ORIGIN: "http://localhost:3000" })).toThrow("DATABASE_URL");
    expect(() => readApiEnvironmentFromEnvironment({ ...readEnvironment, DATABASE_URL: "https://database.example.test" })).toThrow("DATABASE_URL");
    expect(() => collectionEnvironmentFromEnvironment({ ...readEnvironment })).toThrow("SCAVIO_API_KEY");
  });

  it("monta dependências externas apenas a partir de configuração explícita", () => {
    const config = collectionEnvironmentFromEnvironment({ ...readEnvironment, SCAVIO_API_KEY: "test-key", SCAVIO_AMAZON_TIMEOUT_MS: "18000" });
    expect(config).toMatchObject({ scavioApiKey: "test-key", scavioAmazonTimeoutMs: 18_000, collectionIntervalMs: 1_800_000 });
  });
});
