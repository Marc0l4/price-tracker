const MINUTE_MS = 60_000;

function positiveEnvironmentNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} deve ser um número positivo.`);
  return value;
}

export function collectionIntervalMsFromEnvironment(): number {
  return positiveEnvironmentNumber("COLLECTION_INTERVAL_MINUTES", 30) * MINUTE_MS;
}

export function collectionTimeoutMsFromEnvironment(): number {
  return positiveEnvironmentNumber("COLLECTION_TIMEOUT_MS", 30_000);
}

export function staleRunMsFromEnvironment(): number {
  return positiveEnvironmentNumber("COLLECTION_STALE_RUN_MINUTES", 60) * MINUTE_MS;
}

export function scavioAmazonTimeoutMsFromEnvironment(): number {
  return positiveEnvironmentNumber("SCAVIO_AMAZON_TIMEOUT_MS", 15_000);
}
