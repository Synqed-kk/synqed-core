import { prisma } from '../db/client.js'

export interface InvitePublic {
  id: string
  business_id: string
  email: string
  role: string
  token: string
  status: string
  invited_by: string | null
  created_at: string
  expires_at: string | null
}

function toPublic(row: {
  id: string
  businessId: string
  email: string
  role: string
  token: string
  status: string
  invitedBy: string | null
  createdAt: Date
  expiresAt: Date | null
}): InvitePublic {
  return {
    id: row.id,
    business_id: row.businessId,
    email: row.email,
    role: row.role,
    token: row.token,
    status: row.status,
    invited_by: row.invitedBy,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
  }
}

export async function listInvites(businessId: string): Promise<InvitePublic[]> {
  const rows = await prisma.invite.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' } })
  return rows.map(toPublic)
}

/**
 * Look up an invite by its token, WITHOUT a business scope — the pre-auth /join
 * flow has no business yet; the high-entropy token is the per-invite secret and
 * carries the business_id back to the caller. The API key still gates access.
 */
export async function getInviteByToken(token: string): Promise<InvitePublic | null> {
  const row = await prisma.invite.findUnique({ where: { token } })
  return row ? toPublic(row) : null
}

export async function createInvite(
  businessId: string,
  input: { email: string; role: string; token: string; invited_by?: string | null; expires_at?: string | null },
): Promise<InvitePublic> {
  const row = await prisma.invite.create({
    data: {
      businessId,
      email: input.email,
      role: input.role,
      token: input.token,
      invitedBy: input.invited_by ?? null,
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
    },
  })
  return toPublic(row)
}

export async function updateInviteStatus(
  businessId: string,
  id: string,
  status: string,
): Promise<InvitePublic> {
  const existing = await prisma.invite.findFirst({ where: { id, businessId } })
  if (!existing) throw new Error('Invite not found')
  const row = await prisma.invite.update({ where: { id }, data: { status } })
  return toPublic(row)
}
