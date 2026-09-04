import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

function getAuthClient(): SupabaseClient {
  if (client) return client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
  }
  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return client
}

/** Verify the bearer token at Supabase Auth; never trust decoded claims alone. */
export async function verifySupabaseAccessToken(token: string): Promise<string | null> {
  const { data, error } = await getAuthClient().auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}
