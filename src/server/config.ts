import '@tanstack/react-start/server-only'

export class ServerConfigError extends Error {
  readonly variables: ReadonlyArray<string>

  constructor(variables: ReadonlyArray<string>, detail?: string) {
    super(
      `Invalid server configuration: ${variables.join(', ')}${detail ? ` (${detail})` : ''}`,
    )
    this.name = 'ServerConfigError'
    this.variables = variables
  }
}

export interface MailboxRuntimeConfig {
  siteName: string
  domain: string
  ttlSeconds: number
  pollIntervalMs: number
}

export interface MailtrapRuntimeConfig {
  apiToken: string
  inboxId: string
  webhookSecret: string
}

const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

function readString(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new ServerConfigError([name], 'missing')
  }

  return value
}

function readInteger(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name]?.trim()

  if (!raw) {
    return fallback
  }

  const value = Number(raw)

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ServerConfigError(
      [name],
      `expected an integer between ${min} and ${max}`,
    )
  }

  return value
}

export function getMailboxConfig(): MailboxRuntimeConfig {
  const siteName = process.env.SITE_NAME?.trim() || 'ASTMS'
  const domain = readString('MAILBOX_DOMAIN').toLowerCase()

  if (!DOMAIN_PATTERN.test(domain)) {
    throw new ServerConfigError(['MAILBOX_DOMAIN'], 'expected a bare hostname')
  }

  const ttlSeconds = readInteger('MAILBOX_TTL_SECONDS', 90, 1, 86_400)
  const pollIntervalSeconds = readInteger(
    'MAILBOX_POLL_INTERVAL_SECONDS',
    10,
    1,
    300,
  )

  return {
    siteName,
    domain,
    ttlSeconds,
    pollIntervalMs: pollIntervalSeconds * 1_000,
  }
}

export function getMailtrapConfig(): MailtrapRuntimeConfig {
  const apiToken = readString('MAILTRAP_API_TOKEN')
  const inboxId = readString('MAILTRAP_INBOX_ID')
  const webhookSecret = readString('MAILTRAP_WEBHOOK_SIGNING_SECRET')

  if (!/^\d+$/.test(inboxId)) {
    throw new ServerConfigError(['MAILTRAP_INBOX_ID'], 'expected an integer')
  }

  return { apiToken, inboxId, webhookSecret }
}

export function getCronSecret(): string {
  return readString('CRON_SECRET')
}

export function validateServerConfig(): void {
  const problems: Array<string> = []

  if (!process.env.DATABASE_URL?.trim()) {
    problems.push('DATABASE_URL')
  }

  for (const getter of [getMailboxConfig, getMailtrapConfig, getCronSecret]) {
    try {
      getter()
    } catch (error) {
      if (error instanceof ServerConfigError) {
        problems.push(...error.variables)
      } else {
        throw error
      }
    }
  }

  if (problems.length > 0) {
    throw new ServerConfigError([...new Set(problems)])
  }
}
