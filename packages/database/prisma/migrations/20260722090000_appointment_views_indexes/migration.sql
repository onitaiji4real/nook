CREATE INDEX "appointments_consumer_start_id_idx"
ON "appointments" ("consumer_user_id", "start_at", "id");

CREATE INDEX "appointments_tenant_start_id_idx"
ON "appointments" ("tenant_id", "start_at", "id");

CREATE INDEX "appointments_tenant_staff_start_id_idx"
ON "appointments" ("tenant_id", "staff_id", "start_at", "id");
