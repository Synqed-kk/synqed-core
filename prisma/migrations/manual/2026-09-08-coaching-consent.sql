-- CORE-4: API-enforced human identity, private append-only consent history.
BEGIN;
CREATE TABLE coaching_consent (
  id uuid PRIMARY KEY,
  sequence bigserial NOT NULL UNIQUE,
  business_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  created_by uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('granted', 'declined')),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_consent_self_authored CHECK (created_by = staff_id)
);
-- Like staff_policy_events, consent evidence outlives normal staff deletion.
-- Validate the live tenant/card at insertion without blocking offboarding.
CREATE OR REPLACE FUNCTION validate_coaching_consent_staff() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM staff WHERE id = NEW.staff_id AND business_id = NEW.business_id
    AND is_active = true AND user_id = NEW.auth_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active staff not found in consent business'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coaching_consent_staff_scope BEFORE INSERT ON coaching_consent
  FOR EACH ROW EXECUTE FUNCTION validate_coaching_consent_staff();
CREATE INDEX coaching_consent_business_id_staff_id_sequence_idx
  ON coaching_consent(business_id, staff_id, sequence);
CREATE FUNCTION prevent_coaching_consent_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Coaching consent is append-only';
END $$;
CREATE TRIGGER coaching_consent_append_only BEFORE UPDATE OR DELETE ON coaching_consent
  FOR EACH ROW EXECUTE FUNCTION prevent_coaching_consent_changes();
-- No direct browser/PostgREST policy, including for owners. Core authenticates
-- the Supabase subject on every request; managers get aggregate counts only.
ALTER TABLE coaching_consent ENABLE ROW LEVEL SECURITY;
COMMIT;
