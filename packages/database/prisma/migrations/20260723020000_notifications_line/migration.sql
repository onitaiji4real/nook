-- Phase 3 expand migration: database-backed notification jobs and LINE recipient evidence.

CREATE TYPE "NotificationChannel" AS ENUM ('LINE_PUSH', 'LINE_SERVICE_MESSAGE');
CREATE TYPE "NotificationJobStatus" AS ENUM (
    'PENDING',
    'DISPATCHING',
    'ENQUEUED',
    'DELIVERING',
    'ACCEPTED',
    'CANCELLED',
    'SKIPPED',
    'DEAD_LETTER'
);
CREATE TYPE "NotificationDeliveryOutcome" AS ENUM (
    'STARTED',
    'ACCEPTED',
    'REPLAYED',
    'RETRYABLE',
    'TERMINAL',
    'AMBIGUOUS'
);
CREATE TYPE "LineMessagingRecipientStatus" AS ENUM ('FOLLOWING', 'BLOCKED');
CREATE TYPE "LineWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');
CREATE TYPE "NotificationProvider" AS ENUM ('LINE_MESSAGING');

CREATE UNIQUE INDEX "outbox_events_tenant_id_id_key"
    ON "outbox_events"("tenant_id", "id");

CREATE TABLE "notification_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "consumer_user_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "source_outbox_event_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template_key" VARCHAR(80) NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
    "dedupe_key" VARCHAR(255) NOT NULL,
    "provider_retry_key" UUID NOT NULL,
    "dispatch_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "delivery_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "dispatch_lease_until" TIMESTAMPTZ(6),
    "delivery_lease_until" TIMESTAMPTZ(6),
    "enqueued_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "terminal_code" VARCHAR(80),
    "budget_month" CHAR(7),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_jobs_template_check" CHECK (
        "template_key" IN (
            'appointment.confirmed.v1',
            'appointment.cancelled.v1',
            'appointment.rescheduled.v1',
            'appointment.reminder.24h.v1',
            'appointment.reminder.2h.v1'
        )
    ),
    CONSTRAINT "notification_jobs_dedupe_check" CHECK (
        "dedupe_key" ~ '^notification:appointment\.(confirmed|cancelled|rescheduled|reminder\.24h|reminder\.2h)\.v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    CONSTRAINT "notification_jobs_attempt_count_check" CHECK (
        "dispatch_attempt_count" >= 0
        AND "delivery_attempt_count" BETWEEN 0 AND 10
    ),
    CONSTRAINT "notification_jobs_dispatch_lease_check" CHECK (
        ("status" = 'DISPATCHING' AND "dispatch_lease_until" IS NOT NULL)
        OR ("status" <> 'DISPATCHING' AND "dispatch_lease_until" IS NULL)
    ),
    CONSTRAINT "notification_jobs_delivery_lease_check" CHECK (
        ("status" = 'DELIVERING' AND "delivery_lease_until" IS NOT NULL)
        OR ("status" <> 'DELIVERING' AND "delivery_lease_until" IS NULL)
    ),
    CONSTRAINT "notification_jobs_accepted_check" CHECK (
        ("status" = 'ACCEPTED' AND "accepted_at" IS NOT NULL)
        OR ("status" <> 'ACCEPTED' AND "accepted_at" IS NULL)
    ),
    CONSTRAINT "notification_jobs_terminal_code_check" CHECK (
        (
            "status" IN ('CANCELLED', 'SKIPPED', 'DEAD_LETTER')
            AND "terminal_code" ~ '^[a-z][a-z0-9_]{0,79}$'
        )
        OR (
            "status" NOT IN ('CANCELLED', 'SKIPPED', 'DEAD_LETTER')
            AND "terminal_code" IS NULL
        )
    ),
    CONSTRAINT "notification_jobs_budget_month_check" CHECK (
        "budget_month" IS NULL
        OR "budget_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    )
);

CREATE UNIQUE INDEX "notification_jobs_dedupe_key_key"
    ON "notification_jobs"("dedupe_key");
CREATE UNIQUE INDEX "notification_jobs_provider_retry_key_key"
    ON "notification_jobs"("provider_retry_key");
CREATE INDEX "notification_jobs_dispatch_idx"
    ON "notification_jobs"("status", "due_at", "id");
CREATE INDEX "notification_jobs_dispatch_lease_idx"
    ON "notification_jobs"("status", "dispatch_lease_until", "id");
CREATE INDEX "notification_jobs_delivery_lease_idx"
    ON "notification_jobs"("status", "delivery_lease_until", "id");
CREATE INDEX "notification_jobs_appointment_status_idx"
    ON "notification_jobs"("tenant_id", "appointment_id", "status");
CREATE INDEX "notification_jobs_source_event_idx"
    ON "notification_jobs"("source_outbox_event_id");

CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_job_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "outcome" "NotificationDeliveryOutcome" NOT NULL DEFAULT 'STARTED',
    "provider_http_status" INTEGER,
    "provider_request_id" VARCHAR(128),
    "code" VARCHAR(80),
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_deliveries_attempt_number_check"
        CHECK ("attempt_number" BETWEEN 1 AND 10),
    CONSTRAINT "notification_deliveries_http_status_check"
        CHECK ("provider_http_status" IS NULL OR "provider_http_status" BETWEEN 100 AND 599),
    CONSTRAINT "notification_deliveries_request_id_check" CHECK (
        "provider_request_id" IS NULL
        OR "provider_request_id" ~ '^[A-Za-z0-9._:-]{1,128}$'
    ),
    CONSTRAINT "notification_deliveries_code_check" CHECK (
        "code" IS NULL OR "code" ~ '^[a-z][a-z0-9_]{0,79}$'
    ),
    CONSTRAINT "notification_deliveries_completion_check" CHECK (
        (
            "outcome" = 'STARTED'
            AND "finished_at" IS NULL
            AND "provider_http_status" IS NULL
            AND "provider_request_id" IS NULL
            AND "code" IS NULL
        )
        OR (
            "outcome" <> 'STARTED'
            AND "finished_at" IS NOT NULL
            AND "code" IS NOT NULL
        )
    ),
    CONSTRAINT "notification_deliveries_accepted_status_check" CHECK (
        ("outcome" = 'ACCEPTED' AND "provider_http_status" = 200)
        OR ("outcome" = 'REPLAYED' AND "provider_http_status" = 409)
        OR "outcome" NOT IN ('ACCEPTED', 'REPLAYED')
    )
);

CREATE UNIQUE INDEX "notification_deliveries_job_attempt_key"
    ON "notification_deliveries"("notification_job_id", "attempt_number");
CREATE INDEX "notification_deliveries_outcome_started_idx"
    ON "notification_deliveries"("outcome", "started_at", "id");

CREATE TABLE "line_messaging_recipients" (
    "provider_subject" VARCHAR(33) NOT NULL,
    "user_id" UUID,
    "status" "LineMessagingRecipientStatus" NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "observed_webhook_event_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "line_messaging_recipients_pkey" PRIMARY KEY ("provider_subject"),
    CONSTRAINT "line_messaging_recipients_subject_check"
        CHECK ("provider_subject" ~ '^U[0-9a-f]{32}$'),
    CONSTRAINT "line_messaging_recipients_event_id_check"
        CHECK (LENGTH(BTRIM("observed_webhook_event_id")) BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX "line_messaging_recipients_user_id_key"
    ON "line_messaging_recipients"("user_id");
CREATE INDEX "line_messaging_recipients_status_observed_idx"
    ON "line_messaging_recipients"("status", "observed_at");

CREATE TABLE "line_webhook_events" (
    "id" UUID NOT NULL,
    "webhook_event_id" VARCHAR(128) NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" "LineWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "line_webhook_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "line_webhook_events_event_id_check"
        CHECK (LENGTH(BTRIM("webhook_event_id")) BETWEEN 1 AND 128),
    CONSTRAINT "line_webhook_events_event_type_check"
        CHECK ("event_type" ~ '^[A-Za-z][A-Za-z0-9._-]{0,39}$'),
    CONSTRAINT "line_webhook_events_source_type_check"
        CHECK ("source_type" IN ('user', 'group', 'room')),
    CONSTRAINT "line_webhook_events_processed_check" CHECK (
        ("status" = 'RECEIVED' AND "processed_at" IS NULL)
        OR ("status" <> 'RECEIVED' AND "processed_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "line_webhook_events_webhook_event_id_key"
    ON "line_webhook_events"("webhook_event_id");
CREATE INDEX "line_webhook_events_retention_idx"
    ON "line_webhook_events"("received_at", "id");
CREATE INDEX "line_webhook_events_status_idx"
    ON "line_webhook_events"("status", "received_at", "id");

CREATE TABLE "notification_provider_monthly_usage" (
    "provider" "NotificationProvider" NOT NULL,
    "usage_month" CHAR(7) NOT NULL,
    "reserved_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_provider_monthly_usage_pkey"
        PRIMARY KEY ("provider", "usage_month"),
    CONSTRAINT "notification_provider_monthly_usage_month_check"
        CHECK ("usage_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "notification_provider_monthly_usage_count_check"
        CHECK ("reserved_count" >= 0)
);

ALTER TABLE "notification_jobs"
    ADD CONSTRAINT "notification_jobs_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "notification_jobs_consumer_fkey"
        FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "notification_jobs_appointment_owner_fkey"
        FOREIGN KEY ("tenant_id", "consumer_user_id", "appointment_id")
        REFERENCES "appointments"("tenant_id", "consumer_user_id", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "notification_jobs_source_event_owner_fkey"
        FOREIGN KEY ("tenant_id", "source_outbox_event_id")
        REFERENCES "outbox_events"("tenant_id", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries"
    ADD CONSTRAINT "notification_deliveries_job_fkey"
        FOREIGN KEY ("notification_job_id") REFERENCES "notification_jobs"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "line_messaging_recipients"
    ADD CONSTRAINT "line_messaging_recipients_user_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "entitlements" (
    "code", "value_type", "description", "updated_at"
) VALUES (
    'APPOINTMENT_REMINDER_COUNT',
    'INTEGER',
    'Number of reminder jobs projected for each confirmed appointment (0..2).',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "entitlements"
        WHERE "code" = 'APPOINTMENT_REMINDER_COUNT'
          AND "value_type" = 'INTEGER'
    ) THEN
        RAISE EXCEPTION 'APPOINTMENT_REMINDER_COUNT must be an INTEGER entitlement';
    END IF;
END $$;

INSERT INTO "plan_entitlements" ("plan_id", "entitlement_code", "value_json")
SELECT "id", 'APPOINTMENT_REMINDER_COUNT', '1'::jsonb
FROM "plans"
ON CONFLICT ("plan_id", "entitlement_code") DO NOTHING;

ALTER TABLE "plan_entitlements"
    ADD CONSTRAINT "plan_entitlements_reminder_count_check" CHECK (
        "entitlement_code" <> 'APPOINTMENT_REMINDER_COUNT'
        OR (
            JSONB_TYPEOF("value_json") = 'number'
            AND ("value_json" #>> '{}') ~ '^[0-2]$'
        )
    ) NOT VALID;

ALTER TABLE "plan_entitlements"
    VALIDATE CONSTRAINT "plan_entitlements_reminder_count_check";
