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
  it('preserves the previous transcript when a replacement insert conflicts', async () => {
    const staff = await seedTestStaff()
    const recording = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id },
    })
    await addSegment(recording.id)
    const path = `/v1/recordings/${recording.id}/segments`
    const before = await (await app.request(path, { headers })).json()
    const response = await app.request(path, {
      method: 'POST', headers,
      body: JSON.stringify({ replace: true, segments: [
        { segment_index: 1, text: 'first', start_time: 0, end_time: 1 },
        { segment_index: 1, text: 'duplicate', start_time: 1, end_time: 2 },
      ] }),
    })
    expect(response.status).toBe(409)
    expect(await (await app.request(path, { headers })).json()).toEqual(before)
  })

  it('serializes concurrent replacements instead of mixing their transcripts', async () => {
    const staff = await seedTestStaff()
    const recording = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id },
    })
    await addSegment(recording.id)
    const path = `/v1/recordings/${recording.id}/segments`
    const replacements = [1, 2, 3, 4].map(index => [
      { segment_index: index * 2, text: `take ${index} a`, start_time: 0, end_time: 1 },
      { segment_index: index * 2 + 1, text: `take ${index} b`, start_time: 1, end_time: 2 },
    ])
    const responses = await Promise.all(replacements.map(segments => app.request(path, {
      method: 'POST', headers, body: JSON.stringify({ replace: true, segments }),
    })))
    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200)
      expect((await response.json()).segments.map((s: { text: string }) => s.text))
        .toEqual(replacements[index].map(s => s.text))
    }
    const final = await (await app.request(path, { headers })).json()
    expect(replacements.map(take => take.map(s => s.text)))
      .toContainEqual(final.segments.map((s: { text: string }) => s.text))
  })

  it('permits an intentional empty replacement without touching another business', async () => {
    const staff = await seedTestStaff()
    const recording = await testPrisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id },
    })
    await addSegment(recording.id)
    const path = `/v1/recordings/${recording.id}/segments`
    const denied = await app.request(path, {
      method: 'POST', headers: { ...headers, 'x-business-id': '90000000-0000-0000-0000-000000000001' },
      body: JSON.stringify({ replace: true, segments: [] }),
    })
    expect(denied.status).toBe(404)
    expect((await (await app.request(path, { headers })).json()).segments).toHaveLength(1)
    const cleared = await app.request(path, {
      method: 'POST', headers, body: JSON.stringify({ replace: true, segments: [] }),
    })
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toEqual({ segments: [] })
  })

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
