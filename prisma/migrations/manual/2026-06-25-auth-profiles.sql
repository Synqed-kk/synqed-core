-- Auth cutover, Stage 1: recreate the karute `profiles` schema on core (the
-- end-state hosts Supabase Auth here). Ported verbatim from the LIVE karute DB
-- (rvkhxludlxxidjjgcnva) — table + the two business-id helpers + the legacy
-- get_my_customer_id + the hardened handle_new_user trigger + the RLS policies.
BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL,
  full_name       text,
  role            text DEFAULT 'staff',
  created_at      timestamptz NOT NULL DEFAULT now(),
  display_role    text DEFAULT 'staff',
  position        text DEFAULT '',
  email           text DEFAULT '',
  phone           text DEFAULT '',
  avatar_url      text,
  pin_hash        text,
  permission_role text,
  permissions     jsonb,
  store_id        uuid
);

-- Business-id helpers (SELECT customer_id for the current auth user).
CREATE OR REPLACE FUNCTION public.auth_business_id()
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$ select customer_id from public.profiles where id = (select auth.uid()) $fn$;

CREATE OR REPLACE FUNCTION public.get_my_customer_id()
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$ select customer_id from public.profiles where id = auth.uid() $fn$;

-- Hardened signup trigger: ALWAYS a fresh business (ignore client customer_id).
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
begin
  insert into public.profiles (id, customer_id, full_name, email, role, display_role)
  values (
    new.id,
    gen_random_uuid(),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    'admin',
    'owner'
  );
  return new;
end;
$fn$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT only (writes are service-role). Mirror the live karute policies.
DROP POLICY IF EXISTS "profiles_select_same_business" ON public.profiles;
CREATE POLICY "profiles_select_same_business" ON public.profiles
  FOR SELECT TO authenticated USING (customer_id = public.auth_business_id());

DROP POLICY IF EXISTS "Tenant read profiles" ON public.profiles;
CREATE POLICY "Tenant read profiles" ON public.profiles
  FOR SELECT TO public USING (customer_id = public.get_my_customer_id());

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO public USING (id = auth.uid());

COMMIT;
