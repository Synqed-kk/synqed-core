import { describe, it, expect, afterEach, vi } from 'vitest'

// vi.mock is hoisted before imports by vitest — this intercepts all
// calls to getStorage() throughout the module graph in this test file.
vi.mock('../src/services/storage.js', () => ({
  getStorage: vi.fn(() => ({
    from: vi.fn((bucket: string) => ({
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn((path: string) => ({
        data: {
          publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}`,
        },
      })),
    })),
  })),
}))

import app from '../src/index.js'
import {
  cleanupTestData,
  seedTestStaff,
  testPrisma,
  TEST_BUSINESS_ID,
  TEST_API_KEY,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
}

const DIFFERENT_BUSINESS_ID = '00000000-0000-0000-0000-000000000099'

afterEach(async () => {
  vi.clearAllMocks()
  await cleanupTestData()
})

describe('Staff Avatar Upload — POST /v1/staff/:id/avatar', () => {
  it('returns 400 when no file is provided', async () => {
    const staff = await seedTestStaff()

    const formData = new FormData()
    // Intentionally send an empty form (no "file" field)
    const res = await app.request(`/v1/staff/${staff.id}/avatar`, {
      method: 'POST',
      headers,
      body: formData,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no file/i)
  })

  it('returns 400 when file field is a string instead of a File', async () => {
    const staff = await seedTestStaff()

    const formData = new FormData()
    formData.append('file', 'not-a-file')

    const res = await app.request(`/v1/staff/${staff.id}/avatar`, {
      method: 'POST',
      headers,
      body: formData,
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no file/i)
  })

  it('returns 404 for a staff ID belonging to a different tenant', async () => {
    const staff = await seedTestStaff()

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'test.png', {
      type: 'image/png',
    })
    const formData = new FormData()
    formData.append('file', file)

    // Request from a different tenant — staff record not visible
    const res = await app.request(`/v1/staff/${staff.id}/avatar`, {
      method: 'POST',
      headers: {
        'x-api-key': TEST_API_KEY,
        'x-business-id': DIFFERENT_BUSINESS_ID,
      },
      body: formData,
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/staff not found/i)
  })

  it('returns avatar_url and persists it to Staff.avatarUrl in DB', async () => {
    const staff = await seedTestStaff()

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'test.png', {
      type: 'image/png',
    })
    const formData = new FormData()
    formData.append('file', file)

    const res = await app.request(`/v1/staff/${staff.id}/avatar`, {
      method: 'POST',
      headers,
      body: formData,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.avatar_url).toBeTruthy()
    expect(typeof body.avatar_url).toBe('string')

    // Verify the DB was updated with the avatar URL
    const updated = await testPrisma.staff.findUnique({
      where: { id: staff.id },
      select: { avatarUrl: true },
    })
    expect(updated?.avatarUrl).toBe(body.avatar_url)
  })

  it.skip(
    'integration: uploads real file to Supabase (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)',
    async () => {
      // Remove .skip once SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in .env.
      // Also ensure the "avatars" bucket exists and is publicly readable in Supabase.
      //
      // You will also need to remove the vi.mock at the top of this file (or move
      // this test to a separate file that does NOT mock storage).
      const staff = await seedTestStaff()

      const file = new File([new Uint8Array([137, 80, 78, 71])], 'test.png', {
        type: 'image/png',
      })
      const formData = new FormData()
      formData.append('file', file)

      const res = await app.request(`/v1/staff/${staff.id}/avatar`, {
        method: 'POST',
        headers,
        body: formData,
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.avatar_url).toBeTruthy()

      const updated = await testPrisma.staff.findUnique({
        where: { id: staff.id },
        select: { avatarUrl: true },
      })
      expect(updated?.avatarUrl).toBe(body.avatar_url)

      // Cleanup: delete the uploaded file from Supabase storage
      // (Remove vi.mock from this file first when doing real integration)
    },
  )
})
