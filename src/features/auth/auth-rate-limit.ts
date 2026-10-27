import '@tanstack/react-start/server-only'

import { consumeRateLimit } from '#/server/rate-limit'

const WINDOW_MS = 60_000

interface AuthRateLimitRule {
  key: string
  limit: number
}

const RATE_LIMIT_RULES: ReadonlyArray<{
  suffix: string
  rule: AuthRateLimitRule
}> = [
  { suffix: '/sign-in/email', rule: { key: 'auth-sign-in-email', limit: 10 } },
  { suffix: '/sign-up/email', rule: { key: 'auth-sign-up-email', limit: 5 } },
  {
    suffix: '/sign-in/social',
    rule: { key: 'auth-sign-in-social', limit: 10 },
  },
]

/**
 * Better Auth rate limiting is disabled because ASTMS turns off IP tracking,
 * so the auth catch-all route applies its own per-IP limits to the credential
 * and social entry points. Single-process memory storage, same as the rest of
 * the app.
 */
export function checkAuthEndpointRateLimit(options: {
  pathname: string
  ip: string
  now?: number
}): boolean {
  const matched = RATE_LIMIT_RULES.find((entry) =>
    options.pathname.endsWith(entry.suffix),
  )

  if (!matched) {
    return true
  }

  return consumeRateLimit(
    `${matched.rule.key}:${options.ip}`,
    matched.rule.limit,
    WINDOW_MS,
    options.now,
  )
}

/**
 * Auth routes are served by the catch-all route handler, outside the Server
 * Function request context, so the client IP is read from the same proxy
 * headers the rest of the app trusts.
 */
export function readClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')

  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()

    if (first) {
      return first
    }
  }

  return headers.get('x-real-ip')?.trim() || 'unknown'
}
