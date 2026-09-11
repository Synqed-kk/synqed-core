import { describe, it, expect, vi, afterEach } from 'vitest'
import app from '../src/index.js'
import { TEST_API_KEY, TEST_BUSINESS_ID } from './setup.js'
import { REQUEST_ID_HEADER } from '../src/middleware/request-context.js'

process.env.API_KEYS = TEST_API_KEY

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

afterEach(() => {
  vi.restoreAllMocks()
})

/** Collect the structured lines this request emitted. */
function captureLogs() {
  const lines: Record<string, unknown>[] = []
  const grab = (raw: unknown) => {
    if (typeof raw !== 'string') return
    try {
      lines.push(JSON.parse(raw))
    } catch {
      /* not one of ours */
    }
  }
  vi.spyOn(console, 'log').mockImplementation(grab)
  vi.spyOn(console, 'warn').mockImplementation(grab)
  vi.spyOn(console, 'error').mockImplementation(grab)
  return lines
}

describe('request id', () => {
  it('generates one when the caller sends none', async () => {
    const res = await app.request('/v1/health')
    const id = res.headers.get(REQUEST_ID_HEADER)
    expect(id).toMatch(UUID_RE)
  })

  it('echoes the caller-supplied id so both sides log the same key', async () => {
    // Core's audit table always had a request_id column; nothing on the HTTP
    // path produced one, so a Karute 500 could not be traced to the core call
    // behind it. This is that link.
    const res = await app.request('/v1/health', {
      headers: { [REQUEST_ID_HEADER]: 'karute-abc-123' },
    })
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('karute-abc-123')
  })

  it('is present on an UNAUTHENTICATED failure', async () => {
    // requestContext runs before auth on purpose: a 401 storm is a real
    // incident shape, and it is useless without correlation.
    const res = await app.request('/v1/customers')
    expect(res.status).toBe(401)
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_RE)
  })
})

describe('request id — untrusted input', () => {
  it('replaces an id containing characters it did not allow', async () => {
    // A caller-supplied header lands in a JSON log line and in a response
    // header, so it is untrusted input and gets an allowlist. A raw newline
    // cannot reach us (undici rejects the header outright), but quotes and
    // spaces travel fine and have no business in an id.
    const res = await app.request('/v1/health', {
      headers: { [REQUEST_ID_HEADER]: 'abc" injected="yes' },
    })
    const id = res.headers.get(REQUEST_ID_HEADER)
    expect(id).toMatch(UUID_RE)
    expect(id).not.toContain('injected')
  })

  it('replaces an over-long id', async () => {
    const res = await app.request('/v1/health', {
      headers: { [REQUEST_ID_HEADER]: 'x'.repeat(500) },
    })
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_RE)
  })

  it('replaces an empty id', async () => {
    const res = await app.request('/v1/health', {
      headers: { [REQUEST_ID_HEADER]: '   ' },
    })
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_RE)
  })
})

describe('access log', () => {
  it('emits one structured http line per request', async () => {
    const lines = captureLogs()
    await app.request('/v1/health')

    const http = lines.filter((l) => l.evt === 'http')
    expect(http).toHaveLength(1)
    expect(http[0]).toMatchObject({
      severity: 'info',
      detail: { method: 'GET', path: '/v1/health', status: 200 },
    })
    expect(typeof (http[0].detail as { duration_ms: number }).duration_ms).toBe(
      'number',
    )
  })

  it('ties the log line to the same id the caller was handed back', async () => {
    const lines = captureLogs()
    const res = await app.request('/v1/health', {
      headers: { [REQUEST_ID_HEADER]: 'trace-me-42' },
    })

    const http = lines.find((l) => l.evt === 'http')
    expect(http?.request_id).toBe('trace-me-42')
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('trace-me-42')
  })

  it('logs a 4xx at warning, not info', async () => {
    const lines = captureLogs()
    await app.request('/v1/customers')

    const http = lines.find((l) => l.evt === 'http')
    expect(http?.severity).toBe('warning')
    expect((http?.detail as { status: number }).status).toBe(401)
  })

  it('carries business_id once auth has resolved it', async () => {
    const lines = captureLogs()
    await app.request('/v1/customers', {
      headers: {
        'x-api-key': TEST_API_KEY,
        'x-business-id': TEST_BUSINESS_ID,
      },
    })

    const http = lines.find((l) => l.evt === 'http')
    expect(http?.business_id).toBe(TEST_BUSINESS_ID)
  })

  it('emits valid JSON with a timestamp on every line', async () => {
    const lines = captureLogs()
    await app.request('/v1/health')

    for (const line of lines) {
      expect(typeof line.at).toBe('string')
      expect(Number.isNaN(Date.parse(line.at as string))).toBe(false)
      expect(line.evt).toBeTruthy()
    }
  })
})
