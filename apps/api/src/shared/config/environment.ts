import { z } from "zod";

const positiveInteger = z.coerce.number().int().min(1);
const httpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "deve usar HTTP ou HTTPS");
const postgresUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "postgresql:" || protocol === "postgres:";
}, "deve usar PostgreSQL");

export interface ReadApiEnvironment {
  databaseUrl: string;
  apiPort: number;
  corsOrigin: string;
  schedulerEnabled: boolean;
}

export interface CollectionEnvironment {
  scavioApiKey: string;
  scavioAmazonTimeoutMs: number;
  collectionIntervalMs: number;
  collectionTimeoutMs: number;
  staleRunMs: number;
}

function requiredString(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`Configuração inválida: ${name} é obrigatória.`);
  return value;
}

type SafeParseSchema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
};

function parseOrThrow<T>(schema: SafeParseSchema<T>, name: string, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Configuração inválida: ${name} ${parsed.error.issues[0]?.message ?? "é inválida"}.`);
  return parsed.data;
}

function booleanFromEnvironment(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return parseOrThrow(z.enum(["true", "false"]).transform((item) => item === "true"), name, value);
}

export function readApiEnvironmentFromEnvironment(environment = process.env): ReadApiEnvironment {
  const databaseUrl = parseOrThrow(postgresUrl, "DATABASE_URL", requiredString("DATABASE_URL", environment.DATABASE_URL));
  const apiPort = parseOrThrow(positiveInteger.max(65_535), "PORT", environment.PORT ?? environment.API_PORT ?? environment.READ_API_PORT ?? "3001");
  const corsOrigin = new URL(parseOrThrow(httpUrl, "CORS_ORIGIN", environment.CORS_ORIGIN ?? environment.WEB_ORIGIN ?? "http://localhost:3000")).origin;
  return { databaseUrl, apiPort, corsOrigin, schedulerEnabled: booleanFromEnvironment("COLLECTION_SCHEDULER_ENABLED", environment.COLLECTION_SCHEDULER_ENABLED, false) };
}

export function collectionEnvironmentFromEnvironment(environment = process.env): CollectionEnvironment {
  const minute = 60_000;
  return {
    scavioApiKey: requiredString("SCAVIO_API_KEY", environment.SCAVIO_API_KEY),
    scavioAmazonTimeoutMs: parseOrThrow(positiveInteger, "SCAVIO_AMAZON_TIMEOUT_MS", environment.SCAVIO_AMAZON_TIMEOUT_MS ?? "15000"),
    collectionIntervalMs: parseOrThrow(positiveInteger, "COLLECTION_INTERVAL_MINUTES", environment.COLLECTION_INTERVAL_MINUTES ?? "30") * minute,
    collectionTimeoutMs: parseOrThrow(positiveInteger, "COLLECTION_TIMEOUT_MS", environment.COLLECTION_TIMEOUT_MS ?? "30000"),
    staleRunMs: parseOrThrow(positiveInteger, "COLLECTION_STALE_RUN_MINUTES", environment.COLLECTION_STALE_RUN_MINUTES ?? "60") * minute,
  };
}
