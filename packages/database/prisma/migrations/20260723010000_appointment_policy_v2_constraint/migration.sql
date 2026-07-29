ALTER TABLE "appointments"
    DROP CONSTRAINT "appointments_policy_check",
    ADD CONSTRAINT "appointments_policy_check" CHECK (
        LENGTH(BTRIM("booking_policy_snapshot")) > 0
        AND LENGTH(BTRIM("cancellation_policy_snapshot")) > 0
        AND "policy_version" ~ '^v[12]:[0-9a-f]{64}$'
        AND "policies_accepted_at" = "confirmed_at"
    );
