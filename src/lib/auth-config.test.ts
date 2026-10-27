import { afterEach, describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file::memory:'

const {
  getAuthProviderAvailability,
  isAuthConfigured,
  isEmailPasswordLoginEnabled,
  sha256Subject,
  syntheticEmail,
} = await import('#/lib/auth-config')

const MUTATED_VARIABLES = [
  'EMAIL_PASS_LOGIN',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SB_OIDC_CLIENT_ID',
  'SB_OIDC_CLIENT_SECRET',
] as const

const snapshot = new Map(
  MUTATED_VARIABLES.map((name) => [name, process.env[name]]),
)

function restoreEnvironment() {
  for (const name of MUTATED_VARIABLES) {
    const value = snapshot.get(name)

    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
}

afterEach(restoreEnvironment)

describe('email password login flag', () => {
  test('is disabled when EMAIL_PASS_LOGIN is missing or empty', () => {
    delete process.env.EMAIL_PASS_LOGIN
    expect(isEmailPasswordLoginEnabled()).toBe(false)

    process.env.EMAIL_PASS_LOGIN = ''
    expect(isEmailPasswordLoginEnabled()).toBe(false)

    process.env.EMAIL_PASS_LOGIN = '   '
    expect(isEmailPasswordLoginEnabled()).toBe(false)
  })

  test('accepts 1 and true, case-insensitively and after trim', () => {
    process.env.EMAIL_PASS_LOGIN = '1'
    expect(isEmailPasswordLoginEnabled()).toBe(true)

    process.env.EMAIL_PASS_LOGIN = 'true'
    expect(isEmailPasswordLoginEnabled()).toBe(true)

    process.env.EMAIL_PASS_LOGIN = ' TRUE '
    expect(isEmailPasswordLoginEnabled()).toBe(true)
  })

  test('does not accept other truthy-looking values', () => {
    for (const value of ['0', 'false', 'yes', 'on', '2']) {
      process.env.EMAIL_PASS_LOGIN = value
      expect(isEmailPasswordLoginEnabled()).toBe(false)
    }
  })
})

describe('synthetic OAuth emails', () => {
  test('builds a stable hashed placeholder per provider and subject', () => {
    const email = syntheticEmail('github', 42)

    expect(email).toMatch(/^github-[0-9a-f]{32}@oauth\.invalid$/)
    expect(email).toBe(syntheticEmail('github', 42))
    expect(email).not.toBe(syntheticEmail('github', 43))
    expect(syntheticEmail('google', 42)).toMatch(
      /^google-[0-9a-f]{32}@oauth\.invalid$/,
    )
    expect(syntheticEmail('sb', 'user-1')).toMatch(
      /^sb-[0-9a-f]{32}@oauth\.invalid$/,
    )
  })

  test('hashes subjects to the same 32 characters for every provider', () => {
    expect(syntheticEmail('sb', 'node|7')).toContain(
      `sb-${sha256Subject('node|7')}`,
    )
    expect(sha256Subject('node|7')).toHaveLength(32)
  })
})

describe('provider availability', () => {
  test('reports no providers when credentials are missing', () => {
    for (const name of MUTATED_VARIABLES) {
      if (name.endsWith('_CLIENT_ID') || name.endsWith('_CLIENT_SECRET')) {
        delete process.env[name]
      }
    }

    expect(getAuthProviderAvailability()).toEqual({
      github: false,
      google: false,
      sb: false,
    })
  })

  test('requires both client id and secret for a provider', () => {
    process.env.GITHUB_CLIENT_ID = 'github-id'
    delete process.env.GITHUB_CLIENT_SECRET
    process.env.GOOGLE_CLIENT_ID = 'google-id'
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
    process.env.SB_OIDC_CLIENT_ID = 'sb-id'
    process.env.SB_OIDC_CLIENT_SECRET = 'sb-secret'

    expect(getAuthProviderAvailability()).toEqual({
      github: false,
      google: true,
      sb: true,
    })
  })
})

describe('auth configuration readiness', () => {
  test('is not ready without base URL or with a short secret', () => {
    delete process.env.BETTER_AUTH_URL
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(43)
    expect(isAuthConfigured()).toBe(false)

    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    process.env.BETTER_AUTH_SECRET = 'too-short'
    expect(isAuthConfigured()).toBe(false)

    process.env.BETTER_AUTH_URL = 'not-a-url'
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(43)
    expect(isAuthConfigured()).toBe(false)
  })

  test('is ready with an absolute URL and a 32+ character secret', () => {
    process.env.BETTER_AUTH_URL = 'http://localhost:3000/'
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(43)
    expect(isAuthConfigured()).toBe(true)
  })
})
