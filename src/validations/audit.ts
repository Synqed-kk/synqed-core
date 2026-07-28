import { z } from 'zod'

/** One schema for every audit write surface: POST /audit and the transactional
 *  `audit` payloads money-action endpoints accept (A1). */
export const auditEventSchema = z.object({
  store_id: z.string().uuid().nullable().optional(),
  actor_id: z.string().uuid().nullable().optional(),
  actor_type: z.enum(['staff', 'owner', 'system', 'dev']),
  actor_role: z.string().nullable().optional(),
  actor_label: z.string().max(200).nullable().optional(),
  actor_staff_ref: z.string().uuid().nullable().optional(),
  request_id: z.string().max(100).nullable().optional(),
  category: z.string().min(1), // open set — wave 3 (auth) flows in later
  action: z.string().min(1),
  target_type: z.string().nullable().optional(),
  target_id: z.string().nullable().optional(),
  target_label: z.string().nullable().optional(),
  detail: z.unknown().optional(),
  break_glass: z.boolean().optional(),
  severity: z.enum(['info', 'warn', 'critical']).optional(),
})
