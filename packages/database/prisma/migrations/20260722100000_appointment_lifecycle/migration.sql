CREATE TYPE "AppointmentReasonCode" AS ENUM (
    'CONSUMER_CHANGE_OF_PLANS',
    'CONSUMER_SCHEDULE_CONFLICT',
    'CONSUMER_BOOKED_ELSEWHERE',
    'CONSUMER_OTHER',
    'MERCHANT_CUSTOMER_REQUEST',
    'MERCHANT_STAFF_UNAVAILABLE',
    'MERCHANT_BUSINESS_CLOSURE',
    'MERCHANT_DUPLICATE',
    'MERCHANT_OTHER',
    'RESCHEDULE_SCHEDULE_CONFLICT',
    'RESCHEDULE_PREFERENCE_CHANGE',
    'RESCHEDULE_OTHER'
);

CREATE TYPE "AppointmentTransitionAction" AS ENUM (
    'CONSUMER_CANCEL',
    'CONSUMER_RESCHEDULE',
    'MERCHANT_CANCEL',
    'MERCHANT_CHECK_IN',
    'MERCHANT_COMPLETE',
    'MERCHANT_NO_SHOW'
);

ALTER TABLE "booking_policies"
    ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "consumer_cancel_lead_minutes" INTEGER NOT NULL DEFAULT 1440,
    ADD COLUMN "consumer_reschedule_lead_minutes" INTEGER NOT NULL DEFAULT 1440,
    ADD CONSTRAINT "booking_policies_revision_check" CHECK ("revision" >= 1),
    ADD CONSTRAINT "booking_policies_consumer_cancel_lead_check"
        CHECK ("consumer_cancel_lead_minutes" BETWEEN 0 AND 43200),
    ADD CONSTRAINT "booking_policies_consumer_reschedule_lead_check"
        CHECK ("consumer_reschedule_lead_minutes" BETWEEN 0 AND 43200);

INSERT INTO "booking_policies" (
    "tenant_id",
    "slot_interval_minutes",
    "minimum_lead_minutes",
    "maximum_advance_days",
    "consumer_cancel_lead_minutes",
    "consumer_reschedule_lead_minutes",
    "revision"
)
SELECT "id", 15, 120, 60, 1440, 1440, 1
FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;

ALTER TABLE "booking_holds"
    ADD COLUMN "consumer_cancel_lead_minutes_snapshot" INTEGER NOT NULL DEFAULT 1440,
    ADD COLUMN "consumer_reschedule_lead_minutes_snapshot" INTEGER NOT NULL DEFAULT 1440,
    ADD CONSTRAINT "booking_holds_consumer_cancel_lead_check"
        CHECK ("consumer_cancel_lead_minutes_snapshot" BETWEEN 0 AND 43200),
    ADD CONSTRAINT "booking_holds_consumer_reschedule_lead_check"
        CHECK ("consumer_reschedule_lead_minutes_snapshot" BETWEEN 0 AND 43200);

ALTER TABLE "appointments"
    ADD COLUMN "consumer_cancel_lead_minutes_snapshot" INTEGER NOT NULL DEFAULT 1440,
    ADD COLUMN "consumer_reschedule_lead_minutes_snapshot" INTEGER NOT NULL DEFAULT 1440,
    ADD COLUMN "rescheduled_from_id" UUID,
    ADD COLUMN "reschedule_root_id" UUID,
    ADD CONSTRAINT "appointments_consumer_cancel_lead_check"
        CHECK ("consumer_cancel_lead_minutes_snapshot" BETWEEN 0 AND 43200),
    ADD CONSTRAINT "appointments_consumer_reschedule_lead_check"
        CHECK ("consumer_reschedule_lead_minutes_snapshot" BETWEEN 0 AND 43200),
    ADD CONSTRAINT "appointments_reschedule_link_pair_check" CHECK (
        ("rescheduled_from_id" IS NULL AND "reschedule_root_id" IS NULL)
        OR
        ("rescheduled_from_id" IS NOT NULL AND "reschedule_root_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "appointments_rescheduled_from_not_self_check"
        CHECK ("rescheduled_from_id" IS NULL OR "rescheduled_from_id" <> "id"),
    ADD CONSTRAINT "appointments_reschedule_root_not_self_check"
        CHECK ("reschedule_root_id" IS NULL OR "reschedule_root_id" <> "id");

CREATE UNIQUE INDEX "appointments_rescheduled_from_id_key"
    ON "appointments"("rescheduled_from_id");

CREATE UNIQUE INDEX "appointments_tenant_consumer_rescheduled_from_key"
    ON "appointments"("tenant_id", "consumer_user_id", "rescheduled_from_id");

CREATE INDEX "appointments_tenant_consumer_reschedule_root_idx"
    ON "appointments"("tenant_id", "consumer_user_id", "reschedule_root_id");

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_rescheduled_from_owner_fkey"
        FOREIGN KEY ("tenant_id", "consumer_user_id", "rescheduled_from_id")
        REFERENCES "appointments"("tenant_id", "consumer_user_id", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "appointments_reschedule_root_owner_fkey"
        FOREIGN KEY ("tenant_id", "consumer_user_id", "reschedule_root_id")
        REFERENCES "appointments"("tenant_id", "consumer_user_id", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_status_history"
    ADD COLUMN "reason_code" "AppointmentReasonCode",
    ADD CONSTRAINT "appointment_status_history_reason_code_check" CHECK (
        (
            "to_status" IN ('CANCELLED'::"AppointmentStatus", 'RESCHEDULED'::"AppointmentStatus")
            AND "reason_code" IS NOT NULL
        )
        OR
        (
            "to_status" NOT IN ('CANCELLED'::"AppointmentStatus", 'RESCHEDULED'::"AppointmentStatus")
            AND "reason_code" IS NULL
        )
    ) NOT VALID;

CREATE TABLE "appointment_transition_keys" (
    "actor_user_id" UUID NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_appointment_id" UUID NOT NULL,
    "action" "AppointmentTransitionAction" NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "result_status" "AppointmentStatus" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "replacement_appointment_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointment_transition_keys_pkey"
        PRIMARY KEY ("actor_user_id", "key_hash"),
    CONSTRAINT "appointment_transition_keys_key_hash_check"
        CHECK ("key_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "appointment_transition_keys_request_fingerprint_check"
        CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "appointment_transition_keys_result_check" CHECK (
        ("action" IN ('CONSUMER_CANCEL'::"AppointmentTransitionAction", 'MERCHANT_CANCEL'::"AppointmentTransitionAction")
            AND "result_status" = 'CANCELLED'::"AppointmentStatus"
            AND "replacement_appointment_id" IS NULL)
        OR ("action" = 'CONSUMER_RESCHEDULE'::"AppointmentTransitionAction"
            AND "result_status" = 'RESCHEDULED'::"AppointmentStatus"
            AND "replacement_appointment_id" IS NOT NULL)
        OR ("action" = 'MERCHANT_CHECK_IN'::"AppointmentTransitionAction"
            AND "result_status" = 'CHECKED_IN'::"AppointmentStatus"
            AND "replacement_appointment_id" IS NULL)
        OR ("action" = 'MERCHANT_COMPLETE'::"AppointmentTransitionAction"
            AND "result_status" = 'COMPLETED'::"AppointmentStatus"
            AND "replacement_appointment_id" IS NULL)
        OR ("action" = 'MERCHANT_NO_SHOW'::"AppointmentTransitionAction"
            AND "result_status" = 'NO_SHOW'::"AppointmentStatus"
            AND "replacement_appointment_id" IS NULL)
    ),
    CONSTRAINT "appointment_transition_keys_actor_fkey"
        FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointment_transition_keys_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointment_transition_keys_source_fkey"
        FOREIGN KEY ("tenant_id", "source_appointment_id")
        REFERENCES "appointments"("tenant_id", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointment_transition_keys_replacement_fkey"
        FOREIGN KEY ("tenant_id", "replacement_appointment_id")
        REFERENCES "appointments"("tenant_id", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "appointment_transition_keys_source_idx"
    ON "appointment_transition_keys"("tenant_id", "source_appointment_id");

CREATE INDEX "appointment_transition_keys_replacement_idx"
    ON "appointment_transition_keys"("tenant_id", "replacement_appointment_id");
