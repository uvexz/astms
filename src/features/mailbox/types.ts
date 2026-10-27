export type MailboxPhase = 'idle' | 'creating' | 'active' | 'expired'

export interface MailboxMessageView {
  id: string
  fromAddress: string | null
  subject: string | null
  textBody: string | null
  htmlBody: string | null
  receivedAt: string
}

export interface MailboxPublicConfig {
  siteName: string
  domain: string
  ttlSeconds: number
  pollIntervalMs: number
  prefixMinLength: number
  prefixMaxLength: number
  prefixRuleMessage: string
}

export type CreateMailboxResult =
  | {
      status: 'active'
      mailboxId: string
      address: string
      expiresAt: string
      serverNow: string
      joinedExisting: boolean
      pollIntervalMs: number
    }
  | { status: 'invalid_prefix'; message: string }
  | { status: 'rate_limited'; message: string }
  | { status: 'unavailable'; message: string }

export type MailboxSnapshotResult =
  | {
      status: 'active'
      mailboxId: string
      address: string
      expiresAt: string
      serverNow: string
      pollIntervalMs: number
      messages: Array<MailboxMessageView>
    }
  | { status: 'expired' }

export type MailboxPeekResult =
  | { status: 'active'; latestMessageId: string | null }
  | { status: 'expired' }
