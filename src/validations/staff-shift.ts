import { z } from 'zod'

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'date must be a real calendar date')
const minute = z.number().int().min(0).max(1440)
export const shiftIntervalSchema = z.object({ start: minute, end: minute }).strict()
  .refine(interval => interval.start < interval.end, 'start must be before end')

const windowFields = {
  start: minute,
  end: minute,
  breaks: z.array(shiftIntervalSchema).max(100),
  blocks: z.array(shiftIntervalSchema).max(100),
}

export const shiftWindowSchema = z.object(windowFields).superRefine((shift, ctx) => {
  if (shift.start >= shift.end) ctx.addIssue({ code: 'custom', message: 'start must be before end' })
  const intervals = [...shift.breaks, ...shift.blocks].sort((a, b) => a.start - b.start)
  for (const [index, interval] of intervals.entries()) {
    if (interval.start < shift.start || interval.end > shift.end) {
      ctx.addIssue({ code: 'custom', message: 'Breaks and blocks must be inside the working window' })
    }
    if (index > 0 && interval.start < intervals[index - 1].end) {
      ctx.addIssue({ code: 'custom', message: 'Breaks and blocks must not overlap' })
    }
  }
})

export const createStaffShiftSchema = z.object({
  store_id: z.string().uuid(), staff_id: z.string().uuid(), date: calendarDate,
  ...windowFields,
  breaks: windowFields.breaks.default([]), blocks: windowFields.blocks.default([]),
}).strict()
export const updateStaffShiftSchema = z.object(windowFields).partial().strict()
export const listStaffShiftsSchema = z.object({
  store_id: z.string().uuid().optional(), staff_id: z.string().uuid().optional(),
  date: calendarDate.optional(), from: calendarDate.optional(), to: calendarDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(100),
}).refine(q => !q.from || !q.to || q.from < q.to, 'from must be before to')

export type CreateStaffShiftInput = z.infer<typeof createStaffShiftSchema>
export type UpdateStaffShiftInput = z.infer<typeof updateStaffShiftSchema>
export type ListStaffShiftsInput = z.infer<typeof listStaffShiftsSchema>
