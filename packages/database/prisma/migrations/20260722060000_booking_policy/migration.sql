CREATE TABLE "booking_policies" (
    "tenant_id" UUID NOT NULL,
    "slot_interval_minutes" INTEGER NOT NULL DEFAULT 15,
    "minimum_lead_minutes" INTEGER NOT NULL DEFAULT 120,
    "maximum_advance_days" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "booking_policies_slot_interval_check"
        CHECK ("slot_interval_minutes" IN (5, 10, 15, 20, 30, 60)),
    CONSTRAINT "booking_policies_minimum_lead_check"
        CHECK ("minimum_lead_minutes" BETWEEN 0 AND 10080),
    CONSTRAINT "booking_policies_maximum_advance_check"
        CHECK ("maximum_advance_days" BETWEEN 1 AND 365),
    CONSTRAINT "booking_policies_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "booking_policies" ("tenant_id")
SELECT "id"
FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;
