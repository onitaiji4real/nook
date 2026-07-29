ALTER TABLE "merchant_profiles"
ADD COLUMN "published_at" TIMESTAMPTZ(6);

UPDATE "merchant_profiles"
SET "published_at" = "updated_at"
WHERE "visibility_status" = 'PUBLISHED';

ALTER TABLE "merchant_profiles"
ADD CONSTRAINT "merchant_profiles_published_at_check"
CHECK ("visibility_status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);

UPDATE "portfolio_items"
SET "published_at" = "updated_at"
WHERE "status" = 'PUBLISHED' AND "published_at" IS NULL;

ALTER TABLE "portfolio_items"
ADD CONSTRAINT "portfolio_items_published_at_check"
CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);
