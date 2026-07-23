-- Phase 3 expand migration: no-deposit appointment confirmation and shared occupancy ownership.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "merchant_profiles" AS profile
    JOIN "locations" AS location
      ON location."tenant_id" = profile."tenant_id"
     AND location."id" = profile."primary_location_id"
    WHERE NULLIF(BTRIM(location."timezone"), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_timezone_names AS timezone
        WHERE timezone.name = location."timezone"
      )
  ) THEN
    RAISE EXCEPTION 'Cannot backfill tenant usage timezone from an invalid IANA location timezone';
  END IF;
END $$;

ALTER TABLE "tenants"
  ADD COLUMN "usage_timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Taipei';

UPDATE "tenants" AS tenant
SET "usage_timezone" = COALESCE(
  (
    SELECT NULLIF(BTRIM(location."timezone"), '')
    FROM "merchant_profiles" AS profile
    JOIN "locations" AS location
      ON location."tenant_id" = profile."tenant_id"
     AND location."id" = profile."primary_location_id"
    WHERE profile."tenant_id" = tenant."id"
  ),
  'Asia/Taipei'
);

CREATE TYPE "AppointmentStatus" AS ENUM (
  'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'
);
CREATE TYPE "AppointmentSource" AS ENUM (
  'MERCHANT_LINK', 'MARKETPLACE', 'ADMIN', 'STAFF', 'IMPORT'
);
CREATE TYPE "AppointmentPricingStatus" AS ENUM ('EXACT', 'ESTIMATE', 'QUOTE_REQUIRED');
CREATE TYPE "AppointmentPaymentStatus" AS ENUM ('NOT_REQUIRED');
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

ALTER TABLE "booking_holds"
  ADD COLUMN "source" "AppointmentSource" NOT NULL DEFAULT 'MERCHANT_LINK',
  ADD COLUMN "booking_policy_snapshot" VARCHAR(2000),
  ADD COLUMN "cancellation_policy_snapshot" VARCHAR(2000),
  ADD COLUMN "policy_version" VARCHAR(67),
  ADD COLUMN "location_name_snapshot" VARCHAR(120),
  ADD COLUMN "address_text_snapshot" VARCHAR(500),
  ADD COLUMN "postal_code_snapshot" VARCHAR(10),
  ADD COLUMN "city_snapshot" VARCHAR(80),
  ADD COLUMN "district_snapshot" VARCHAR(80),
  ADD COLUMN "location_timezone_snapshot" VARCHAR(64);

CREATE UNIQUE INDEX "booking_holds_tenant_staff_id_key"
  ON "booking_holds"("tenant_id", "staff_id", "id");
CREATE UNIQUE INDEX "booking_holds_tenant_consumer_id_key"
  ON "booking_holds"("tenant_id", "consumer_user_id", "id");

CREATE TABLE "appointments" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "staff_id" UUID NOT NULL,
  "consumer_user_id" UUID NOT NULL,
  "hold_id" UUID NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
  "source" "AppointmentSource" NOT NULL,
  "pricing_status" "AppointmentPricingStatus" NOT NULL,
  "payment_status" "AppointmentPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "start_at" TIMESTAMPTZ(6) NOT NULL,
  "end_at" TIMESTAMPTZ(6) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(6) NOT NULL,
  "usage_timezone_snapshot" VARCHAR(64) NOT NULL,
  "usage_month" CHAR(7) NOT NULL,
  "location_timezone_snapshot" VARCHAR(64) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "subtotal_amount" INTEGER,
  "deposit_amount" INTEGER NOT NULL DEFAULT 0,
  "total_amount" INTEGER,
  "booking_policy_snapshot" VARCHAR(2000) NOT NULL,
  "cancellation_policy_snapshot" VARCHAR(2000) NOT NULL,
  "policy_version" VARCHAR(67) NOT NULL,
  "policies_accepted_at" TIMESTAMPTZ(6) NOT NULL,
  "location_name_snapshot" VARCHAR(120) NOT NULL,
  "address_text_snapshot" VARCHAR(500) NOT NULL,
  "postal_code_snapshot" VARCHAR(10),
  "city_snapshot" VARCHAR(80) NOT NULL,
  "district_snapshot" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointments_service_range_check" CHECK ("start_at" < "end_at"),
  CONSTRAINT "appointments_usage_month_check" CHECK ("usage_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "appointments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "appointments_policy_check" CHECK (
    LENGTH(BTRIM("booking_policy_snapshot")) > 0
    AND LENGTH(BTRIM("cancellation_policy_snapshot")) > 0
    AND "policy_version" ~ '^v1:[0-9a-f]{64}$'
    AND "policies_accepted_at" = "confirmed_at"
  ),
  CONSTRAINT "appointments_no_deposit_check" CHECK (
    "payment_status" = 'NOT_REQUIRED' AND "deposit_amount" = 0
  ),
  CONSTRAINT "appointments_pricing_check" CHECK (
    (
      "pricing_status" = 'EXACT'
      AND "subtotal_amount" IS NOT NULL
      AND "subtotal_amount" >= 0
      AND "total_amount" = "subtotal_amount"
    ) OR (
      "pricing_status" IN ('ESTIMATE', 'QUOTE_REQUIRED')
      AND "subtotal_amount" IS NULL
      AND "total_amount" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "appointments_hold_id_key" ON "appointments"("hold_id");
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");
CREATE UNIQUE INDEX "appointments_tenant_staff_id_key"
  ON "appointments"("tenant_id", "staff_id", "id");
CREATE UNIQUE INDEX "appointments_tenant_consumer_id_key"
  ON "appointments"("tenant_id", "consumer_user_id", "id");
CREATE INDEX "appointments_tenant_usage_month_source_idx"
  ON "appointments"("tenant_id", "usage_month", "source");
CREATE INDEX "appointments_consumer_confirmed_idx"
  ON "appointments"("consumer_user_id", "confirmed_at", "id");

CREATE TABLE "appointment_items" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "service_id" UUID NOT NULL,
  "service_name_snapshot" VARCHAR(160) NOT NULL,
  "duration_minutes_snapshot" INTEGER NOT NULL,
  "price_type_snapshot" "ServicePriceType" NOT NULL,
  "price_amount_snapshot" INTEGER,
  "price_min_snapshot" INTEGER,
  "price_max_snapshot" INTEGER,
  "currency_snapshot" CHAR(3) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "appointment_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_items_duration_check" CHECK ("duration_minutes_snapshot" BETWEEN 5 AND 720),
  CONSTRAINT "appointment_items_currency_check" CHECK ("currency_snapshot" ~ '^[A-Z]{3}$'),
  CONSTRAINT "appointment_items_price_check" CHECK (
    ("price_type_snapshot" = 'FIXED' AND "price_amount_snapshot" IS NOT NULL AND "price_amount_snapshot" >= 0 AND "price_min_snapshot" IS NULL AND "price_max_snapshot" IS NULL) OR
    ("price_type_snapshot" = 'FROM' AND "price_amount_snapshot" IS NOT NULL AND "price_amount_snapshot" >= 0 AND "price_min_snapshot" IS NULL AND "price_max_snapshot" IS NULL) OR
    ("price_type_snapshot" = 'RANGE' AND "price_amount_snapshot" IS NULL AND "price_min_snapshot" IS NOT NULL AND "price_max_snapshot" IS NOT NULL AND "price_min_snapshot" >= 0 AND "price_max_snapshot" >= "price_min_snapshot") OR
    ("price_type_snapshot" = 'QUOTE' AND "price_amount_snapshot" IS NULL AND "price_min_snapshot" IS NULL AND "price_max_snapshot" IS NULL)
  )
);

CREATE UNIQUE INDEX "appointment_items_appointment_id_key"
  ON "appointment_items"("appointment_id");
CREATE UNIQUE INDEX "appointment_items_tenant_id_id_key"
  ON "appointment_items"("tenant_id", "id");
CREATE INDEX "appointment_items_tenant_service_idx"
  ON "appointment_items"("tenant_id", "service_id");

CREATE TABLE "appointment_status_history" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "from_status" "AppointmentStatus",
  "to_status" "AppointmentStatus" NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "appointment_status_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointment_status_history_tenant_id_id_key"
  ON "appointment_status_history"("tenant_id", "id");
CREATE INDEX "appointment_status_history_appointment_idx"
  ON "appointment_status_history"("tenant_id", "appointment_id", "created_at");

CREATE TABLE "appointment_confirmation_keys" (
  "consumer_user_id" UUID NOT NULL,
  "key_hash" CHAR(64) NOT NULL,
  "tenant_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "appointment_confirmation_keys_pkey" PRIMARY KEY ("consumer_user_id", "key_hash"),
  CONSTRAINT "appointment_confirmation_keys_hash_check" CHECK (
    "key_hash" ~ '^[0-9a-f]{64}$' AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX "appointment_confirmation_keys_appointment_idx"
  ON "appointment_confirmation_keys"("tenant_id", "appointment_id");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "aggregate_type" VARCHAR(80) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "payload_json" JSONB NOT NULL,
  "dedupe_key" VARCHAR(255) NOT NULL,
  "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "available_at" TIMESTAMPTZ(6) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "published_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_attempt_count_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "outbox_events_type_check" CHECK (
    LENGTH(BTRIM("aggregate_type")) > 0 AND LENGTH(BTRIM("event_type")) > 0
  )
);

CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");
CREATE INDEX "outbox_events_dispatch_idx" ON "outbox_events"("status", "available_at", "id");
CREATE INDEX "outbox_events_tenant_created_idx" ON "outbox_events"("tenant_id", "created_at");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointments_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointments_staff_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointments_consumer_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointments_owned_hold_fkey" FOREIGN KEY ("tenant_id", "consumer_user_id", "hold_id") REFERENCES "booking_holds"("tenant_id", "consumer_user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_items"
  ADD CONSTRAINT "appointment_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_items_appointment_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_items_service_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_status_history"
  ADD CONSTRAINT "appointment_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_status_history_appointment_fkey" FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_status_history_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_confirmation_keys"
  ADD CONSTRAINT "appointment_confirmation_keys_consumer_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_confirmation_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_confirmation_keys_owned_appointment_fkey" FOREIGN KEY ("tenant_id", "consumer_user_id", "appointment_id") REFERENCES "appointments"("tenant_id", "consumer_user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "booking_occupancies"
  DROP CONSTRAINT "booking_occupancies_hold_fkey",
  ALTER COLUMN "hold_id" DROP NOT NULL,
  ADD COLUMN "appointment_id" UUID,
  ADD CONSTRAINT "booking_occupancies_owner_check" CHECK (
    ("hold_id" IS NOT NULL AND "appointment_id" IS NULL) OR
    ("hold_id" IS NULL AND "appointment_id" IS NOT NULL)
  );

DROP INDEX "booking_occupancies_tenant_hold_key";
CREATE UNIQUE INDEX "booking_occupancies_appointment_id_key"
  ON "booking_occupancies"("appointment_id");

ALTER TABLE "booking_occupancies"
  ADD CONSTRAINT "booking_occupancies_hold_fkey" FOREIGN KEY ("tenant_id", "staff_id", "hold_id") REFERENCES "booking_holds"("tenant_id", "staff_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_occupancies_appointment_fkey" FOREIGN KEY ("tenant_id", "staff_id", "appointment_id") REFERENCES "appointments"("tenant_id", "staff_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "entitlements" ("code", "value_type", "description", "updated_at")
VALUES (
  'MAX_MONTHLY_BOOKINGS',
  'INTEGER',
  'Maximum confirmed consumer online appointments per tenant usage month; zero means unlimited.',
  CURRENT_TIMESTAMP
);

INSERT INTO "plan_entitlements" ("plan_id", "entitlement_code", "value_json")
SELECT "id", 'MAX_MONTHLY_BOOKINGS', '20'::jsonb
FROM "plans"
WHERE "is_default" = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'plans_single_default_key'
  ) THEN
    RAISE EXCEPTION 'plans_single_default_key is required for effective entitlement resolution';
  END IF;

  IF (SELECT COUNT(*) FROM "plans" WHERE "is_default" = true) <> 1 THEN
    RAISE EXCEPTION 'Exactly one default plan is required for effective entitlement resolution';
  END IF;
END $$;
