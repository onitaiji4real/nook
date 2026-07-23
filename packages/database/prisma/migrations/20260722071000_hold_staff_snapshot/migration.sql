ALTER TABLE "booking_holds"
  ADD COLUMN "staff_display_name_snapshot" VARCHAR(120);

UPDATE "booking_holds" AS hold
SET "staff_display_name_snapshot" = staff."display_name"
FROM "staff_profiles" AS staff
WHERE staff."tenant_id" = hold."tenant_id"
  AND staff."id" = hold."staff_id";

ALTER TABLE "booking_holds"
  ALTER COLUMN "staff_display_name_snapshot" SET NOT NULL;
