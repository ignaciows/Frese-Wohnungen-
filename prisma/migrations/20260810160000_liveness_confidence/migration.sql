-- The text detector's output, stored per listing.
--
-- onlineConfidence is a percentage rather than a flag on purpose: the reading
-- comes from page text and is sometimes wrong, so the UI needs to be able to
-- show "70 % noch online" and let a colleague decide, instead of silently
-- hiding an ad that might be fine.
ALTER TABLE "Listing" ADD COLUMN "onlineConfidence" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "livenessSignals" JSONB;

-- What the ad says about its own age, read off the page.
ALTER TABLE "Listing" ADD COLUMN "postedAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "postedAtLabel" TEXT;

-- The result list orders by "confirmed live first, then newest ad".
CREATE INDEX "Listing_onlineConfidence_postedAt_idx"
  ON "Listing"("onlineConfidence", "postedAt");
