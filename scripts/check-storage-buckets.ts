import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(url, key)
  const { data, error } = await supabase.storage.listBuckets()
  if (error) { console.error(error); process.exit(1) }
  console.log('buckets:', data?.map((b) => ({ name: b.name, public: b.public })))

  const target = data?.find((b) => b.name === 'customer-photos')
  if (!target) {
    console.log('Creating customer-photos bucket (private)...')
    const { error: createErr } = await supabase.storage.createBucket('customer-photos', { public: false })
    if (createErr) { console.error(createErr); process.exit(1) }
    console.log('Created.')
  } else {
    console.log('customer-photos bucket exists')
  }
}

main()
