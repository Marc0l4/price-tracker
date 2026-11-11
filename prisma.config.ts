import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const rootEnvironment = path.join(projectRoot, ".env");

if (existsSync(rootEnvironment)) {
  process.loadEnvFile(rootEnvironment);
}

export default defineConfig({
  schema: path.join(projectRoot, "apps/api/prisma/schema.prisma"),
  migrations: {
    path: path.join(projectRoot, "apps/api/prisma/migrations"),
  },
  datasource: {
    // Runtime can use Neon's pooled URL while Prisma CLI operations use a
    // direct URL. Local development keeps using DATABASE_URL unchanged.
    url: process.env.DIRECT_DATABASE_URL ?? env("DATABASE_URL"),
  },
});
