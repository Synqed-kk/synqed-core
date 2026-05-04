// Connects to karute's Supabase project (different from synqed-core's) to check
// for legacy customer_photos rows that may need backfilling.
import { createClient } from '@supabase/supabase-js'

const KARUTE_URL = 'https://rvkhxludlxxidjjgcnva.supabase.co'
const KARUTE_SERVICE_KEY = process.env.KARUTE_SERVICE_KEY!

async function main() {
  if (!KARUTE_SERVICE_KEY) { console.error('Set KARUTE_SERVICE_KEY env var'); process.exit(1) }
  const supabase = createClient(KARUTE_URL, KARUTE_SERVICE_KEY)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('customer_photos').select('*')
  if (error) { console.error('error:', error); return }
  console.log('legacy customer_photos rows:', data?.length ?? 0)
  if (data && data.length > 0) console.log('sample:', data.slice(0, 3))

  const buckets = await supabase.storage.listBuckets()
  console.log('legacy buckets:', buckets.data?.map((b) => b.name))

  if (buckets.data?.find((b) => b.name === 'customer-photos')) {
    const list = await supabase.storage.from('customer-photos').list()
    console.log('legacy customer-photos top-level entries:', list.data?.length ?? 0)
  }
}

main()
