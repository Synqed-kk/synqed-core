-- Auth cutover: the karute app reaches `profiles` via the Supabase client
-- (service_role for writes/cross-tenant reads, authenticated for RLS-scoped
-- reads). Core walled off PostgREST entirely, so grant access to profiles ONLY
-- (the other public tables stay ungranted = inaccessible to these roles).
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;
GRANT SELECT ON public.profiles TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_business_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_customer_id() TO authenticated, service_role;
