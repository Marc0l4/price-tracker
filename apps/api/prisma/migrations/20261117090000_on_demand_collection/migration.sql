-- On-demand collection: durable per-client quota accounting.
-- Query-level collection coordination uses PostgreSQL advisory locks at runtime;
-- it does not require a persistent lock row or a migration.
CREATE TABLE "OnDemandRateLimit" (
    "clientKey" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "OnDemandRateLimit_pkey" PRIMARY KEY ("clientKey", "windowStartedAt"),
    CONSTRAINT "OnDemandRateLimit_requestCount_nonnegative" CHECK ("requestCount" >= 0)
);

CREATE INDEX "OnDemandRateLimit_windowStartedAt_idx" ON "OnDemandRateLimit"("windowStartedAt");
