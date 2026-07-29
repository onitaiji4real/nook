-- Phase 2 expand migration: tenant portfolio metadata and controlled media lifecycle.
CREATE TYPE "PortfolioItemStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN', 'DELETED');
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'READY', 'REJECTED', 'DELETED');

CREATE TABLE "portfolio_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "staff_id" UUID,
    "service_id" UUID,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "status" "PortfolioItemStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "portfolio_items_title_check" CHECK (length(btrim("title")) BETWEEN 1 AND 160),
    CONSTRAINT "portfolio_items_published_check" CHECK (
        ("status" = 'PUBLISHED' AND "published_at" IS NOT NULL)
        OR ("status" <> 'PUBLISHED' AND "published_at" IS NULL)
    )
);

CREATE TABLE "portfolio_tags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "portfolio_item_id" UUID NOT NULL,
    "value" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_tags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "portfolio_tags_value_check" CHECK (length(btrim("value")) BETWEEN 1 AND 50)
);

CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "bucket" VARCHAR(255) NOT NULL,
    "upload_object_key" VARCHAR(1024) NOT NULL,
    "object_key" VARCHAR(1024),
    "thumbnail_object_key" VARCHAR(1024),
    "declared_mime_type" VARCHAR(64) NOT NULL,
    "declared_byte_size" INTEGER NOT NULL,
    "mime_type" VARCHAR(64),
    "byte_size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" CHAR(64),
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING',
    "upload_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "rejection_code" VARCHAR(80),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_declared_mime_check" CHECK (
        "declared_mime_type" IN ('image/jpeg', 'image/png', 'image/webp')
    ),
    CONSTRAINT "media_assets_declared_size_check" CHECK (
        "declared_byte_size" BETWEEN 1 AND 15728640
    ),
    CONSTRAINT "media_assets_actual_size_check" CHECK ("byte_size" IS NULL OR "byte_size" > 0),
    CONSTRAINT "media_assets_dimensions_check" CHECK (
        ("width" IS NULL AND "height" IS NULL)
        OR ("width" > 0 AND "height" > 0)
    ),
    CONSTRAINT "media_assets_checksum_check" CHECK (
        "checksum" IS NULL OR "checksum" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "media_assets_ready_fields_check" CHECK (
        "status" <> 'READY'
        OR (
            "object_key" IS NOT NULL
            AND "thumbnail_object_key" IS NOT NULL
            AND "mime_type" = 'image/webp'
            AND "byte_size" IS NOT NULL
            AND "width" IS NOT NULL
            AND "height" IS NOT NULL
            AND "checksum" IS NOT NULL
            AND "rejection_code" IS NULL
        )
    ),
    CONSTRAINT "media_assets_rejected_code_check" CHECK (
        "status" <> 'REJECTED' OR "rejection_code" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "portfolio_items_tenant_id_id_key"
ON "portfolio_items"("tenant_id", "id");
CREATE INDEX "portfolio_items_tenant_status_sort_idx"
ON "portfolio_items"("tenant_id", "status", "sort_order", "id");
CREATE INDEX "portfolio_items_tenant_staff_idx"
ON "portfolio_items"("tenant_id", "staff_id");
CREATE INDEX "portfolio_items_tenant_service_idx"
ON "portfolio_items"("tenant_id", "service_id");
CREATE UNIQUE INDEX "portfolio_tags_tenant_item_value_key"
ON "portfolio_tags"("tenant_id", "portfolio_item_id", "value");
CREATE INDEX "portfolio_tags_tenant_value_idx"
ON "portfolio_tags"("tenant_id", "value");
CREATE UNIQUE INDEX "media_assets_tenant_id_id_key"
ON "media_assets"("tenant_id", "id");
CREATE UNIQUE INDEX "media_assets_tenant_owner_key"
ON "media_assets"("tenant_id", "owner_id");
CREATE UNIQUE INDEX "media_assets_bucket_upload_key"
ON "media_assets"("bucket", "upload_object_key");
CREATE INDEX "media_assets_tenant_status_expiry_idx"
ON "media_assets"("tenant_id", "status", "upload_expires_at");
CREATE INDEX "media_assets_created_by_user_idx"
ON "media_assets"("created_by_user_id");

ALTER TABLE "portfolio_items"
ADD CONSTRAINT "portfolio_items_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_items"
ADD CONSTRAINT "portfolio_items_tenant_staff_fkey"
FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profiles"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portfolio_items"
ADD CONSTRAINT "portfolio_items_tenant_service_fkey"
FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "portfolio_tags"
ADD CONSTRAINT "portfolio_tags_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_tags"
ADD CONSTRAINT "portfolio_tags_tenant_item_fkey"
FOREIGN KEY ("tenant_id", "portfolio_item_id") REFERENCES "portfolio_items"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "media_assets"
ADD CONSTRAINT "media_assets_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets"
ADD CONSTRAINT "media_assets_tenant_owner_fkey"
FOREIGN KEY ("tenant_id", "owner_id") REFERENCES "portfolio_items"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets"
ADD CONSTRAINT "media_assets_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "entitlements" ("code", "value_type", "description", "updated_at")
VALUES (
    'MAX_PORTFOLIO_IMAGES',
    'INTEGER',
    'Maximum number of active portfolio image assets available to a tenant.',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "plan_entitlements" ("plan_id", "entitlement_code", "value_json")
SELECT "id", 'MAX_PORTFOLIO_IMAGES', '20'::jsonb
FROM "plans"
WHERE "is_default" = true
ON CONFLICT ("plan_id", "entitlement_code") DO NOTHING;
