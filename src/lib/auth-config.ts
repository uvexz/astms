import '@tanstack/react-start/server-only'

import { createHash } from 'node:crypto'

import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db'
import * as schema from '#/db/schema'
import { ServerConfigError } from '#/server/config'

const DEFAULT_SB_ISSUER = 'https://sb.sb/oidc'
const DEFAULT_SB_SCOPES = ['openid', 'profile', 'offline_access']
const SYNTHETIC_EMAIL_DOMAIN = '@oauth.invalid'
const EMAIL_PASSWORD_MIN_LENGTH = 8
const EMAIL_PASSWORD_MAX_LENGTH = 128

export interface AuthProviderAvailability {
  github: boolean
  google: boolean
  sb: boolean
}

interface ProviderCredentials {
  clientId: string
  clientSecret: string
}

function readTrimmed(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function requireVariable(name: string): string {
  const value = readTrimmed(name)

  if (!value) {
    throw new ServerConfigError([name], 'missing')
  }

  return value
}

function readProviderCredentials(
  idVariable: string,
  secretVariable: string,
): ProviderCredentials | null {
  const clientId = readTrimmed(idVariable)
  const clientSecret = readTrimmed(secretVariable)

  if (!clientId || !clientSecret) {
    return null
  }

  return { clientId, clientSecret }
}

export function getAuthBaseUrl(): string {
  const raw = requireVariable('BETTER_AUTH_URL')

  try {
    const url = new URL(raw)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }

    return url.origin
  } catch {
    throw new ServerConfigError(
      ['BETTER_AUTH_URL'],
      'expected an absolute http(s) URL',
    )
  }
}

export function getAuthSecret(): string {
  const secret = requireVariable('BETTER_AUTH_SECRET')

  if (secret.length < 32) {
    throw new ServerConfigError(
      ['BETTER_AUTH_SECRET'],
      'expected at least 32 characters',
    )
  }

  return secret
}

export function getAuthProviderAvailability(): AuthProviderAvailability {
  return {
    github:
      readProviderCredentials('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET') !==
      null,
    google:
      readProviderCredentials('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET') !==
      null,
    sb:
      readProviderCredentials('SB_OIDC_CLIENT_ID', 'SB_OIDC_CLIENT_SECRET') !==
      null,
  }
}

export function isAuthConfigured(): boolean {
  try {
    getAuthBaseUrl()
    getAuthSecret()
    return true
  } catch {
    return false
  }
}

/**
 * Account/password sign-in is opt-in through EMAIL_PASS_LOGIN=1|true.
 * It stays off by default so the deployment can offer third-party login only.
 */
export function isEmailPasswordLoginEnabled(): boolean {
  const raw = process.env.EMAIL_PASS_LOGIN?.trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

export function sha256Subject(subject: string | number): string {
  return createHash('sha256').update(String(subject)).digest('hex').slice(0, 32)
}

export function syntheticEmail(
  providerId: 'github' | 'google' | 'sb',
  subject: string | number,
): string {
  return `${providerId}-${sha256Subject(subject)}@oauth.invalid`
}

function getSbIssuer(): string {
  return readTrimmed('SB_OIDC_ISSUER') ?? DEFAULT_SB_ISSUER
}

function getSbScopes(): string[] {
  const raw = readTrimmed('SB_OIDC_SCOPES')

  if (!raw) {
    return [...DEFAULT_SB_SCOPES]
  }

  const scopes = raw.split(/\s+/).filter(Boolean)
  return scopes.length > 0 ? scopes : [...DEFAULT_SB_SCOPES]
}

function getSbRedirectUri(baseURL: string): string {
  return (
    readTrimmed('SB_OIDC_REDIRECT_URI') ?? `${baseURL}/api/auth/callback/sb`
  )
}

function getTrustedOrigins(baseURL: string): string[] {
  const configured = readTrimmed('BETTER_AUTH_TRUSTED_ORIGINS')

  if (!configured) {
    return [baseURL]
  }

  return [
    ...new Set([
      baseURL,
      ...configured
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ]),
  ]
}

export function createAuthOptions(): BetterAuthOptions {
  const baseURL = getAuthBaseUrl()
  const emailPasswordLoginEnabled = isEmailPasswordLoginEnabled()
  const github = readProviderCredentials(
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
  )
  const google = readProviderCredentials(
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  )
  const sb = readProviderCredentials(
    'SB_OIDC_CLIENT_ID',
    'SB_OIDC_CLIENT_SECRET',
  )
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {}

  if (github) {
    socialProviders.github = {
      clientId: github.clientId,
      clientSecret: github.clientSecret,
      mapProfileToUser: (profile) => ({
        email: syntheticEmail('github', profile.id),
        emailVerified: false,
        name: (profile.name || '').trim() || profile.login || 'GitHub 用户',
        image: profile.avatar_url,
      }),
    }
  }

  if (google) {
    socialProviders.google = {
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      mapProfileToUser: (profile) => ({
        email: syntheticEmail('google', profile.sub),
        emailVerified: false,
        name: (profile.name || '').trim() || 'Google 用户',
        image: profile.picture,
      }),
    }
  }

  const plugins: Array<BetterAuthPlugin> = []

  if (sb) {
    const issuer = getSbIssuer().replace(/\/+$/, '')

    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: 'sb',
            name: 'SB.SB',
            discoveryUrl: `${issuer}/.well-known/openid-configuration`,
            clientId: sb.clientId,
            clientSecret: sb.clientSecret,
            scopes: getSbScopes(),
            redirectURI: getSbRedirectUri(baseURL),
            pkce: true,
            responseType: 'code',
            authentication: 'post',
            disableProviderLogout: true,
            mapProfileToUser: (profile) => {
              const subject = profile.sub ?? profile.id

              if (
                subject === null ||
                subject === undefined ||
                String(subject).length === 0
              ) {
                throw new Error('SB.SB profile is missing a stable subject')
              }

              const name =
                typeof profile.name === 'string' && profile.name.trim()
                  ? profile.name.trim()
                  : typeof profile.preferred_username === 'string' &&
                      profile.preferred_username.trim()
                    ? profile.preferred_username.trim()
                    : 'SB.SB 用户'

              return {
                email: syntheticEmail('sb', subject),
                emailVerified: false,
                name,
                image:
                  typeof profile.picture === 'string'
                    ? profile.picture
                    : undefined,
              }
            },
          },
        ],
      }),
    )
  }

  plugins.push(tanstackStartCookies())

  return {
    appName: process.env.SITE_NAME?.trim() || 'ASTMS',
    baseURL,
    secret: getAuthSecret(),
    trustedOrigins: getTrustedOrigins(baseURL),
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    emailAndPassword: {
      enabled: emailPasswordLoginEnabled,
      autoSignIn: true,
      minPasswordLength: EMAIL_PASSWORD_MIN_LENGTH,
      maxPasswordLength: EMAIL_PASSWORD_MAX_LENGTH,
    },
    account: {
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            // Credential sign-up must not claim the internal namespace used for
            // OAuth placeholder emails. Otherwise a pre-registered row could
            // block the real third-party account from signing in later.
            if (
              context?.path === '/sign-up/email' &&
              user.email.toLowerCase().endsWith(SYNTHETIC_EMAIL_DOMAIN)
            ) {
              throw new APIError('BAD_REQUEST', {
                code: 'INVALID_EMAIL',
                message: 'Email address is reserved',
              })
            }
          },
        },
      },
    },
    advanced: { ipAddress: { disableIpTracking: true } },
    socialProviders,
    plugins,
  }
}
