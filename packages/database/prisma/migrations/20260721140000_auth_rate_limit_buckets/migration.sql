CREATE TABLE "auth_rate_limit_buckets" (
    "scope" VARCHAR(64) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_rate_limit_buckets_pkey" PRIMARY KEY ("scope", "key_hash", "window_start"),
    CONSTRAINT "auth_rate_limit_buckets_key_hash_check" CHECK ("key_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "auth_rate_limit_buckets_request_count_check" CHECK ("request_count" > 0),
    CONSTRAINT "auth_rate_limit_buckets_expiry_check" CHECK ("expires_at" > "window_start")
);

CREATE INDEX "auth_rate_limit_buckets_expires_at_idx" ON "auth_rate_limit_buckets"("expires_at");
