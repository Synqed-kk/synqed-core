import { prisma } from '../db/client.js'
import type { UpsertOrgSettingsInput } from '../validations/org-settings.js'

export interface OrgSettingsPublic {
  business_id: string
  name: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

function toPublic(row: {
  businessId: string
  name: string | null
  settings: unknown
  createdAt: Date
  updatedAt: Date
}): OrgSettingsPublic {
  return {
    business_id: row.businessId,
    name: row.name,
    settings: (row.settings as Record<string, unknown>) ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function getOrgSettings(
  businessId: string,
): Promise<OrgSettingsPublic | null> {
  const row = await prisma.orgSettings.findUnique({ where: { businessId } })
  return row ? toPublic(row) : null
}

export async function upsertOrgSettings(
  businessId: string,
  input: UpsertOrgSettingsInput,
): Promise<OrgSettingsPublic> {
  // ATOMIC shallow merge (Liam 8/16 heads-up): the old read-then-replace let
  // two admins saving at once drop each other's keys. `settings || new` is a
  // single-statement jsonb shallow merge — exactly the semantics the app
  // already assumes (it sends only the key that changed). Replacing the whole
  // blob is no longer possible through this path, which is the point; a key
  // is cleared by sending it with null.
  if (input.settings !== undefined) {
    await prisma.$executeRaw`
      INSERT INTO org_settings (business_id, name, settings, updated_at)
      VALUES (${businessId}::uuid, ${input.name ?? null}, ${JSON.stringify(input.settings ?? {})}::jsonb, now())
      ON CONFLICT (business_id) DO UPDATE SET
        settings = org_settings.settings || EXCLUDED.settings,
        name = COALESCE(${input.name ?? null}, org_settings.name),
        updated_at = now()`
  } else {
    await prisma.orgSettings.upsert({
      where: { businessId },
      create: { businessId, name: input.name ?? null, settings: {} },
      update: { ...(input.name !== undefined ? { name: input.name } : {}) },
    })
  }
  const row = await prisma.orgSettings.findUniqueOrThrow({ where: { businessId } })
  return toPublic(row)
}
