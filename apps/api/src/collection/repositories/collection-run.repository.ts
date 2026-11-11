import { randomUUID } from "node:crypto";
import { CollectionRunStatus, ProviderCollectionRunStatus, type CollectionTrigger, type PrismaClient } from "../../generated/prisma/client.js";
import type { ProviderRunCompletion } from "../collection-contracts.js";

export class CollectionRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(trackedSearchId: string, query: string, trigger: CollectionTrigger, startedAt: Date) {
    const id = randomUUID();
    return this.db.collectionRun.create({ data: {
      id, collectionKey: id, trackedSearchId, query, trigger, startedAt, attemptStartedAt: startedAt,
    } });
  }

  async restart(runId: string, startedAt: Date) {
    const previous = await this.db.collectionRun.findUniqueOrThrow({ where: { id: runId }, include: { trackedSearch: true } });
    if (previous.status === CollectionRunStatus.running) throw new Error("A execução ainda está em andamento.");
    const run = await this.db.collectionRun.update({ where: { id: runId }, data: {
      status: CollectionRunStatus.running,
      attempt: { increment: 1 },
      attemptStartedAt: startedAt,
      finishedAt: null,
      durationMs: null,
      productsReceived: 0,
      matchedGroupCount: 0,
      persistedGroupCount: 0,
      failedGroupCount: 0,
      errorCode: null,
    } });
    return { run, trackedSearch: previous.trackedSearch };
  }

  findWithTrackedSearch(runId: string) {
    return this.db.collectionRun.findUnique({ where: { id: runId }, include: { trackedSearch: true } });
  }

  createProviderRuns(collectionRunId: string, attempt: number, providers: string[], startedAt: Date) {
    return this.db.providerCollectionRun.createMany({ data: providers.map((provider) => ({
      collectionRunId, provider, attempt, startedAt,
    })) });
  }

  async completeProviderRuns(collectionRunId: string, attempt: number, outcomes: ProviderRunCompletion[]) {
    await Promise.all(outcomes.map((outcome) => this.db.providerCollectionRun.update({
      where: { collectionRunId_provider_attempt: { collectionRunId, provider: outcome.provider, attempt } },
      data: {
        status: outcome.status,
        startedAt: outcome.startedAt,
        finishedAt: outcome.finishedAt,
        durationMs: outcome.durationMs,
        resultCount: outcome.resultCount,
        errorCode: outcome.errorCode,
      },
    })));
  }

  finish(
    runId: string,
    status: CollectionRunStatus,
    attemptStartedAt: Date,
    finishedAt: Date,
    counts: { productsReceived: number; matchedGroupCount: number; persistedGroupCount: number; failedGroupCount: number },
    errorCode?: string,
  ) {
    return this.db.collectionRun.update({ where: { id: runId }, data: {
      status, finishedAt, durationMs: Math.max(0, finishedAt.getTime() - attemptStartedAt.getTime()), errorCode: errorCode ?? null,
      ...counts,
    } });
  }

  async failUnexpected(runId: string, attempt: number, attemptStartedAt: Date, finishedAt: Date, errorCode: string) {
    const providerRuns = await this.db.providerCollectionRun.findMany({ where: {
      collectionRunId: runId,
      attempt,
      status: ProviderCollectionRunStatus.running,
    } });
    const [run] = await this.db.$transaction([
      this.db.collectionRun.update({ where: { id: runId }, data: {
        status: CollectionRunStatus.failed,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - attemptStartedAt.getTime()),
        errorCode,
      } }),
      ...providerRuns.map((providerRun) => this.db.providerCollectionRun.update({ where: { id: providerRun.id }, data: {
        status: ProviderCollectionRunStatus.failed,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - providerRun.startedAt.getTime()),
        errorCode,
      } })),
    ]);
    return run;
  }

  async recoverInterrupted(before: Date, finishedAt: Date): Promise<number> {
    const stale = await this.db.collectionRun.findMany({ where: { status: CollectionRunStatus.running, attemptStartedAt: { lt: before } } });
    await Promise.all(stale.map(async (run) => {
      const providerRuns = await this.db.providerCollectionRun.findMany({ where: {
        collectionRunId: run.id,
        attempt: run.attempt,
        status: ProviderCollectionRunStatus.running,
      } });
      await this.db.$transaction([
        this.db.collectionRun.update({ where: { id: run.id }, data: {
          status: CollectionRunStatus.failed,
          finishedAt,
          durationMs: Math.max(0, finishedAt.getTime() - run.attemptStartedAt.getTime()),
          errorCode: "interrupted",
        } }),
        ...providerRuns.map((providerRun) => this.db.providerCollectionRun.update({ where: { id: providerRun.id }, data: {
          status: ProviderCollectionRunStatus.failed,
          finishedAt,
          durationMs: Math.max(0, finishedAt.getTime() - providerRun.startedAt.getTime()),
          errorCode: "interrupted",
        } })),
      ]);
    }));
    return stale.length;
  }
}
