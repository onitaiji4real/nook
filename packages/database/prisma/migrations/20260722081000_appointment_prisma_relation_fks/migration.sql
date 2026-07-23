-- Prisma relation support: retain the composite ownership constraints from the
-- expand migration and add direct unique-ID foreign keys for nullable relations.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_hold_id_fkey') THEN
    ALTER TABLE "appointments"
      ADD CONSTRAINT "appointments_hold_id_fkey"
      FOREIGN KEY ("hold_id") REFERENCES "booking_holds"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_items_appointment_id_fkey') THEN
    ALTER TABLE "appointment_items"
      ADD CONSTRAINT "appointment_items_appointment_id_fkey"
      FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_occupancies_hold_id_fkey') THEN
    ALTER TABLE "booking_occupancies"
      ADD CONSTRAINT "booking_occupancies_hold_id_fkey"
      FOREIGN KEY ("hold_id") REFERENCES "booking_holds"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_occupancies_appointment_id_fkey') THEN
    ALTER TABLE "booking_occupancies"
      ADD CONSTRAINT "booking_occupancies_appointment_id_fkey"
      FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
