import '@tanstack/react-start/server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyMailtrapSignature(
  rawBody: Uint8Array,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) {
    return false
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = signature.trim().toLowerCase()

  if (provided.length !== expected.length) {
    return false
  }

  return timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(provided, 'utf8'),
  )
}
