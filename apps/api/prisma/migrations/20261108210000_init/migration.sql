-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('confirmed', 'provisional', 'review_required');

-- CreateTable
CREATE TABLE "CanonicalProduct" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "gtin" TEXT,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'provisional',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CanonicalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderProduct" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "gtin" TEXT,
    "imageUrl" TEXT,
    "canonicalProductId" UUID,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'provisional',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "providerProductId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalOfferId" TEXT NOT NULL,
    "storeName" TEXT,
    "productUrl" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "offerId" UUID NOT NULL,
    "price" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "shippingAmount" DECIMAL(19,4),
    "shippingIsFree" BOOLEAN,
    "collectedAt" TIMESTAMPTZ(3) NOT NULL,
    "collectionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderProduct_canonicalProductId_idx" ON "ProviderProduct"("canonicalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProduct_provider_externalId_key" ON "ProviderProduct"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProduct_id_provider_key" ON "ProviderProduct"("id", "provider");

-- CreateIndex
CREATE INDEX "Offer_providerProductId_idx" ON "Offer"("providerProductId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_provider_externalOfferId_key" ON "Offer"("provider", "externalOfferId");

-- CreateIndex
CREATE INDEX "PriceObservation_offerId_collectedAt_idx" ON "PriceObservation"("offerId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceObservation_offerId_collectionKey_key" ON "PriceObservation"("offerId", "collectionKey");

-- AddForeignKey
ALTER TABLE "ProviderProduct" ADD CONSTRAINT "ProviderProduct_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_providerProductId_provider_fkey" FOREIGN KEY ("providerProductId", "provider") REFERENCES "ProviderProduct"("id", "provider") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Observations are append-only. Test resets use TRUNCATE in an isolated database.
CREATE FUNCTION reject_price_observation_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'PriceObservation is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PriceObservation_immutable"
BEFORE UPDATE OR DELETE ON "PriceObservation"
FOR EACH ROW EXECUTE FUNCTION reject_price_observation_mutation();
