import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import app from '../src/index.js'
import { testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY

function req(path: string, businessId = TEST_BUSINESS_ID) {
  return app.request(`/v1${path}`, {
    headers: {
      'x-api-key': TEST_API_KEY,
      'x-business-id': businessId,
    },
  })
}

describe('recordings list ids filter', () => {
  const recordingIds: string[] = []

  afterEach(async () => {
    await testPrisma.recordingSession.deleteMany({ where: { id: { in: recordingIds } } })
    recordingIds.length = 0
  })

  it('returns only the requested in-business recordings and bypasses pagination', async () => {
    const businessId = randomUUID()
    const staffId = randomUUID()
    const localRows = await Promise.all(
      ['RECORDING', 'PROCESSING', 'COMPLETED'].map((status) =>
        testPrisma.recordingSession.create({
          data: {
            businessId,
            staffId,
            status: status as 'RECORDING' | 'PROCESSING' | 'COMPLETED',
          },
        }),
      ),
    )
    const foreign = await testPrisma.recordingSession.create({
      data: { businessId: randomUUID(), staffId: randomUUID() },
    })
    recordingIds.push(...localRows.map((row) => row.id), foreign.id)

    const requestedIds = [localRows[0].id, localRows[2].id, foreign.id]
    const response = await req(
      `/recordings?ids=${requestedIds.join(',')}&page=2&page_size=1`,
      businessId,
    )

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.recordings.map((recording: { id: string }) => recording.id).sort()).toEqual(
      [localRows[0].id, localRows[2].id].sort(),
    )
    expect(result).toMatchObject({ total: 2, page: 1, page_size: 2 })
  })

  it('treats an empty ids query as the ordinary paginated list', async () => {
    const businessId = randomUUID()
    const staffId = randomUUID()
    const rows = await Promise.all(
      [0, 1].map(() =>
        testPrisma.recordingSession.create({
          data: { businessId, staffId },
        }),
      ),
    )
    recordingIds.push(...rows.map((row) => row.id))

    const response = await req('/recordings?ids=&page_size=1', businessId)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ total: 2, page: 1, page_size: 1 })
  })
})
