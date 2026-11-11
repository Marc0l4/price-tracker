import { existsSync } from "node:fs";
import path from "node:path";

/** Loads local development env files without logging their contents. */
export function loadProjectEnv(cwd = process.env.INIT_CWD ?? process.cwd()): string[] {
  const loaded: string[] = [];
  for (const envFile of [path.resolve(cwd, ".env"), path.resolve(cwd, "apps/api/.env")]) {
    if (existsSync(envFile)) {
      process.loadEnvFile(envFile);
      loaded.push(envFile);
    }
  }
  return loaded;
}
