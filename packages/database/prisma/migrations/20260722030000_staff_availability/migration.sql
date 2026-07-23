-- Phase 2 expand migration: staff entitlement, qualifications, weekly schedules, and exceptions.
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "AvailabilityExceptionType" AS ENUM ('TIME_OFF', 'EXTRA_HOURS', 'BLOCK');
CREATE TYPE "AvailabilityExceptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "location_id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "bio" VARCHAR(2000),
    "booking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_services" (
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "custom_duration_minutes" INTEGER,
    "custom_price_amount" INTEGER,

    CONSTRAINT "staff_services_pkey" PRIMARY KEY ("tenant_id", "staff_id", "service_id"),
    CONSTRAINT "staff_services_custom_duration_check" CHECK (
        "custom_duration_minutes" IS NULL OR "custom_duration_minutes" BETWEEN 5 AND 720
    ),
    CONSTRAINT "staff_services_custom_price_check" CHECK (
        "custom_price_amount" IS NULL OR "custom_price_amount" >= 0
    )
);

CREATE TABLE "weekly_availability_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "weekly_availability_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "weekly_availability_rules_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7),
    CONSTRAINT "weekly_availability_rules_time_check" CHECK (
        "start_time" < "end_time"
        AND EXTRACT(MINUTE FROM "start_time")::INTEGER % 15 = 0
        AND EXTRACT(SECOND FROM "start_time") = 0
        AND EXTRACT(MINUTE FROM "end_time")::INTEGER % 15 = 0
        AND EXTRACT(SECOND FROM "end_time") = 0
    ),
    CONSTRAINT "weekly_availability_rules_date_check" CHECK (
        "valid_until" IS NULL OR "valid_until" >= "valid_from"
    )
);

CREATE TABLE "availability_exceptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "type" "AvailabilityExceptionType" NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" VARCHAR(500),
    "status" "AvailabilityExceptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "availability_exceptions_time_check" CHECK ("start_at" < "end_at")
);

CREATE UNIQUE INDEX "staff_profiles_tenant_id_id_key"
ON "staff_profiles"("tenant_id", "id");
CREATE INDEX "staff_profiles_tenant_status_booking_idx"
ON "staff_profiles"("tenant_id", "status", "booking_enabled");
CREATE INDEX "staff_profiles_tenant_sort_idx"
ON "staff_profiles"("tenant_id", "sort_order", "id");
CREATE INDEX "staff_profiles_user_id_idx" ON "staff_profiles"("user_id");
CREATE INDEX "staff_services_tenant_service_idx"
ON "staff_services"("tenant_id", "service_id");
CREATE UNIQUE INDEX "weekly_availability_rules_tenant_id_id_key"
ON "weekly_availability_rules"("tenant_id", "id");
CREATE INDEX "weekly_rules_staff_weekday_idx"
ON "weekly_availability_rules"("tenant_id", "staff_id", "weekday", "valid_from");
CREATE UNIQUE INDEX "availability_exceptions_tenant_id_id_key"
ON "availability_exceptions"("tenant_id", "id");
CREATE INDEX "availability_exceptions_staff_range_idx"
ON "availability_exceptions"("tenant_id", "staff_id", "status", "start_at", "end_at");

ALTER TABLE "staff_profiles"
ADD CONSTRAINT "staff_profiles_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_profiles"
ADD CONSTRAINT "staff_profiles_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_profiles"
ADD CONSTRAINT "staff_profiles_tenant_location_fkey"
FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_services"
ADD CONSTRAINT "staff_services_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_services"
ADD CONSTRAINT "staff_services_tenant_staff_fkey"
FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_services"
ADD CONSTRAINT "staff_services_tenant_service_fkey"
FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "weekly_availability_rules"
ADD CONSTRAINT "weekly_availability_rules_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_availability_rules"
ADD CONSTRAINT "weekly_availability_rules_tenant_staff_fkey"
FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "availability_exceptions"
ADD CONSTRAINT "availability_exceptions_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "availability_exceptions"
ADD CONSTRAINT "availability_exceptions_tenant_staff_fkey"
FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "entitlements" ("code", "value_type", "description", "updated_at")
VALUES (
    'MAX_STAFF',
    'INTEGER',
    'Maximum number of active staff profiles available to a tenant.',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "plan_entitlements" ("plan_id", "entitlement_code", "value_json")
SELECT "id", 'MAX_STAFF', '1'::jsonb
FROM "plans"
WHERE "is_default" = true
ON CONFLICT ("plan_id", "entitlement_code") DO NOTHING;

-- Existing merchant tenants receive one neutral staff profile without guessing working hours.
INSERT INTO "staff_profiles" (
    "id", "tenant_id", "location_id", "display_name", "booking_enabled", "sort_order", "updated_at"
)
SELECT
    gen_random_uuid(),
    profile."tenant_id",
    profile."primary_location_id",
    '主要服務人員',
    true,
    0,
    CURRENT_TIMESTAMP
FROM "merchant_profiles" AS profile
WHERE profile."primary_location_id" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "staff_profiles" AS existing
      WHERE existing."tenant_id" = profile."tenant_id"
  );

INSERT INTO "staff_services" ("tenant_id", "staff_id", "service_id")
SELECT staff."tenant_id", staff."id", service."id"
FROM "staff_profiles" AS staff
JOIN "services" AS service
  ON service."tenant_id" = staff."tenant_id"
 AND service."status" = 'ACTIVE'
ON CONFLICT ("tenant_id", "staff_id", "service_id") DO NOTHING;
