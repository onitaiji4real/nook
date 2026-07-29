-- Phase 2 expand migration: merchant profile, primary location, and first service.
CREATE TYPE "MerchantCategory" AS ENUM ('NAIL', 'LASH', 'BROW', 'BEAUTY', 'HAIR', 'OTHER');
CREATE TYPE "MerchantVisibilityStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED');
CREATE TYPE "MerchantVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "LocationStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "ServicePriceType" AS ENUM ('FIXED', 'FROM', 'RANGE', 'QUOTE');
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "merchant_profiles" (
    "tenant_id" UUID NOT NULL,
    "category" "MerchantCategory" NOT NULL,
    "description" VARCHAR(2000),
    "phone" VARCHAR(32),
    "line_oa_url" TEXT,
    "instagram_url" TEXT,
    "booking_policy" VARCHAR(2000),
    "cancellation_policy" VARCHAR(2000),
    "visibility_status" "MerchantVisibilityStatus" NOT NULL DEFAULT 'DRAFT',
    "verification_status" "MerchantVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "primary_location_id" UUID,
    "starter_service_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "merchant_profiles_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address_text" VARCHAR(500) NOT NULL,
    "postal_code" VARCHAR(10),
    "city" VARCHAR(80) NOT NULL,
    "district" VARCHAR(80) NOT NULL,
    "geo_point" geography(Point, 4326),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Taipei',
    "is_public_address" BOOLEAN NOT NULL DEFAULT false,
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "locations_timezone_check" CHECK (char_length("timezone") BETWEEN 1 AND 64)
);

CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "duration_minutes" INTEGER NOT NULL,
    "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "price_type" "ServicePriceType" NOT NULL,
    "price_amount" INTEGER,
    "price_min" INTEGER,
    "price_max" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'TWD',
    "booking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "services_duration_check" CHECK ("duration_minutes" BETWEEN 5 AND 720),
    CONSTRAINT "services_buffer_before_check" CHECK ("buffer_before_minutes" BETWEEN 0 AND 180),
    CONSTRAINT "services_buffer_after_check" CHECK ("buffer_after_minutes" BETWEEN 0 AND 180),
    CONSTRAINT "services_currency_check" CHECK ("currency" = 'TWD'),
    CONSTRAINT "services_price_check" CHECK (
      ("price_type" IN ('FIXED', 'FROM') AND "price_amount" BETWEEN 0 AND 10000000 AND "price_min" IS NULL AND "price_max" IS NULL)
      OR
      ("price_type" = 'RANGE' AND "price_amount" IS NULL AND "price_min" BETWEEN 0 AND 10000000 AND "price_max" BETWEEN "price_min" AND 10000000)
      OR
      ("price_type" = 'QUOTE' AND "price_amount" IS NULL AND "price_min" IS NULL AND "price_max" IS NULL)
    )
);

CREATE UNIQUE INDEX "locations_tenant_id_id_key" ON "locations"("tenant_id", "id");
CREATE INDEX "locations_tenant_status_idx" ON "locations"("tenant_id", "status");
CREATE UNIQUE INDEX "services_tenant_id_id_key" ON "services"("tenant_id", "id");
CREATE INDEX "services_tenant_status_booking_idx" ON "services"("tenant_id", "status", "booking_enabled");
CREATE UNIQUE INDEX "merchant_profiles_primary_location_key" ON "merchant_profiles"("tenant_id", "primary_location_id");
CREATE UNIQUE INDEX "merchant_profiles_starter_service_key" ON "merchant_profiles"("tenant_id", "starter_service_id");

ALTER TABLE "merchant_profiles"
ADD CONSTRAINT "merchant_profiles_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "locations"
ADD CONSTRAINT "locations_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "services"
ADD CONSTRAINT "services_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merchant_profiles"
ADD CONSTRAINT "merchant_profiles_primary_location_fkey"
FOREIGN KEY ("tenant_id", "primary_location_id") REFERENCES "locations"("tenant_id", "id")
ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "merchant_profiles"
ADD CONSTRAINT "merchant_profiles_starter_service_fkey"
FOREIGN KEY ("tenant_id", "starter_service_id") REFERENCES "services"("tenant_id", "id")
ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
