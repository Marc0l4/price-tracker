-- Milestone 6 read paths: active offers by product and latest observations by offer.
CREATE INDEX "Offer_providerProductId_isActive_idx" ON "Offer"("providerProductId", "isActive");
