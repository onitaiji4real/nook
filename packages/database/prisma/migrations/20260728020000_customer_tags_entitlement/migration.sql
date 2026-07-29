-- Customer tags are commercially gated independently from the global taxonomy activation mode.
-- Existing plans default to false; a later reviewed catalog change may enable approved paid plans.
INSERT INTO "entitlements" (
    "code", "value_type", "description", "updated_at"
) VALUES (
    'CUSTOMER_TAGS',
    'BOOLEAN',
    'Allows tenant members to use approved non-sensitive customer tags.',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "entitlements"
        WHERE "code" = 'CUSTOMER_TAGS'
          AND "value_type" = 'BOOLEAN'
    ) THEN
        RAISE EXCEPTION 'CUSTOMER_TAGS must be a BOOLEAN entitlement';
    END IF;
END
$$;

INSERT INTO "plan_entitlements" ("plan_id", "entitlement_code", "value_json")
SELECT "id", 'CUSTOMER_TAGS', 'false'::jsonb
FROM "plans"
ON CONFLICT ("plan_id", "entitlement_code") DO NOTHING;

ALTER TABLE "plan_entitlements"
    ADD CONSTRAINT "plan_entitlements_customer_tags_check" CHECK (
        "entitlement_code" <> 'CUSTOMER_TAGS'
        OR jsonb_typeof("value_json") = 'boolean'
    ) NOT VALID;

ALTER TABLE "plan_entitlements"
    VALIDATE CONSTRAINT "plan_entitlements_customer_tags_check";
