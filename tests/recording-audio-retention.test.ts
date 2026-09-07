import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/supabase-auth.service.js', () => ({
  verifySupabaseAccessToken: vi.fn(async (token: string) => token),
}))

import app from '../src/index.js'
import { cleanupTestData, seedTestStaff, testPrisma, TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'

process.env.API_KEYS = TEST_API_KEY
const userId = '90000000-0000-0000-0000-000000000095'
const otherBusinessId = '90000000-0000-0000-0000-000000000096'
let staffId: string

function req(method: string, path: string, body?: unknown, businessId = TEST_BUSINESS_ID) {
  return app.request(`/v1/recordings${path}`, {
    method,
    headers: {
      'x-api-key': TEST_API_KEY,
      'x-business-id': businessId,
      Authorization: `Bearer ${userId}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function clean() {
  await testPrisma.recordingSession.deleteMany({
    where: { businessId: { in: [TEST_BUSINESS_ID, otherBusinessId] } },
  })
  await cleanupTestData()
}

beforeEach(async () => {
  await clean()
  staffId = (await seedTestStaff({ userId, role: 'STYLIST' })).id
})
afterEach(clean)

async function create(audioPath?: string) {
  const response = await req('POST', '', { staff_id: staffId, audio_storage_path: audioPath })
  expect(response.status).toBe(201)
  return response.json()
}

describe('recording audio retention', () => {
  it('round-trips nullable sharing fields through update, get, and list', async () => {
    const recording = await create()
    expect(recording).toMatchObject({ shared_at: null, shared_by_staff_id: null })
    const share = { shared_at: '2026-09-07T12:00:00.000Z', shared_by_staff_id: staffId }
    const updated = await req('PUT', `/${recording.id}`, share)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject(share)
    expect(await (await req('GET', `/${recording.id}`)).json()).toMatchObject(share)
    const listed = await (await req('GET', '')).json()
    expect(listed.recordings).toEqual([expect.objectContaining(share)])
    const cleared = await req('PUT', `/${recording.id}`, { shared_at: null, shared_by_staff_id: null })
    expect(await cleared.json()).toMatchObject({ shared_at: null, shared_by_staff_id: null })
    expect((await req('PUT', `/${recording.id}`, { shared_at: 'yesterday' })).status).toBe(400)
    expect((await req('PUT', `/${recording.id}`, { shared_by_staff_id: 'not-a-uuid' })).status).toBe(400)
  })

  it('permits one winner for competing paths on a session, while same-path retries succeed', async () => {
    const recording = await create()
    const paths = ['audio/first.webm', 'audio/second.webm']
    const results = await Promise.all(paths.map(audio_storage_path =>
      req('PUT', `/${recording.id}`, { audio_storage_path }),
    ))
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    const winner = paths[results.findIndex(r => r.status === 200)]
    const retries = await Promise.all([1, 2].map(() => req('PUT', `/${recording.id}`, {
      audio_storage_path: winner, status: 'COMPLETED',
    })))
    expect(retries.map(r => r.status)).toEqual([200, 200])
    expect(await (await req('GET', `/${recording.id}`)).json()).toMatchObject({
      audio_storage_path: winner, status: 'COMPLETED',
    })
  })

  it('enforces unique paths on create and update, with tenant-scoped exact lookup', async () => {
    const path = 'audio/with spaces+日本語.webm'
    const creations = await Promise.all([1, 2].map(() => req('POST', '', {
      staff_id: staffId, audio_storage_path: path,
    })))
    expect(creations.map(r => r.status).sort()).toEqual([201, 409])
    const created = await creations.find(r => r.status === 201)!.json()
    const first = await create()
    const second = await create()
    const updates = await Promise.all([first, second].map(r => req('PUT', `/${r.id}`, {
      audio_storage_path: 'audio/unique.webm', duration_seconds: 50,
    })))
    expect(updates.map(r => r.status).sort()).toEqual([200, 409])
    const loser = [first, second][updates.findIndex(r => r.status === 409)]
    expect(await (await req('GET', `/${loser.id}`)).json()).toMatchObject({
      audio_storage_path: null, duration_seconds: null,
    })
    const filter = `?audio_storage_path=${encodeURIComponent(path)}`
    const listed = await (await req('GET', filter)).json()
    expect(listed.total).toBe(1)
    expect(listed.recordings.map((r: { id: string }) => r.id)).toEqual([created.id])
    expect(await (await req('GET', filter, undefined, otherBusinessId)).json()).toMatchObject({
      total: 0, recordings: [],
    })
    const byIds = await (await req('GET', `${filter}&ids=${created.id},${first.id},${second.id}`)).json()
    expect(byIds.recordings.map((r: { id: string }) => r.id)).toEqual([created.id])
    expect((await req('DELETE', `/${created.id}`, undefined, otherBusinessId)).status).toBe(404)
  })

  it('never acknowledges both deletion and an audio reservation racing on an empty session', async () => {
    const recording = await create()
    const [reserved, deleted] = await Promise.all([
      req('PUT', `/${recording.id}`, { audio_storage_path: 'audio/race.webm' }),
      req('DELETE', `/${recording.id}`),
    ])
    if (reserved.status === 200) {
      expect(deleted.status).toBe(409)
      expect(await (await req('GET', `/${recording.id}`)).json()).toMatchObject({
        audio_storage_path: 'audio/race.webm',
      })
    } else {
      expect(reserved.status).toBe(404)
      expect(deleted.status).toBe(200)
    }
  })

  it('never deletes a recording once audio has been reserved, including after an attempted clear', async () => {
    const recording = await create('recordings/retained.webm')
    expect((await req('DELETE', `/${recording.id}`)).status).toBe(409)
    expect((await req('PUT', `/${recording.id}`, { audio_storage_path: null })).status).toBe(409)
    expect((await req('GET', `/${recording.id}`)).status).toBe(200)
    const empty = await create()
    expect((await req('DELETE', `/${empty.id}`)).status).toBe(200)
    expect((await req('DELETE', `/${empty.id}`)).status).toBe(404)
  })
})
