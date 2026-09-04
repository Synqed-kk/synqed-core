import { afterEach, describe, expect, it } from 'vitest'
import app from '../src/index.js'
import { prisma } from '../src/db/client.js'
import {
  cleanupTestData,
  seedTestCustomer,
  seedTestStaff,
  TEST_API_KEY,
  TEST_BUSINESS_ID,
} from './setup.js'

process.env.API_KEYS = TEST_API_KEY

const headers = {
  'x-api-key': TEST_API_KEY,
  'x-business-id': TEST_BUSINESS_ID,
  'Content-Type': 'application/json',
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers }
  if (body) init.body = JSON.stringify(body)
  return app.request(`/v1${path}`, init)
}

describe('Karute records — discarded status', () => {
  const recordingSessionIds: string[] = []

  afterEach(async () => {
    await cleanupTestData()
    await prisma.recordingSession.deleteMany({ where: { id: { in: recordingSessionIds } } })
    recordingSessionIds.length = 0
  })

  it('accepts DISCARDED when creating a record', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()

    const response = await req('POST', '/karute-records', {
      customer_id: customer.id,
      staff_id: staff.id,
      status: 'DISCARDED',
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ status: 'DISCARDED' })
  })

  it('accepts a saved record being updated to DISCARDED', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const createResponse = await req('POST', '/karute-records', {
      customer_id: customer.id,
      staff_id: staff.id,
      status: 'DRAFT',
    })
    const record = await createResponse.json()

    const response = await req('PUT', `/karute-records/${record.id}`, {
      status: 'DISCARDED',
      actor_staff_id: staff.id,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: record.id, status: 'DISCARDED' })
  })

  it('excludes discarded records from list and get unless explicitly included', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const activeResponse = await req('POST', '/karute-records', {
      customer_id: customer.id,
      staff_id: staff.id,
      status: 'APPROVED',
    })
    const active = await activeResponse.json()
    const discardedResponse = await req('POST', '/karute-records', {
      customer_id: customer.id,
      staff_id: staff.id,
      status: 'DISCARDED',
    })
    const discarded = await discardedResponse.json()

    const defaultListResponse = await req('GET', '/karute-records')
    expect(defaultListResponse.status).toBe(200)
    const defaultList = await defaultListResponse.json()
    expect(defaultList.karute_records.map((record: { id: string }) => record.id)).toEqual([
      active.id,
    ])
    expect(defaultList.total).toBe(1)

    const defaultGet = await req('GET', `/karute-records/${discarded.id}`)
    expect(defaultGet.status).toBe(404)

    const firstPageResponse = await req(
      'GET',
      '/karute-records?include_discarded=true&page_size=1&page=1',
    )
    const secondPageResponse = await req(
      'GET',
      '/karute-records?include_discarded=true&page_size=1&page=2',
    )
    expect(firstPageResponse.status).toBe(200)
    expect(secondPageResponse.status).toBe(200)
    const firstPage = await firstPageResponse.json()
    const secondPage = await secondPageResponse.json()
    expect(
      [...firstPage.karute_records, ...secondPage.karute_records].map(
        (record: { id: string }) => record.id,
      ),
    ).toEqual(expect.arrayContaining([active.id, discarded.id]))
    expect(firstPage.total).toBe(1)
    expect(firstPage.discarded_count).toBe(1)
    expect(firstPage.total + firstPage.discarded_count).toBe(2)

    const includedGet = await req(
      'GET',
      `/karute-records/${discarded.id}?include_discarded=true`,
    )
    expect(includedGet.status).toBe(200)
    expect(await includedGet.json()).toMatchObject({ id: discarded.id, status: 'DISCARDED' })
  })

  it('always finds a discarded record by recording session, including on create retry', async () => {
    const customer = await seedTestCustomer()
    const staff = await seedTestStaff()
    const session = await prisma.recordingSession.create({
      data: { businessId: TEST_BUSINESS_ID, staffId: staff.id },
    })
    recordingSessionIds.push(session.id)
    const input = {
      customer_id: customer.id,
      staff_id: staff.id,
      recording_session_id: session.id,
      status: 'DISCARDED',
    }
    const createResponse = await req('POST', '/karute-records', input)
    const record = await createResponse.json()

    const byRecording = await req('GET', `/karute-records/by-recording/${session.id}`)
    expect(byRecording.status).toBe(200)
    expect(await byRecording.json()).toMatchObject({ id: record.id, status: 'DISCARDED' })

    const retry = await req('POST', '/karute-records', input)
    expect(retry.status).toBe(201)
    expect(await retry.json()).toMatchObject({ id: record.id, status: 'DISCARDED' })
  })
})
