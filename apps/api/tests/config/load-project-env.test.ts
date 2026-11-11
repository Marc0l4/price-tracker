import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProjectEnv } from "../../src/shared/config/load-project-env.js";

const original = process.env.PRICE_TRACKER_BOOTSTRAP_TEST;
const originalInitialDirectory = process.env.INIT_CWD;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (original === undefined) delete process.env.PRICE_TRACKER_BOOTSTRAP_TEST;
  else process.env.PRICE_TRACKER_BOOTSTRAP_TEST = original;
  if (originalInitialDirectory === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = originalInitialDirectory;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("loadProjectEnv", () => {
  it("carrega o .env da raiz sem expor seu conteúdo", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "price-tracker-env-"));
    await mkdir(path.join(temporaryDirectory, "apps", "api"), { recursive: true });
    await writeFile(path.join(temporaryDirectory, ".env"), "PRICE_TRACKER_BOOTSTRAP_TEST=loaded-root\n");
    expect(loadProjectEnv(temporaryDirectory)).toHaveLength(1);
    expect(process.env.PRICE_TRACKER_BOOTSTRAP_TEST).toBe("loaded-root");
  });

  it("também considera apps/api/.env quando a raiz não existe", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "price-tracker-env-"));
    await mkdir(path.join(temporaryDirectory, "apps", "api"), { recursive: true });
    await writeFile(path.join(temporaryDirectory, "apps", "api", ".env"), "PRICE_TRACKER_BOOTSTRAP_TEST=loaded-api\n");
    expect(loadProjectEnv(temporaryDirectory)).toHaveLength(1);
    expect(process.env.PRICE_TRACKER_BOOTSTRAP_TEST).toBe("loaded-api");
  });

  it("usa a raiz original do npm antes de compor dependências", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "price-tracker-env-"));
    await mkdir(path.join(temporaryDirectory, "apps", "api"), { recursive: true });
    await writeFile(path.join(temporaryDirectory, ".env"), "PRICE_TRACKER_BOOTSTRAP_TEST=loaded-before-composition\n");
    process.env.INIT_CWD = temporaryDirectory;

    expect(loadProjectEnv()).toHaveLength(1);
    expect(process.env.PRICE_TRACKER_BOOTSTRAP_TEST).toBe("loaded-before-composition");
  });
});
