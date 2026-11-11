import { createCollectionOrchestrator } from "../index.js";
import { loadProjectEnv } from "../shared/config/load-project-env.js";
import { collectionEnvironmentFromEnvironment, readApiEnvironmentFromEnvironment } from "../shared/config/environment.js";
import { createPrismaClient } from "../infrastructure/database/prisma-client.js";

loadProjectEnv();

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) throw new Error("Uso: npm run collect -- \"iphone 15\"");
  const readConfiguration = readApiEnvironmentFromEnvironment();
  const configuration = collectionEnvironmentFromEnvironment();
  const database = createPrismaClient(readConfiguration.databaseUrl);
  const db = database.client;
  try {
    const orchestrator = createCollectionOrchestrator(db, configuration);
    await orchestrator.recoverInterruptedRuns();
    const result = await orchestrator.runManual(query);
    const collectionRunId = result.collectionRun?.id;
    const providerRuns = collectionRunId
      ? await db.providerCollectionRun.findMany({ where: { collectionRunId }, orderBy: { provider: "asc" } })
      : [];
    console.info(JSON.stringify({
      event: "collection.cli_finished",
      status: result.status,
      collectionRunId,
      productsReceived: result.collectionRun?.productsReceived,
      persistedGroupCount: result.collectionRun?.persistedGroupCount,
      failedGroupCount: result.collectionRun?.failedGroupCount,
    }));
    for (const providerRun of providerRuns) {
      console.info(JSON.stringify({
        event: providerRun.status === "failed" ? "collection.provider_failed" : "collection.provider_finished",
        collectionRunId,
        provider: providerRun.provider,
        status: providerRun.status,
        errorCode: providerRun.errorCode,
        resultCount: providerRun.resultCount,
        durationMs: providerRun.durationMs,
      }));
    }
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  const raw = error instanceof Error ? error.message : "";
  const message = /DATABASE_URL|Can't reach database|P1001|P1012|ECONNREFUSED/i.test(raw)
    ? "A coleta manual não conseguiu conectar ao banco de desenvolvimento."
    : "A coleta manual falhou.";
  console.error(message);
  process.exitCode = 1;
});
