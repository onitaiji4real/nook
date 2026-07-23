-- Phase 2 expand migration: generic plan entitlements and ordered service catalog.
CREATE TYPE "PlanBillingPeriod" AS ENUM ('NONE', 'MONTHLY', 'YEARLY');
CREATE TYPE "EntitlementValueType" AS ENUM ('INTEGER', 'BOOLEAN');

CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "billing_period" "PlanBillingPeriod" NOT NULL,
    "price_amount" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plans_price_amount_check" CHECK ("price_amount" >= 0)
);

CREATE TABLE "entitlements" (
    "code" VARCHAR(80) NOT NULL,
    "value_type" "EntitlementValueType" NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "entitlements_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,79}$')
);

CREATE TABLE "plan_entitlements" (
    "plan_id" UUID NOT NULL,
    "entitlement_code" VARCHAR(80) NOT NULL,
    "value_json" JSONB NOT NULL,

    CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("plan_id", "entitlement_code")
);

CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");
CREATE UNIQUE INDEX "plans_single_default_key" ON "plans"("is_default") WHERE "is_default" = true;

INSERT INTO "plans" (
    "id", "code", "name", "billing_period", "price_amount", "is_default", "updated_at"
) VALUES (
    '00000000-0000-4000-8000-000000000100',
    'FREE_EXPOSURE',
    '免費曝光版',
    'NONE',
    0,
    true,
    CURRENT_TIMESTAMP
);

INSERT INTO "entitlements" (
    "code", "value_type", "description", "updated_at"
) VALUES (
    'MAX_SERVICES',
    'INTEGER',
    'Maximum number of active services in the merchant catalog.',
    CURRENT_TIMESTAMP
);

INSERT INTO "plan_entitlements" ("plan_id", "entitlement_code", "value_json")
VALUES ('00000000-0000-4000-8000-000000000100', 'MAX_SERVICES', '5'::jsonb);

UPDATE "tenants"
SET "plan_id" = '00000000-0000-4000-8000-000000000100'
WHERE "plan_id" IS NULL;

ALTER TABLE "services"
ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

WITH ranked_services AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "tenant_id"
            ORDER BY "created_at", "id"
        ) - 1 AS "position"
    FROM "services"
)
UPDATE "services"
SET "sort_order" = ranked_services."position"
FROM ranked_services
WHERE "services"."id" = ranked_services."id";

CREATE INDEX "services_tenant_sort_idx" ON "services"("tenant_id", "sort_order", "id");

ALTER TABLE "plan_entitlements"
ADD CONSTRAINT "plan_entitlements_plan_id_fkey"
FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plan_entitlements"
ADD CONSTRAINT "plan_entitlements_entitlement_code_fkey"
FOREIGN KEY ("entitlement_code") REFERENCES "entitlements"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NOT VALID preserves expand compatibility if an older environment contains an unknown legacy plan_id.
-- New and updated rows are still checked; a later contract migration may validate after audit/remediation.
ALTER TABLE "tenants"
ADD CONSTRAINT "tenants_plan_id_fkey"
FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
