-- Milestone 5: durable collection orchestration and query-scoped offer lifecycle.
CREATE TYPE "CollectionRunStatus" AS ENUM ('running', 'completed', 'partial', 'failed');
CREATE TYPE "CollectionTrigger" AS ENUM ('manual', 'scheduled');
CREATE TYPE "ProviderCollectionRunStatus" AS ENUM ('running', 'success', 'failed');

CREATE TABLE "TrackedSearch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "query" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCollectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TrackedSearch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrackedSearch_query_nonempty" CHECK (btrim("query") <> '')
);

CREATE TABLE "CollectionRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "collectionKey" TEXT NOT NULL,
    "trackedSearchId" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "status" "CollectionRunStatus" NOT NULL DEFAULT 'running',
    "trigger" "CollectionTrigger" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "attemptStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,
    "productsReceived" INTEGER NOT NULL DEFAULT 0,
    "matchedGroupCount" INTEGER NOT NULL DEFAULT 0,
    "persistedGroupCount" INTEGER NOT NULL DEFAULT 0,
    "failedGroupCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CollectionRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CollectionRun_collectionKey_nonempty" CHECK (btrim("collectionKey") <> ''),
    CONSTRAINT "CollectionRun_query_nonempty" CHECK (btrim("query") <> ''),
    CONSTRAINT "CollectionRun_attempt_positive" CHECK ("attempt" > 0),
    CONSTRAINT "CollectionRun_duration_nonnegative" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);

CREATE TABLE "ProviderCollectionRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "collectionRunId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "ProviderCollectionRunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,
    "resultCount" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderCollectionRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderCollectionRun_provider_nonempty" CHECK (btrim("provider") <> ''),
    CONSTRAINT "ProviderCollectionRun_attempt_positive" CHECK ("attempt" > 0),
    CONSTRAINT "ProviderCollectionRun_duration_nonnegative" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);

CREATE TABLE "TrackedSearchOffer" (
    "trackedSearchId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackedSearchOffer_pkey" PRIMARY KEY ("trackedSearchId", "offerId")
);

CREATE UNIQUE INDEX "TrackedSearch_query_key" ON "TrackedSearch"("query");
CREATE INDEX "TrackedSearch_active_idx" ON "TrackedSearch"("active");
CREATE UNIQUE INDEX "CollectionRun_collectionKey_key" ON "CollectionRun"("collectionKey");
CREATE INDEX "CollectionRun_status_startedAt_idx" ON "CollectionRun"("status", "startedAt");
CREATE INDEX "CollectionRun_trackedSearchId_startedAt_idx" ON "CollectionRun"("trackedSearchId", "startedAt");
CREATE UNIQUE INDEX "ProviderCollectionRun_collectionRunId_provider_attempt_key" ON "ProviderCollectionRun"("collectionRunId", "provider", "attempt");
CREATE INDEX "ProviderCollectionRun_collectionRunId_provider_idx" ON "ProviderCollectionRun"("collectionRunId", "provider");
CREATE INDEX "TrackedSearchOffer_offerId_idx" ON "TrackedSearchOffer"("offerId");

ALTER TABLE "CollectionRun" ADD CONSTRAINT "CollectionRun_trackedSearchId_fkey"
  FOREIGN KEY ("trackedSearchId") REFERENCES "TrackedSearch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderCollectionRun" ADD CONSTRAINT "ProviderCollectionRun_collectionRunId_fkey"
  FOREIGN KEY ("collectionRunId") REFERENCES "CollectionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackedSearchOffer" ADD CONSTRAINT "TrackedSearchOffer_trackedSearchId_fkey"
  FOREIGN KEY ("trackedSearchId") REFERENCES "TrackedSearch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackedSearchOffer" ADD CONSTRAINT "TrackedSearchOffer_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
