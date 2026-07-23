-- PostgreSQL CHECK constraints accept UNKNOWN, so required price fields need explicit IS NOT NULL.
ALTER TABLE "services"
DROP CONSTRAINT "services_price_check";

ALTER TABLE "services"
ADD CONSTRAINT "services_price_check" CHECK (
  ("price_type" IN ('FIXED', 'FROM') AND "price_amount" IS NOT NULL AND "price_amount" BETWEEN 0 AND 10000000 AND "price_min" IS NULL AND "price_max" IS NULL)
  OR
  ("price_type" = 'RANGE' AND "price_amount" IS NULL AND "price_min" IS NOT NULL AND "price_max" IS NOT NULL AND "price_min" BETWEEN 0 AND 10000000 AND "price_max" BETWEEN "price_min" AND 10000000)
  OR
  ("price_type" = 'QUOTE' AND "price_amount" IS NULL AND "price_min" IS NULL AND "price_max" IS NULL)
);
