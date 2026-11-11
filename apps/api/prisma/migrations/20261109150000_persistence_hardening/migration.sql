-- Offer lifecycle: existing offers are considered last seen when this migration runs.
ALTER TABLE "Offer"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastCheckedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Offer_provider_isActive_idx" ON "Offer"("provider", "isActive");

-- Product identity updates are monotonic by the instant observed at the provider.
ALTER TABLE "ProviderProduct"
ADD COLUMN "lastObservedAt" TIMESTAMPTZ(3);

UPDATE "ProviderProduct"
SET "lastObservedAt" = "updatedAt";

ALTER TABLE "ProviderProduct"
ALTER COLUMN "lastObservedAt" SET NOT NULL,
ALTER COLUMN "lastObservedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- External identities and collection identity must contain visible characters.
ALTER TABLE "ProviderProduct"
ADD CONSTRAINT "ProviderProduct_provider_nonempty" CHECK (btrim("provider") <> ''),
ADD CONSTRAINT "ProviderProduct_externalId_nonempty" CHECK (btrim("externalId") <> ''),
ADD CONSTRAINT "ProviderProduct_confirmed_requires_canonical" CHECK (
  "matchStatus" <> 'confirmed' OR "canonicalProductId" IS NOT NULL
);

ALTER TABLE "Offer"
ADD CONSTRAINT "Offer_provider_nonempty" CHECK (btrim("provider") <> ''),
ADD CONSTRAINT "Offer_externalOfferId_nonempty" CHECK (btrim("externalOfferId") <> '');

ALTER TABLE "PriceObservation"
ADD CONSTRAINT "PriceObservation_collectionKey_nonempty" CHECK (btrim("collectionKey") <> ''),
ADD CONSTRAINT "PriceObservation_currency_iso_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
ADD CONSTRAINT "PriceObservation_price_positive" CHECK ("price" > 0),
ADD CONSTRAINT "PriceObservation_shipping_nonnegative" CHECK ("shippingAmount" IS NULL OR "shippingAmount" >= 0);
