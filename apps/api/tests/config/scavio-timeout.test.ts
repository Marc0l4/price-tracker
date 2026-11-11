import { afterEach, describe, expect, it } from "vitest";
import { scavioAmazonTimeoutMsFromEnvironment } from "../../src/collection/collection-config.js";

const previous = process.env.SCAVIO_AMAZON_TIMEOUT_MS;

afterEach(() => {
  if (previous === undefined) delete process.env.SCAVIO_AMAZON_TIMEOUT_MS;
  else process.env.SCAVIO_AMAZON_TIMEOUT_MS = previous;
});

describe("timeout Amazon Scavio", () => {
  it("usa 15 segundos por padrão", () => {
    delete process.env.SCAVIO_AMAZON_TIMEOUT_MS;
    expect(scavioAmazonTimeoutMsFromEnvironment()).toBe(15_000);
  });

  it("aceita timeout configurável", () => {
    process.env.SCAVIO_AMAZON_TIMEOUT_MS = "18000";
    expect(scavioAmazonTimeoutMsFromEnvironment()).toBe(18_000);
  });

  it("rejeita valor inválido em vez de criar timeout indefinido", () => {
    process.env.SCAVIO_AMAZON_TIMEOUT_MS = "0";
    expect(() => scavioAmazonTimeoutMsFromEnvironment()).toThrow("SCAVIO_AMAZON_TIMEOUT_MS");
  });
});
