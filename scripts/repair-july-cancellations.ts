import { readFile } from 'node:fs/promises'
import { prisma } from '../src/db/client.js'
import { repairJulyCancellations } from '../src/services/july-cancellation-repair.service.js'

async function main() {
  const [path, mode, ...extra] = process.argv.slice(2)
  if (!path || (mode !== undefined && mode !== '--apply') || extra.length) {
    throw new Error('Usage: npx tsx scripts/repair-july-cancellations.ts <manifest.json> [--apply]')
  }
  const report = await repairJulyCancellations(JSON.parse(await readFile(path, 'utf8')), mode === '--apply')
  console.log(JSON.stringify({ mode: mode ?? 'preview', ...report }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Repair failed')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
