-- Contract migration after 20260714010000_audit_request_id expanded the schema.
-- Legacy rows receive a deterministic, non-PII migration correlation value.
UPDATE "audit_logs"
SET "request_id" = 'legacy-' || "id"::text
WHERE "request_id" IS NULL;

ALTER TABLE "audit_logs"
ALTER COLUMN "request_id" SET NOT NULL;

-- Phase 1 closes tenants through status. Hard deletion must not cascade away audit evidence.
ALTER TABLE "audit_logs"
DROP CONSTRAINT "audit_logs_tenant_id_fkey";

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
