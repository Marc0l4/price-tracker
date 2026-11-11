import { afterEach, describe, expect, it, vi } from "vitest";
import { publicApiBaseUrl } from "@/lib/environment";

describe("configuração pública do frontend", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lê a variável pública diretamente do ambiente quando não recebe override", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:3001/");
    expect(publicApiBaseUrl()).toBe("http://localhost:3001");
  });

  it("aceita uma URL HTTP pública e remove barra final", () => {
    expect(publicApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.test/" })).toBe("https://api.example.test");
  });

  it("rejeita URL ausente ou insegura", () => {
    expect(() => publicApiBaseUrl({})).toThrow("NEXT_PUBLIC_API_BASE_URL");
    expect(() => publicApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: "javascript:alert(1)" })).toThrow("HTTP ou HTTPS");
  });
});
