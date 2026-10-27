import { createFileRoute } from '@tanstack/react-router'

import { timingSafeEqual } from 'node:crypto'

import { db } from '#/db'
import { cleanupExpiredMailboxes } from '#/features/mailbox/mailbox-service'
import { getCronSecret, ServerConfigError } from '#/server/config'

const CLEANUP_LIMIT = 500

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function matchesCronSecret(authorization: string | null, expected: string) {
  const provided = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  const left = Buffer.from(provided, 'utf8')
  const right = Buffer.from(expected, 'utf8')

  if (left.length !== right.length) {
    timingSafeEqual(right, right)
    return false
  }

  return timingSafeEqual(left, right)
}

export const Route = createFileRoute('/api/internal/cleanup')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const secret = getCronSecret()

          if (
            !matchesCronSecret(request.headers.get('authorization'), secret)
          ) {
            return json({ error: 'unauthorized' }, 401)
          }

          const result = await cleanupExpiredMailboxes({
            db,
            limit: CLEANUP_LIMIT,
          })

          return json({ ok: true, ...result }, 200)
        } catch (error) {
          if (error instanceof ServerConfigError) {
            console.error('[cleanup] unavailable', error.variables.join(','))
            return json({ error: 'unavailable' }, 500)
          }

          console.error(
            '[cleanup] failed',
            error instanceof Error ? error.name : 'unknown',
          )
          return json({ error: 'internal_error' }, 500)
        }
      },
      GET: () => json({ error: 'method_not_allowed' }, 405),
    },
  },
})
