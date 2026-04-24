import { createClient } from '@supabase/supabase-js'

/**
 * Returns a Supabase storage instance.
 * Throws at call time (not module load time) if env vars are missing,
 * so tests that don't exercise storage can still import this module.
 */
export function getStorage() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
  }

  return createClient(url, key).storage
}
