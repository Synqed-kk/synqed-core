// Replays data captured by dump-dev-data.ts into the NEW synqed-core schema.
//
// Mapping (old → new):
//   customers     → customers      (pass-through + external_refs: {})
//   profiles      → staff          (full_name → name, customer_id → business_id, role mapped)
//   appointments  → appointments   (time/id columns renamed, source/external_refs derived,
//                                   ends_at computed, business_id looked up via customer)
//   sync_config   → sync_configs   (shape transformed, plaintext password re-encrypted via crypto.ts)
//
// Skipped (not synqed-core's concern — these belong in karute's DB):
//   karute_records, entries, customer_photos, organization_settings
//
// Usage:
//   SYNC_CRYPTO_KEY=... npx tsx scripts/seed-from-dump.ts [--in=dev-data.json]

import { PrismaClient, type StaffRole } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { encryptJson } from '../src/services/crypto.js'

const inPath = process.argv.find((a) => a.startsWith('--in='))?.split('=')[1] ?? 'dev-data.json'

interface OldCustomer {
  id: string
  business_id: string
  name: string
  furigana: string | null
  email: string | null
  phone: string | null
  locale: string | null
  notes: string | null
  contact_info: string | null
  assigned_staff_id: string | null
  created_at: string
  updated_at: string
}

interface OldProfile {
  id: string
  customer_id: string // actually business_id
  full_name: string | null
  role: string | null
  display_role: string | null
  created_at: string
  position: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
  pin_hash: string | null
}

interface OldAppointment {
  id: string
  staff_profile_id: string
  client_id: string
  start_time: string
  duration_minutes: number | null
  title: string | null
  notes: string | null
  karute_record_id: string | null
  created_at: string
  updated_at: string
}

interface OldSyncConfig {
  id: string
  business_id: string
  provider: string
  base_url: string | null
  username: string | null
  password_encrypted: string | null
  store_id: number | null
  enabled: boolean
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_error: string | null
  created_at: string
  updated_at: string
}

interface Dump {
  customers?: OldCustomer[]
  profiles?: OldProfile[]
  appointments?: OldAppointment[]
  sync_config?: OldSyncConfig[]
}

// ---------- mappers ----------

function mapStaffRole(role: string | null | undefined): StaffRole {
  switch ((role ?? '').toLowerCase()) {
    case 'owner':
      return 'OWNER'
    case 'admin':
    case 'manager':
      return 'ADMIN'
    case 'assistant':
    case 'receptionist':
      return 'ASSISTANT'
    default:
      return 'STYLIST'
  }
}

function extractQrReservationId(notes: string | null): number | null {
  if (!notes) return null
  const match = notes.match(/QR #(\d+)/)
  return match ? Number(match[1]) : null
}

// ---------- main ----------

async function main() {
  const dump = JSON.parse(readFileSync(inPath, 'utf8')) as Dump
  const prisma = new PrismaClient()

  try {
    // 1. Customers
    const customers = dump.customers ?? []
    if (customers.length > 0) {
      await prisma.customer.createMany({
        data: customers.map((c) => ({
          id: c.id,
          businessId: c.business_id,
          name: c.name,
          furigana: c.furigana,
          email: c.email,
          phone: c.phone,
          locale: c.locale ?? 'ja',
          notes: c.notes,
          contactInfo: c.contact_info,
          assignedStaffId: c.assigned_staff_id,
          externalRefs: {},
          createdAt: new Date(c.created_at),
          updatedAt: new Date(c.updated_at),
        })),
        skipDuplicates: true,
      })
      console.log(`customers: seeded ${customers.length}`)
    }

    // 2. Staff (from profiles)
    const profiles = dump.profiles ?? []
    if (profiles.length > 0) {
      await prisma.staff.createMany({
        data: profiles.map((p) => ({
          id: p.id,
          businessId: p.customer_id, // old name for tenant
          name: p.full_name ?? 'Unnamed',
          email: p.email,
          role: mapStaffRole(p.role),
          isActive: true,
          createdAt: new Date(p.created_at),
          updatedAt: new Date(p.created_at), // no updated_at in old schema
        })),
        skipDuplicates: true,
      })
      console.log(`staff: seeded ${profiles.length}`)
    }

    // 3. Appointments — needs tenant lookup via customer
    const appointments = dump.appointments ?? []
    if (appointments.length > 0) {
      // Build customer → tenant map
      const customerTenants = new Map<string, string>(
        customers.map((c) => [c.id, c.business_id]),
      )

      let skipped = 0
      const rows = appointments.flatMap((a) => {
        const businessId = customerTenants.get(a.client_id)
        if (!businessId) {
          skipped++
          return []
        }
        const durationMs = (a.duration_minutes ?? 0) * 60_000
        const startsAt = new Date(a.start_time)
        const endsAt = new Date(startsAt.getTime() + durationMs)
        const qrId = extractQrReservationId(a.notes)
        return [
          {
            id: a.id,
            businessId,
            customerId: a.client_id,
            staffId: a.staff_profile_id,
            startsAt,
            endsAt,
            durationMinutes: a.duration_minutes,
            title: a.title,
            notes: a.notes,
            status: 'SCHEDULED' as const,
            source: (qrId !== null ? 'QUICKRESERVE' : 'MANUAL') as const,
            externalRefs: qrId !== null ? { quickreserve: { reservationId: qrId } } : {},
            createdAt: new Date(a.created_at),
            updatedAt: new Date(a.updated_at),
          },
        ]
      })

      if (rows.length > 0) {
        await prisma.appointment.createMany({ data: rows, skipDuplicates: true })
      }
      console.log(`appointments: seeded ${rows.length} (skipped ${skipped} with missing customer)`)
    }

    // 4. SyncConfig — encrypt the old plaintext password via our crypto helper
    const syncConfigs = dump.sync_config ?? []
    if (syncConfigs.length > 0) {
      for (const s of syncConfigs) {
        const provider = s.provider.toUpperCase() as
          | 'QUICKRESERVE'
          | 'SYNQED_RESERVE'
          | 'SALON_BOARD'
          | 'HOT_PEPPER'
        const lastStatus =
          s.last_sync_status === 'success'
            ? 'OK'
            : s.last_sync_status === 'error'
              ? 'ERROR'
              : null

        // Re-encrypt credentials via the new envelope format
        const creds = {
          username: s.username ?? '',
          password: s.password_encrypted ?? '', // old column was plaintext despite the name
          storeSlug: s.base_url ?? '',
          storeId: s.store_id ?? 0,
        }
        const credentialsEncrypted = encryptJson(creds)

        await prisma.syncConfig.upsert({
          where: { businessId_provider: { businessId: s.business_id, provider } },
          create: {
            id: s.id,
            businessId: s.business_id,
            provider,
            username: s.username,
            storeSlug: s.base_url,
            storeId: s.store_id,
            credentialsEncrypted,
            enabled: s.enabled,
            intervalMinutes: 15,
            businessHoursStart: 8,
            businessHoursEnd: 22,
            timezone: 'Asia/Tokyo',
            lookaheadDays: 7,
            lastRunAt: s.last_sync_at ? new Date(s.last_sync_at) : null,
            lastRunStatus: lastStatus,
            lastRunError: s.last_sync_error,
            createdAt: new Date(s.created_at),
            updatedAt: new Date(s.updated_at),
          },
          update: {
            username: s.username,
            storeSlug: s.base_url,
            storeId: s.store_id,
            credentialsEncrypted,
            enabled: s.enabled,
          },
        })
      }
      console.log(`sync_configs: seeded ${syncConfigs.length}`)
    }

    console.log('\nSeed complete.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
