import { afterEach, describe, expect, it } from 'vitest'
import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestStaff,
  testPrisma,
  TEST_API_KEY,
  TEST_BUSINESS_ID,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}

function addSegment(recordingId: string) {
  return app.request(`/v1/recordings/${recordingId}/segments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      replace: false,
      segments: [
        {
          segment_index: 0,
          text: 'same logical segment',
          start_time: 0,
          end_time: 1,
        },
      ],
    }),
  })
}

afterEach(async () => {
  await testPrisma.transcriptionSegment.deleteMany({
    where: { recordingSession: { businessId: TEST_BUSINESS_ID } },
  })
  await testPrisma.recordingSession.deleteMany({ where: { businessId: TEST_BUSINESS_ID } })
  await cleanupTestData()
})

describe('transcription segment uniqueness', () => {
  it('rejects a repeated replace:false write for the same session index', async () => {
    const staff = await seedTestStaff()
    const recording = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id },
    })

    expect((await addSegment(recording.id)).status).toBe(200)
    expect((await addSegment(recording.id)).status).toBe(409)
    expect(
      await testPrisma.transcriptionSegment.count({
        where: { recordingSessionId: recording.id, segmentIndex: 0 },
      }),
    ).toBe(1)
  })

  it('allows only one of two concurrent replace:false writes', async () => {
    const staff = await seedTestStaff()
    const recording = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id },
    })

    const responses = await Promise.all([addSegment(recording.id), addSegment(recording.id)])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    expect(
      await testPrisma.transcriptionSegment.count({
        where: { recordingSessionId: recording.id, segmentIndex: 0 },
      }),
    ).toBe(1)
  })
})
