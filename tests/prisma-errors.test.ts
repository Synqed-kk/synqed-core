import { describe, it, expect } from 'vitest'
import { isUniqueViolation, isRecordNotFound } from '../src/db/prisma-errors.js'

// Prisma's P2002 meta.target carries DB COLUMN names (snake_case), not the
// camelCase Prisma field names. Callers MUST pass the snake column or the check
// silently never matches — the class of bug that disabled the QR sync adopt
// path (isUniqueViolation(e, 'startsAt') on the starts_at column).
function p2002(target: string[] | string) {
  return { code: 'P2002', meta: { target } }
}

describe('isUniqueViolation', () => {
  it('matches on the snake_case column name in a target array', () => {
    const err = p2002(['business_id', 'customer_id', 'starts_at'])
    expect(isUniqueViolation(err, 'starts_at')).toBe(true)
  })

  it('does NOT match the camelCase field name (the historical footgun)', () => {
    const err = p2002(['business_id', 'customer_id', 'starts_at'])
    expect(isUniqueViolation(err, 'startsAt')).toBe(false)
  })

  it('matches when meta.target is the constraint-name string', () => {
    const err = p2002('appointments_business_id_customer_id_starts_at_key')
    expect(isUniqueViolation(err, 'starts_at')).toBe(true)
  })

  it('karute_number: snake column matches, camelCase field does not', () => {
    // customer.service + sync.service retry on this key; the column is
    // @map("karute_number"), so 'karuteNumber' never matched.
    const err = p2002(['business_id', 'karute_number'])
    expect(isUniqueViolation(err, 'karute_number')).toBe(true)
    expect(isUniqueViolation(err, 'karuteNumber')).toBe(false)
  })

  it('is false for a non-P2002 error', () => {
    expect(isUniqueViolation({ code: 'P2025' }, 'starts_at')).toBe(false)
    expect(isUniqueViolation(null, 'starts_at')).toBe(false)
    expect(isUniqueViolation(new Error('boom'), 'starts_at')).toBe(false)
  })
})

describe('isRecordNotFound', () => {
  it('is true only for P2025', () => {
    expect(isRecordNotFound({ code: 'P2025' })).toBe(true)
    expect(isRecordNotFound({ code: 'P2002' })).toBe(false)
    expect(isRecordNotFound(null)).toBe(false)
  })
})
