-- The bed plane, phase 1 (Liam 8/27 items 1-4): resources + resource_id on
-- appointments + the no-double-bed EXCLUDE constraint + menu room class.
--
-- REQUIRES btree_gist (first use in this project — Liam flagged it must be
-- requested, not assumed; CREATE EXTENSION below requests it).
--
-- The EXCLUDE is the single guard EVERY writer passes through: the service's
-- advisory lock keys per staff (two therapists can reach for the same bed),
-- and the QR crawl writes via Prisma directly. Range = [starts_at,
-- occupied_until): occupied_until snapshots ends_at + resource
-- cleanup_minutes at write time, so turnaround is protected without the
-- constraint reaching into another table. CANCELLED/NO_SHOW rows leave the
-- predicate — a freed bed is bookable; a REVIVED booking re-enters it and can
-- conflict (surfaced as RESOURCE_TAKEN, same as create).
--
-- Rollback: ALTER TABLE appointments DROP CONSTRAINT appointments_resource_no_overlap,
--   DROP COLUMN resource_id, DROP COLUMN occupied_until;
--   ALTER TABLE menus DROP COLUMN required_room_class;
--   DROP TABLE resources; DROP TYPE "RoomClass";

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  CREATE TYPE "RoomClass" AS ENUM ('standard', 'private');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS resources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL,
  store_id        uuid NOT NULL REFERENCES stores(id),
  name            text NOT NULL,
  note            text,
  room_class      "RoomClass" NOT NULL DEFAULT 'standard',
  cleanup_minutes integer NOT NULL DEFAULT 0 CHECK (cleanup_minutes BETWEEN 0 AND 240),
  display_order   integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Deny-all to anon; the app connects as a bypassrls role (matches every table).
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY business_read_select ON resources
    FOR SELECT TO business_read USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS resources_business_store_idx
  ON resources (business_id, store_id, active);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS resource_id uuid REFERENCES resources(id),
  ADD COLUMN IF NOT EXISTS occupied_until timestamptz;

-- occupied_until must exist whenever a resource is claimed (the EXCLUDE range
-- needs a finite end) — the service always writes both together.
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_resource_needs_occupancy;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_resource_needs_occupancy
  CHECK (resource_id IS NULL OR occupied_until IS NOT NULL);

DO $$ BEGIN
  ALTER TABLE appointments
    ADD CONSTRAINT appointments_resource_no_overlap
    EXCLUDE USING gist (
      resource_id WITH =,
      tstzrange(starts_at, occupied_until, '[)') WITH &&
    )
    WHERE (resource_id IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS required_room_class "RoomClass";

COMMIT;
