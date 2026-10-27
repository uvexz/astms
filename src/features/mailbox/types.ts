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
  | { status: 'address_in_use'; message: string }
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
  { status: 'active'; latestMessageId: string | null } | { status: 'expired' }

export interface DashboardMailbox {
  id: string
  address: string
  createdAt: string
  lastSeenAt: string
}

export interface DashboardConfig {
  siteName: string
  domain: string
  pollIntervalMs: number
  limit: number
  prefixMinLength: number
  prefixMaxLength: number
  prefixRuleMessage: string
  messageLimit: number
}

export type ListMyMailboxesResult =
  | {
      status: 'ok'
      mailboxes: Array<DashboardMailbox>
      limit: number
    }
  | { status: 'unauthenticated' }

export type CreateMyMailboxResult =
  | {
      status: 'active'
      mailbox: DashboardMailbox
      created: boolean
      evictedAddress: string | null
    }
  | { status: 'invalid_prefix'; message: string }
  | { status: 'address_in_use'; message: string }
  | { status: 'rate_limited'; message: string }
  | { status: 'unauthenticated' }
  | { status: 'unavailable'; message: string }

export type MyMailboxSnapshotResult =
  | {
      status: 'active'
      mailbox: DashboardMailbox
      messages: Array<MailboxMessageView>
    }
  | { status: 'not_found' }
  | { status: 'unauthenticated' }

export type DeleteMyMailboxResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'rate_limited'; message: string }
  | { status: 'unauthenticated' }
