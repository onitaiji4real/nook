CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "BookingHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'CONSUMED');
CREATE TYPE "BookingOccupancyStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED');

CREATE TABLE "booking_holds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "consumer_user_id" UUID NOT NULL,
    "status" "BookingHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "service_name_snapshot" VARCHAR(160) NOT NULL,
    "duration_minutes_snapshot" INTEGER NOT NULL,
    "price_type_snapshot" "ServicePriceType" NOT NULL,
    "price_amount_snapshot" INTEGER,
    "price_min_snapshot" INTEGER,
    "price_max_snapshot" INTEGER,
    "currency_snapshot" CHAR(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_holds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_holds_service_range_check" CHECK ("start_at" < "end_at"),
    CONSTRAINT "booking_holds_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "booking_holds_duration_check" CHECK ("duration_minutes_snapshot" BETWEEN 5 AND 720),
    CONSTRAINT "booking_holds_currency_check" CHECK ("currency_snapshot" ~ '^[A-Z]{3}$'),
    CONSTRAINT "booking_holds_price_check" CHECK (
      ("price_type_snapshot" = 'FIXED' AND "price_amount_snapshot" IS NOT NULL AND "price_amount_snapshot" >= 0 AND "price_min_snapshot" IS NULL AND "price_max_snapshot" IS NULL) OR
      ("price_type_snapshot" = 'FROM' AND "price_amount_snapshot" IS NOT NULL AND "price_amount_snapshot" >= 0 AND "price_min_snapshot" IS NULL AND "price_max_snapshot" IS NULL) OR
      ("price_type_snapshot" = 'RANGE' AND "price_amount_snapshot" IS NULL AND "price_min_snapshot" IS NOT NULL AND "price_max_snapshot" IS NOT NULL AND "price_min_snapshot" >= 0 AND "price_max_snapshot" >= "price_min_snapshot") OR
      ("price_type_snapshot" = 'QUOTE' AND "price_amount_snapshot" IS NULL AND "price_min_snapshot" IS NULL AND "price_max_snapshot" IS NULL)
    )
);

CREATE TABLE "booking_occupancies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "status" "BookingOccupancyStatus" NOT NULL DEFAULT 'ACTIVE',
    "occupied_start_at" TIMESTAMPTZ(6) NOT NULL,
    "occupied_end_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_occupancies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_occupancies_range_check" CHECK ("occupied_start_at" < "occupied_end_at")
);

CREATE TABLE "booking_hold_rate_attempts" (
    "consumer_user_id" UUID NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_hold_rate_attempts_pkey" PRIMARY KEY ("consumer_user_id", "window_start", "key_hash"),
    CONSTRAINT "booking_hold_rate_attempts_expiry_check" CHECK ("expires_at" > "window_start")
);

CREATE UNIQUE INDEX "booking_holds_tenant_id_id_key" ON "booking_holds"("tenant_id", "id");
CREATE UNIQUE INDEX "booking_holds_consumer_idempotency_key" ON "booking_holds"("consumer_user_id", "idempotency_key_hash");
CREATE INDEX "booking_holds_staff_status_expiry_idx" ON "booking_holds"("tenant_id", "staff_id", "status", "expires_at");
CREATE INDEX "booking_holds_consumer_status_expiry_idx" ON "booking_holds"("tenant_id", "consumer_user_id", "status", "expires_at");

CREATE UNIQUE INDEX "booking_occupancies_hold_id_key" ON "booking_occupancies"("hold_id");
CREATE UNIQUE INDEX "booking_occupancies_tenant_id_id_key" ON "booking_occupancies"("tenant_id", "id");
CREATE UNIQUE INDEX "booking_occupancies_tenant_hold_key" ON "booking_occupancies"("tenant_id", "hold_id");
CREATE INDEX "booking_occupancies_staff_range_idx" ON "booking_occupancies"("tenant_id", "staff_id", "status", "occupied_start_at", "occupied_end_at");
CREATE INDEX "booking_hold_rate_attempts_expiry_idx" ON "booking_hold_rate_attempts"("expires_at");

ALTER TABLE "booking_holds"
  ADD CONSTRAINT "booking_holds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_holds_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_holds_service_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_holds_staff_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_holds_consumer_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "booking_occupancies"
  ADD CONSTRAINT "booking_occupancies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_occupancies_staff_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_occupancies_hold_fkey" FOREIGN KEY ("tenant_id", "hold_id") REFERENCES "booking_holds"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_hold_rate_attempts"
  ADD CONSTRAINT "booking_hold_rate_attempts_consumer_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_occupancies"
  ADD CONSTRAINT "booking_occupancies_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "staff_id" WITH =,
    tstzrange("occupied_start_at", "occupied_end_at", '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');
