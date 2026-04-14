import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

// Use service role key — synqed-core is a trusted backend service.
// Tenant scoping is enforced in the service layer, not RLS.
export const supabase = createClient(supabaseUrl, supabaseServiceKey)
