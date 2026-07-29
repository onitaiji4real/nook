-- Expand-only migration: existing audit rows remain valid while new writes include request_id.
ALTER TABLE "audit_logs" ADD COLUMN "request_id" VARCHAR(128);

CREATE INDEX "audit_logs_tenant_request_id_idx" ON "audit_logs"("tenant_id", "request_id");
