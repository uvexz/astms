import { describe, expect, test } from 'bun:test'

import { checkAuthEndpointRateLimit, readClientIp } from './auth-rate-limit'

function attempt(
  pathname: string,
  ip: string,
  now: number,
  times: number,
): Array<boolean> {
  return Array.from({ length: times }, () =>
    checkAuthEndpointRateLimit({ pathname, ip, now }),
  )
}

describe('auth endpoint rate limit', () => {
  test('allows ten email sign-in attempts per window', () => {
    const results = attempt(
      '/api/auth/sign-in/email',
      'ip-signin',
      1_000_000,
      11,
    )

    expect(results.filter(Boolean)).toHaveLength(10)
    expect(results.at(-1)).toBe(false)
  })

  test('allows five email sign-up attempts per window', () => {
    const results = attempt(
      '/api/auth/sign-up/email',
      'ip-signup',
      2_000_000,
      6,
    )

    expect(results.filter(Boolean)).toHaveLength(5)
    expect(results.at(-1)).toBe(false)
  })

  test('limits social sign-in as well', () => {
    const results = attempt(
      '/api/auth/sign-in/social',
      'ip-social',
      3_000_000,
      11,
    )

    expect(results.filter(Boolean)).toHaveLength(10)
    expect(results.at(-1)).toBe(false)
  })

  test('resets after the window elapses', () => {
    expect(
      attempt('/api/auth/sign-in/email', 'ip-reset', 4_000_000, 10).at(-1),
    ).toBe(true)
    expect(
      checkAuthEndpointRateLimit({
        pathname: '/api/auth/sign-in/email',
        ip: 'ip-reset',
        now: 4_060_001,
      }),
    ).toBe(true)
  })

  test('keeps buckets separate per ip and endpoint', () => {
    expect(
      attempt('/api/auth/sign-in/email', 'ip-a', 5_000_000, 10).at(-1),
    ).toBe(true)
    expect(
      checkAuthEndpointRateLimit({
        pathname: '/api/auth/sign-up/email',
        ip: 'ip-a',
        now: 5_000_000,
      }),
    ).toBe(true)
    expect(
      checkAuthEndpointRateLimit({
        pathname: '/api/auth/sign-in/email',
        ip: 'ip-b',
        now: 5_000_000,
      }),
    ).toBe(true)
  })

  test('ignores unrelated auth endpoints and paths', () => {
    expect(
      checkAuthEndpointRateLimit({
        pathname: '/api/auth/get-session',
        ip: 'ip-other',
        now: 6_000_000,
      }),
    ).toBe(true)
    expect(
      checkAuthEndpointRateLimit({
        pathname: '/api/webhooks/mailtrap/inbound',
        ip: 'ip-other',
        now: 6_000_000,
      }),
    ).toBe(true)
  })
})

describe('client ip extraction', () => {
  test('prefers the first forwarded address', () => {
    const headers = new Headers({
      'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1',
      'x-real-ip': '198.51.100.2',
    })

    expect(readClientIp(headers)).toBe('203.0.113.7')
  })

  test('falls back to x-real-ip and then a shared bucket key', () => {
    expect(readClientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe(
      '198.51.100.2',
    )
    expect(readClientIp(new Headers())).toBe('unknown')
  })
})
