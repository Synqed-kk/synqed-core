import { describe, it, expect } from 'vitest'
import { isUniqueViolation } from '../src/db/prisma-errors.js'

// The customer karute_number is @map("karute_number"); Prisma's P2002
// meta.target carries the DB column, so the retry guards in customer.service
// and sync.service must match on 'karute_number', not the Prisma field name
// 'karuteNumber' (which never matched — the retry silently never fired).
describe('isUniqueViolation — karute_number column', () => {
  const err = { code: 'P2002', meta: { target: ['business_id', 'karute_number'] } }

  it('matches the snake_case column', () => {
    expect(isUniqueViolation(err, 'karute_number')).toBe(true)
  })

  it('does NOT match the camelCase Prisma field', () => {
    expect(isUniqueViolation(err, 'karuteNumber')).toBe(false)
  })
})
