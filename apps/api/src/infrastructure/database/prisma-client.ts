import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../../generated/prisma/client.js";

const CONNECTION_TIMEOUT_MS = 5_000;

export interface PrismaDatabase {
  readonly client: PrismaClient;
  readonly pool: Pool;
  close(): Promise<void>;
}

export function createPrismaClient(databaseUrl: string): PrismaDatabase {
  const parsedUrl = new URL(databaseUrl);
  const schema = parsedUrl.searchParams.get("schema") ?? undefined;
  parsedUrl.searchParams.delete("schema");

  const pool = new Pool({
    connectionString: parsedUrl.toString(),
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  const adapter = new PrismaPg(pool, { schema });
  const client = new PrismaClient({ adapter });

  let closing: Promise<void> | undefined;
  return {
    client,
    pool,
    close() {
      closing ??= (async () => {
        await client.$disconnect();
        await pool.end();
      })();
      return closing;
    },
  };
}
