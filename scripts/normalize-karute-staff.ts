import { z } from 'zod'
import { prisma } from '../src/db/client.js'
import { normalizeKaruteStaffIdentities } from '../src/services/karute-staff-normalization.service.js'

async function main() {
  const [businessId, mode, ...extra] = process.argv.slice(2)
  if (!z.string().uuid().safeParse(businessId).success ||
      (mode !== undefined && mode !== '--apply') || extra.length) {
    throw new Error('Usage: npx tsx scripts/normalize-karute-staff.ts <business-uuid> [--apply]')
  }
  const report = await normalizeKaruteStaffIdentities(businessId!, mode === '--apply')
  console.log(JSON.stringify({ business_id: businessId, mode: mode ?? 'preview', ...report }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Normalization failed')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
