import { describe, expect, test } from 'bun:test'

import { createHmac } from 'node:crypto'

import { verifyMailtrapSignature } from './signature'

const SECRET = '0123456789abcdef0123456789abcdef'
const BODY = new TextEncoder().encode('{"events":[]}')

function sign(body: Uint8Array, secret = SECRET) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyMailtrapSignature', () => {
  test('accepts a correct signature', () => {
    expect(verifyMailtrapSignature(BODY, sign(BODY), SECRET)).toBe(true)
  })

  test('accepts an uppercase hex signature', () => {
    expect(
      verifyMailtrapSignature(BODY, sign(BODY).toUpperCase(), SECRET),
    ).toBe(true)
  })

  test('rejects a missing signature', () => {
    expect(verifyMailtrapSignature(BODY, null, SECRET)).toBe(false)
  })

  test('rejects an incorrect signature', () => {
    expect(verifyMailtrapSignature(BODY, sign(BODY, 'other'), SECRET)).toBe(
      false,
    )
  })

  test('rejects malformed signatures without throwing', () => {
    expect(verifyMailtrapSignature(BODY, 'not-a-signature', SECRET)).toBe(false)
  })

  test('verifies the exact raw bytes, not a reserialized payload', () => {
    const padded = new TextEncoder().encode('{"events":[]}  ')
    expect(verifyMailtrapSignature(padded, sign(BODY), SECRET)).toBe(false)
    expect(verifyMailtrapSignature(padded, sign(padded), SECRET)).toBe(true)
  })
})
