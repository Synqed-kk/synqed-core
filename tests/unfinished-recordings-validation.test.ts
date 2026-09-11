import { describe, expect, it, vi } from 'vitest'
import { unfinishedRecordingsSchema } from '../src/validations/recording.js'

vi.mock('../src/db/client.js', () => ({ prisma: {} }))
import { listUnfinishedRecordings, RecordingForbiddenError } from '../src/services/recording.service.js'

describe('unfinished recording request boundaries', () => {
  it.each([
    { page: '0' }, { page: '-1' }, { page: 'NaN' }, { page: '1.5' },
    { page_size: '201' }, { page_size: '0' }, { page_size: 'Infinity' },
    { from: 'yesterday' }, { to: 'invalid' }, { store_id: 'not-a-uuid' },
    { from: '2026-09-11T00:00:00Z', to: '2026-09-10T00:00:00Z' },
  ])('rejects malformed or unbounded input: %j', (query) => {
    expect(unfinishedRecordingsSchema.safeParse(query).success).toBe(false)
  })

  it('accepts bounded pagination and an inclusive date range', () => {
    expect(unfinishedRecordingsSchema.parse({
      page: '2', page_size: '200',
      from: '2026-09-11T00:00:00Z', to: '2026-09-11T00:00:00Z',
    })).toMatchObject({ page: 2, page_size: 200 })
  })

  it.each([{ stores: [] }, { stores: ['assigned-store'] }])('rejects an explicit store outside the actor scope before reading data', async ({ stores }) => {
    await expect(listUnfinishedRecordings('business', { store_id: 'other-store' }, stores))
      .rejects.toBeInstanceOf(RecordingForbiddenError)
  })
})
