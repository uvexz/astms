import { createFileRoute } from '@tanstack/react-router'

import {
  checkAuthEndpointRateLimit,
  readClientIp,
} from '#/features/auth/auth-rate-limit'
import { getAuth } from '#/lib/auth'
import { ServerConfigError } from '#/server/config'

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function rateLimitedResponse() {
  return new Response(
    JSON.stringify({
      code: 'RATE_LIMITED',
      message: 'Too many authentication attempts',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '60',
      },
    },
  )
}

async function handleAuthRequest(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    const allowed = checkAuthEndpointRateLimit({
      pathname: new URL(request.url).pathname,
      ip: readClientIp(request.headers),
    })

    if (!allowed) {
      return rateLimitedResponse()
    }
  }

  try {
    const response = await getAuth().handler(request)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    if (error instanceof ServerConfigError) {
      console.error('[auth] unavailable', error.variables.join(','))
      return json({ error: 'auth_unavailable' }, 503)
    }

    console.error(
      '[auth] request failed',
      error instanceof Error ? error.name : 'unknown',
    )

    return json({ error: 'internal_error' }, 500)
  }
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
