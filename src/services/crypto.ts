import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM envelope: [12-byte IV][16-byte auth tag][ciphertext]
const IV_BYTES = 12
const TAG_BYTES = 16

function getKey(): Buffer {
  const raw = process.env.SYNC_CRYPTO_KEY
  if (!raw) throw new Error('SYNC_CRYPTO_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(`SYNC_CRYPTO_KEY must decode to 32 bytes (got ${key.length})`)
  }
  return key
}

export function encryptJson(payload: unknown): Uint8Array<ArrayBuffer> {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  const concat = Buffer.concat([iv, tag, ciphertext])
  // Produce a Uint8Array whose backing buffer is an ArrayBuffer (not SharedArrayBuffer),
  // which is what Prisma's Bytes field requires.
  const out = new Uint8Array(new ArrayBuffer(concat.length))
  out.set(concat)
  return out
}

export function decryptJson<T = unknown>(envelope: Uint8Array): T {
  const key = getKey()
  if (envelope.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted envelope is truncated')
  }
  const buf = Buffer.from(envelope)
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8')) as T
}
