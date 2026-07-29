-- CreateEnum
CREATE TYPE "CrmProjectionDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROJECTED', 'TERMINAL');

-- CreateEnum
CREATE TYPE "CrmProjectionOutcome" AS ENUM ('PROJECTED', 'NO_RELATIONSHIP', 'INVARIANT_CORRUPTION');

-- CreateEnum
CREATE TYPE "CrmProjectionStreamStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CrmBackfillStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('MARKETING_MESSAGES');

-- CreateEnum
CREATE TYPE "ConsentDocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ConsentEventType" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('CONSUMER_WEB', 'SUPPORT_VERIFIED_REQUEST');

-- CreateEnum
CREATE TYPE "ConsentCommandType" AS ENUM ('GRANT', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "ConsentCommandOutcome" AS ENUM ('APPLIED', 'NOOP_ALREADY_WITHDRAWN');

-- CreateEnum
CREATE TYPE "CustomerTagStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CustomerExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "consumer_user_id" UUID NOT NULL,
    "relationship_started_at" TIMESTAMPTZ(6) NOT NULL,
    "first_visit_at" TIMESTAMPTZ(6),
    "last_visit_at" TIMESTAMPTZ(6),
    "completed_visit_count" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "projection_version" INTEGER NOT NULL DEFAULT 1,
    "projected_through_event_id" UUID,
    "projected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_projection_deliveries" (
    "id" UUID NOT NULL,
    "projector" VARCHAR(80) NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "consumer_user_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "CrmProjectionDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "claim_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "CrmProjectionOutcome",
    "projected_at" TIMESTAMPTZ(6),
    "safe_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_projection_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_projection_streams" (
    "projector" VARCHAR(80) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "consumer_user_id" UUID NOT NULL,
    "status" "CrmProjectionStreamStatus" NOT NULL DEFAULT 'ACTIVE',
    "blocked_delivery_id" UUID,
    "safe_code" VARCHAR(80),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_projection_streams_pkey" PRIMARY KEY ("projector","tenant_id","consumer_user_id")
);

-- CreateTable
CREATE TABLE "crm_backfill_checkpoints" (
    "projector" VARCHAR(80) NOT NULL,
    "cursor_created_at" TIMESTAMPTZ(6),
    "cursor_id" UUID,
    "status" "CrmBackfillStatus" NOT NULL DEFAULT 'PENDING',
    "safe_code" VARCHAR(80),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_backfill_checkpoints_pkey" PRIMARY KEY ("projector")
);

-- CreateTable
CREATE TABLE "consent_documents" (
    "id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "content_text" TEXT NOT NULL,
    "status" "ConsentDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "document_generation" BIGINT NOT NULL,
    "active_from" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_consent_streams" (
    "tenant_id" UUID NOT NULL,
    "consumer_user_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "current_revision" INTEGER NOT NULL DEFAULT 0,
    "current_event_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consumer_consent_streams_pkey" PRIMARY KEY ("tenant_id","consumer_user_id","purpose")
);

-- CreateTable
CREATE TABLE "consumer_consent_commands" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "consumer_user_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "command_type" "ConsentCommandType" NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "result_revision" INTEGER NOT NULL,
    "outcome" "ConsentCommandOutcome" NOT NULL,
    "request_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consumer_consent_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_consent_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "consumer_user_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "revision" INTEGER NOT NULL,
    "event_type" "ConsentEventType" NOT NULL,
    "consent_document_id" UUID NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "tenant_display_name_snapshot" VARCHAR(120),
    "rendered_evidence_schema" VARCHAR(64),
    "rendered_evidence_sha256" CHAR(64),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "request_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consumer_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_crm_privacy_versions" (
    "tenant_id" UUID NOT NULL,
    "consent_watermark" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_crm_privacy_versions_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "wrapped_dek" BYTEA NOT NULL,
    "kek_resource_version" VARCHAR(512) NOT NULL,
    "encryption_schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tag_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "normalized_name" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(32) NOT NULL,
    "status" "CustomerTagStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_tag_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tag_links" (
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_tag_links_pkey" PRIMARY KEY ("tenant_id","customer_id","tag_id")
);

-- CreateTable
CREATE TABLE "customer_export_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by_membership_id" UUID NOT NULL,
    "status" "CustomerExportStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "format_version" VARCHAR(32) NOT NULL DEFAULT 'crm-export-v1',
    "as_of" TIMESTAMPTZ(6),
    "consent_watermark" BIGINT,
    "document_generation" BIGINT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claim_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "customer_count" INTEGER,
    "note_count" INTEGER,
    "tag_link_count" INTEGER,
    "uncompressed_bytes" BIGINT,
    "compressed_bytes" BIGINT,
    "object_key" VARCHAR(1024),
    "object_generation" BIGINT,
    "artifact_sha256" CHAR(64),
    "expires_at" TIMESTAMPTZ(6),
    "ready_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "safe_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenant_cursor_idx" ON "customers"("tenant_id", "created_at", "relationship_started_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_consumer_key" ON "customers"("tenant_id", "consumer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "crm_projection_deliveries_claim_idx" ON "crm_projection_deliveries"("projector", "status", "next_attempt_at", "id");

-- CreateIndex
CREATE INDEX "crm_projection_deliveries_stream_idx" ON "crm_projection_deliveries"("tenant_id", "consumer_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_projection_deliveries_projector_event_key" ON "crm_projection_deliveries"("projector", "outbox_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_projection_streams_blocked_delivery_id_key" ON "crm_projection_streams"("blocked_delivery_id");

-- CreateIndex
CREATE INDEX "crm_projection_streams_status_idx" ON "crm_projection_streams"("projector", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "consent_documents_purpose_version_key" ON "consent_documents"("purpose", "version");

-- CreateIndex
CREATE UNIQUE INDEX "consent_documents_generation_key" ON "consent_documents"("document_generation");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_consent_streams_current_event_id_key" ON "consumer_consent_streams"("current_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_consent_commands_stream_key" ON "consumer_consent_commands"("tenant_id", "consumer_user_id", "purpose", "idempotency_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_consent_events_command_id_key" ON "consumer_consent_events"("command_id");

-- CreateIndex
CREATE INDEX "consumer_consent_events_current_idx" ON "consumer_consent_events"("tenant_id", "consumer_user_id", "purpose", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_consent_events_stream_revision_key" ON "consumer_consent_events"("tenant_id", "consumer_user_id", "purpose", "revision");

-- CreateIndex
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes"("tenant_id", "customer_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_notes_tenant_id_id_key" ON "customer_notes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tag_definitions_tenant_id_id_key" ON "customer_tag_definitions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tag_definitions_tenant_name_key" ON "customer_tag_definitions"("tenant_id", "normalized_name");

-- CreateIndex
CREATE INDEX "customer_tag_links_tag_idx" ON "customer_tag_links"("tenant_id", "tag_id");

-- CreateIndex
CREATE INDEX "customer_export_jobs_claim_idx" ON "customer_export_jobs"("status", "lease_expires_at", "created_at", "id");

-- CreateIndex
CREATE INDEX "customer_export_jobs_expiry_idx" ON "customer_export_jobs"("status", "expires_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_export_jobs_tenant_id_id_key" ON "customer_export_jobs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_export_jobs_idempotency_key" ON "customer_export_jobs"("tenant_id", "requested_by_membership_id", "idempotency_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_id_key" ON "memberships"("tenant_id", "id");

-- Domain checks and partial uniqueness
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_counts_check"
    CHECK ("completed_visit_count" >= 0 AND "no_show_count" >= 0),
  ADD CONSTRAINT "customers_projection_version_check"
    CHECK ("projection_version" > 0),
  ADD CONSTRAINT "customers_visit_range_check"
    CHECK ("first_visit_at" IS NULL OR ("last_visit_at" IS NOT NULL AND "first_visit_at" <= "last_visit_at"));

ALTER TABLE "crm_projection_deliveries"
  ADD CONSTRAINT "crm_projection_deliveries_attempt_check"
    CHECK ("attempt_count" >= 0 AND "attempt_count" <= 10),
  ADD CONSTRAINT "crm_projection_deliveries_state_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "outcome" IS NULL
        AND "projected_at" IS NULL
      )
      OR (
        "status" = 'PROCESSING'
        AND "claim_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "outcome" IS NULL
        AND "projected_at" IS NULL
      )
      OR (
        "status" = 'PROJECTED'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "outcome" IN ('PROJECTED', 'NO_RELATIONSHIP')
        AND "projected_at" IS NOT NULL
      )
      OR (
        "status" = 'TERMINAL'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "outcome" = 'INVARIANT_CORRUPTION'
        AND "projected_at" IS NOT NULL
        AND "safe_code" IS NOT NULL
      )
    );

ALTER TABLE "crm_projection_streams"
  ADD CONSTRAINT "crm_projection_streams_state_check"
    CHECK (
      (
        "status" = 'ACTIVE'
        AND "blocked_delivery_id" IS NULL
        AND "safe_code" IS NULL
      )
      OR (
        "status" = 'BLOCKED'
        AND "blocked_delivery_id" IS NOT NULL
        AND "safe_code" IS NOT NULL
      )
    );

ALTER TABLE "crm_backfill_checkpoints"
  ADD CONSTRAINT "crm_backfill_checkpoints_cursor_check"
    CHECK (("cursor_created_at" IS NULL) = ("cursor_id" IS NULL));

ALTER TABLE "consent_documents"
  ADD CONSTRAINT "consent_documents_generation_check"
    CHECK ("document_generation" > 0),
  ADD CONSTRAINT "consent_documents_hash_check"
    CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "consent_documents_locale_check"
    CHECK ("locale" = 'zh-TW'),
  ADD CONSTRAINT "consent_documents_lifecycle_check"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "active_from" IS NULL
        AND "retired_at" IS NULL
      )
      OR (
        "status" = 'ACTIVE'
        AND "active_from" IS NOT NULL
        AND "retired_at" IS NULL
      )
      OR (
        "status" = 'RETIRED'
        AND "active_from" IS NOT NULL
        AND "retired_at" IS NOT NULL
        AND "retired_at" >= "active_from"
      )
    );

CREATE UNIQUE INDEX "consent_documents_active_purpose_key"
  ON "consent_documents"("purpose")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "consumer_consent_streams"
  ADD CONSTRAINT "consumer_consent_streams_revision_check"
    CHECK (
      ("current_revision" = 0 AND "current_event_id" IS NULL)
      OR ("current_revision" > 0 AND "current_event_id" IS NOT NULL)
    );

ALTER TABLE "consumer_consent_commands"
  ADD CONSTRAINT "consumer_consent_commands_revision_check"
    CHECK ("result_revision" >= 0),
  ADD CONSTRAINT "consumer_consent_commands_hash_check"
    CHECK (
      "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
      AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "consumer_consent_commands_outcome_check"
    CHECK (
      "outcome" = 'APPLIED'
      OR ("outcome" = 'NOOP_ALREADY_WITHDRAWN' AND "command_type" = 'WITHDRAW')
    );

ALTER TABLE "consumer_consent_events"
  ADD CONSTRAINT "consumer_consent_events_revision_check"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "consumer_consent_events_evidence_check"
    CHECK (
      (
        "event_type" = 'GRANTED'
        AND "source" = 'CONSUMER_WEB'
        AND "actor_user_id" = "consumer_user_id"
        AND "tenant_display_name_snapshot" IS NOT NULL
        AND "rendered_evidence_schema" = 'nook-consent-evidence-v1'
        AND "rendered_evidence_sha256" ~ '^[0-9a-f]{64}$'
      )
      OR (
        "event_type" = 'WITHDRAWN'
        AND "tenant_display_name_snapshot" IS NULL
        AND "rendered_evidence_schema" IS NULL
        AND "rendered_evidence_sha256" IS NULL
        AND (
          "source" = 'SUPPORT_VERIFIED_REQUEST'
          OR ("source" = 'CONSUMER_WEB' AND "actor_user_id" = "consumer_user_id")
        )
      )
    );

ALTER TABLE "tenant_crm_privacy_versions"
  ADD CONSTRAINT "tenant_crm_privacy_versions_watermark_check"
    CHECK ("consent_watermark" >= 0);

ALTER TABLE "customer_notes"
  ADD CONSTRAINT "customer_notes_envelope_check"
    CHECK (
      octet_length("ciphertext") > 0
      AND octet_length("nonce") = 12
      AND octet_length("auth_tag") = 16
      AND octet_length("wrapped_dek") > 0
      AND "encryption_schema_version" = 1
    );

ALTER TABLE "customer_tag_definitions"
  ADD CONSTRAINT "customer_tag_definitions_name_check"
    CHECK (
      char_length("normalized_name") BETWEEN 1 AND 32
      AND char_length("display_name") BETWEEN 1 AND 32
      AND "normalized_name" = btrim("normalized_name")
      AND "display_name" = btrim("display_name")
    );

ALTER TABLE "customer_export_jobs"
  ADD CONSTRAINT "customer_export_jobs_attempt_check"
    CHECK ("attempt_count" >= 0 AND "attempt_count" <= 3),
  ADD CONSTRAINT "customer_export_jobs_format_check"
    CHECK ("format_version" = 'crm-export-v1'),
  ADD CONSTRAINT "customer_export_jobs_bounds_check"
    CHECK (
      ("customer_count" IS NULL OR "customer_count" BETWEEN 0 AND 10000)
      AND ("note_count" IS NULL OR "note_count" BETWEEN 0 AND 50000)
      AND ("tag_link_count" IS NULL OR "tag_link_count" BETWEEN 0 AND 100000)
      AND ("uncompressed_bytes" IS NULL OR "uncompressed_bytes" BETWEEN 0 AND 209715200)
      AND ("compressed_bytes" IS NULL OR "compressed_bytes" BETWEEN 0 AND 52428800)
      AND ("object_generation" IS NULL OR "object_generation" >= 0)
      AND ("consent_watermark" IS NULL OR "consent_watermark" >= 0)
      AND ("document_generation" IS NULL OR "document_generation" > 0)
    ),
  ADD CONSTRAINT "customer_export_jobs_hash_check"
    CHECK (
      "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
      AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
      AND ("artifact_sha256" IS NULL OR "artifact_sha256" ~ '^[0-9a-f]{64}$')
    ),
  ADD CONSTRAINT "customer_export_jobs_state_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
      )
      OR (
        "status" = 'PROCESSING'
        AND "claim_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "as_of" IS NOT NULL
        AND "consent_watermark" IS NOT NULL
        AND "document_generation" IS NOT NULL
      )
      OR (
        "status" = 'READY'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "as_of" IS NOT NULL
        AND "consent_watermark" IS NOT NULL
        AND "document_generation" IS NOT NULL
        AND "customer_count" IS NOT NULL
        AND "note_count" IS NOT NULL
        AND "tag_link_count" IS NOT NULL
        AND "uncompressed_bytes" IS NOT NULL
        AND "compressed_bytes" IS NOT NULL
        AND "object_key" IS NOT NULL
        AND "object_generation" IS NOT NULL
        AND "artifact_sha256" IS NOT NULL
        AND "ready_at" IS NOT NULL
        AND "expires_at" IS NOT NULL
        AND "expires_at" > "ready_at"
      )
      OR (
        "status" = 'FAILED'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "failed_at" IS NOT NULL
        AND "safe_code" IS NOT NULL
      )
      OR (
        "status" = 'EXPIRED'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "expires_at" IS NOT NULL
      )
      OR (
        "status" = 'REVOKED'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "revoked_at" IS NOT NULL
      )
    );

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_consumer_user_id_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projection_deliveries" ADD CONSTRAINT "crm_projection_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projection_deliveries" ADD CONSTRAINT "crm_projection_deliveries_consumer_user_id_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projection_deliveries" ADD CONSTRAINT "crm_projection_deliveries_tenant_id_consumer_user_id_appoi_fkey" FOREIGN KEY ("tenant_id", "consumer_user_id", "appointment_id") REFERENCES "appointments"("tenant_id", "consumer_user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projection_deliveries" ADD CONSTRAINT "crm_projection_deliveries_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projection_deliveries" ADD CONSTRAINT "crm_projection_deliveries_tenant_id_outbox_event_id_fkey" FOREIGN KEY ("tenant_id", "outbox_event_id") REFERENCES "outbox_events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projection_streams" ADD CONSTRAINT "crm_projection_streams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projection_streams" ADD CONSTRAINT "crm_projection_streams_consumer_user_id_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_projection_streams" ADD CONSTRAINT "crm_projection_streams_blocked_delivery_id_fkey" FOREIGN KEY ("blocked_delivery_id") REFERENCES "crm_projection_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_streams" ADD CONSTRAINT "consumer_consent_streams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_streams" ADD CONSTRAINT "consumer_consent_streams_consumer_user_id_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_streams" ADD CONSTRAINT "consumer_consent_streams_current_event_id_fkey" FOREIGN KEY ("current_event_id") REFERENCES "consumer_consent_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_commands" ADD CONSTRAINT "consumer_consent_commands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_commands" ADD CONSTRAINT "consumer_consent_commands_consumer_user_id_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_events" ADD CONSTRAINT "consumer_consent_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_events" ADD CONSTRAINT "consumer_consent_events_consumer_user_id_fkey" FOREIGN KEY ("consumer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_events" ADD CONSTRAINT "consumer_consent_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_events" ADD CONSTRAINT "consumer_consent_events_consent_document_id_fkey" FOREIGN KEY ("consent_document_id") REFERENCES "consent_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_events" ADD CONSTRAINT "consumer_consent_events_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "consumer_consent_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_consent_events" ADD CONSTRAINT "consumer_consent_events_tenant_id_consumer_user_id_purpose_fkey" FOREIGN KEY ("tenant_id", "consumer_user_id", "purpose") REFERENCES "consumer_consent_streams"("tenant_id", "consumer_user_id", "purpose") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_crm_privacy_versions" ADD CONSTRAINT "tenant_crm_privacy_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_definitions" ADD CONSTRAINT "customer_tag_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_links" ADD CONSTRAINT "customer_tag_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_links" ADD CONSTRAINT "customer_tag_links_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_links" ADD CONSTRAINT "customer_tag_links_tenant_id_tag_id_fkey" FOREIGN KEY ("tenant_id", "tag_id") REFERENCES "customer_tag_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tag_links" ADD CONSTRAINT "customer_tag_links_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_export_jobs" ADD CONSTRAINT "customer_export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_export_jobs" ADD CONSTRAINT "customer_export_jobs_tenant_id_requested_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "requested_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
