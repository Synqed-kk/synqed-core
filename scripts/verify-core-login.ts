import { createClient } from '@supabase/supabase-js'

// Auth cutover, Stage 5 (THE GATE): prove a real password login works against
// the CORE project before flipping prod. Run with the core anon key:
//
//   CORE_SUPABASE_URL=https://jdbsqvlfwsmzfmisuwmw.supabase.co \
//   CORE_SUPABASE_ANON_KEY=<core anon key> \
//   LOGIN_EMAIL=dev@karute.test LOGIN_PASSWORD=<seed password> \
//   npx tsx scripts/verify-core-login.ts
//
// Success = the copied bcrypt hash + identity authenticate on core → the cutover
// is safe to flip.

async function main() {
  const url = process.env.CORE_SUPABASE_URL
  const anon = process.env.CORE_SUPABASE_ANON_KEY
  const email = process.env.LOGIN_EMAIL
  const password = process.env.LOGIN_PASSWORD
  if (!url || !anon || !email || !password) {
    console.error('Set CORE_SUPABASE_URL, CORE_SUPABASE_ANON_KEY, LOGIN_EMAIL, LOGIN_PASSWORD')
    process.exit(2)
  }
  const supabase = createClient(url, anon)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.error('❌ LOGIN FAILED:', error.message)
    process.exit(1)
  }
  console.log('✅ LOGIN OK — user', data.user?.id, data.user?.email)
  console.log('   access_token present:', !!data.session?.access_token)
}

main().catch((e) => { console.error(e); process.exit(1) })
