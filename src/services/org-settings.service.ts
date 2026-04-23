import { prisma } from '../db/client.js'
import type { UpsertOrgSettingsInput } from '../validations/org-settings.js'

export interface OrgSettingsPublic {
  tenant_id: string
  name: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

function toPublic(row: {
  tenantId: string
  name: string | null
  settings: unknown
  createdAt: Date
  updatedAt: Date
}): OrgSettingsPublic {
  return {
    tenant_id: row.tenantId,
    name: row.name,
    settings: (row.settings as Record<string, unknown>) ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function getOrgSettings(
  tenantId: string,
): Promise<OrgSettingsPublic | null> {
  const row = await prisma.orgSettings.findUnique({ where: { tenantId } })
  return row ? toPublic(row) : null
}

export async function upsertOrgSettings(
  tenantId: string,
  input: UpsertOrgSettingsInput,
): Promise<OrgSettingsPublic> {
  const row = await prisma.orgSettings.upsert({
    where: { tenantId },
    create: {
      tenantId,
      name: input.name ?? null,
      settings: (input.settings ?? {}) as object,
    },
    update: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.settings !== undefined ? { settings: input.settings as object } : {}),
    },
  })
  return toPublic(row)
}
