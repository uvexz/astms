import '@tanstack/react-start/server-only'

import { randomUUID } from 'node:crypto'

import { and, desc, eq, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm'

import type { Database } from '#/db'
import { mailboxes, messages, webhookReceipts } from '#/db/schema'
import type { Mailbox } from '#/db/schema'
import { withWriteLock } from '#/server/write-lock'

import {
  formatMailboxAddress,
  generateRandomPrefix,
  normalizeAddress,
} from './address'
import { isUniqueConstraintError } from './db-errors'

const GENERATED_PREFIX_ATTEMPTS = 5
const SNAPSHOT_MESSAGE_LIMIT = 200
const DEFAULT_CLEANUP_RETENTION_SECONDS = 3_600
const DEFAULT_RECEIPT_RETENTION_SECONDS = 86_400
const DEFAULT_CLEANUP_LIMIT = 100

export interface CreatedMailbox {
  mailboxId: string
  address: string
  expiresAt: Date
  joinedExisting: boolean
}

export interface SnapshotMessage {
  id: string
  fromAddress: string | null
  subject: string | null
  textBody: string | null
  htmlBody: string | null
  receivedAt: Date
}

export type MailboxSnapshot =
  | {
      status: 'active'
      mailboxId: string
      address: string
      expiresAt: Date
      messages: Array<SnapshotMessage>
    }
  | { status: 'expired' }

export type MailboxPeek =
  { status: 'active'; latestMessageId: string | null } | { status: 'expired' }

export interface CleanupResult {
  ended: number
  deletedMailboxes: number
  deletedMessages: number
  deletedReceipts: number
}

interface CreateMailboxOptions {
  db: Database
  domain: string
  ttlSeconds: number
  now?: Date
}

interface CreateWithPrefixOptions extends CreateMailboxOptions {
  prefix: string
}

export class MailboxAddressInUseError extends Error {
  constructor() {
    super('Mailbox address is in use')
    this.name = 'MailboxAddressInUseError'
  }
}

async function findActiveMailbox(
  db: Database,
  address: string,
): Promise<Mailbox | undefined> {
  const rows = await db
    .select()
    .from(mailboxes)
    .where(
      and(
        eq(mailboxes.address, address),
        isNull(mailboxes.endedAt),
        isNull(mailboxes.userId),
      ),
    )
    .limit(1)

  return rows.at(0)
}

async function activeAddressExistsAnyOwner(
  db: Database,
  address: string,
): Promise<boolean> {
  const row = (
    await db
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(and(eq(mailboxes.address, address), isNull(mailboxes.endedAt)))
      .limit(1)
  ).at(0)

  return row !== undefined
}

async function tryCreateOrOpen(
  options: CreateMailboxOptions & { localPart: string; joinExisting: boolean },
): Promise<CreatedMailbox | null> {
  const now = options.now ?? new Date()
  const address = formatMailboxAddress(options.localPart, options.domain)
  const expiresAt = new Date(now.getTime() + options.ttlSeconds * 1_000)

  try {
    return await withWriteLock(() =>
      options.db.transaction(async (tx) => {
        await tx
          .update(mailboxes)
          .set({ endedAt: now })
          .where(
            and(
              eq(mailboxes.address, address),
              isNull(mailboxes.endedAt),
              isNull(mailboxes.userId),
              lte(mailboxes.expiresAt, now),
            ),
          )

        const existing = (
          await tx
            .select()
            .from(mailboxes)
            .where(
              and(
                eq(mailboxes.address, address),
                isNull(mailboxes.endedAt),
                isNull(mailboxes.userId),
              ),
            )
            .limit(1)
        ).at(0)

        if (existing) {
          if (!options.joinExisting) {
            return null
          }

          return {
            mailboxId: existing.id,
            address: existing.address,
            expiresAt: existing.expiresAt,
            joinedExisting: true,
          }
        }

        const mailboxId = randomUUID()

        await tx.insert(mailboxes).values({
          id: mailboxId,
          address,
          localPart: options.localPart,
          domain: options.domain,
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
        })

        return { mailboxId, address, expiresAt, joinedExisting: false }
      }),
    )
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const existing = await findActiveMailbox(options.db, address)

    if (existing && options.joinExisting) {
      return {
        mailboxId: existing.id,
        address: existing.address,
        expiresAt: existing.expiresAt,
        joinedExisting: true,
      }
    }

    if (existing) {
      return null
    }

    if (
      options.joinExisting &&
      (await activeAddressExistsAnyOwner(options.db, address))
    ) {
      throw new MailboxAddressInUseError()
    }

    throw error
  }
}

export async function createOrOpenMailbox(
  options: CreateMailboxOptions,
): Promise<CreatedMailbox> {
  const now = options.now ?? new Date()

  for (let attempt = 0; attempt < GENERATED_PREFIX_ATTEMPTS; attempt += 1) {
    const prefix = generateRandomPrefix()
    const created = await tryCreateOrOpen({
      ...options,
      now,
      localPart: prefix,
      joinExisting: false,
    })

    if (created) {
      return created
    }
  }

  throw new Error('Unable to allocate a random mailbox prefix')
}

export async function createMailboxWithPrefix(
  options: CreateWithPrefixOptions,
): Promise<CreatedMailbox> {
  const now = options.now ?? new Date()

  const mailbox = await tryCreateOrOpen({
    ...options,
    now,
    localPart: options.prefix,
    joinExisting: true,
  })

  if (mailbox) {
    return mailbox
  }

  if (
    await activeAddressExistsAnyOwner(
      options.db,
      formatMailboxAddress(options.prefix, options.domain),
    )
  ) {
    throw new MailboxAddressInUseError()
  }

  throw new Error('Unable to create mailbox')
}

export async function readMailboxSnapshot(options: {
  db: Database
  address: string
  ttlSeconds: number
  now?: Date
}): Promise<MailboxSnapshot> {
  const address = normalizeAddress(options.address)

  if (!address) {
    return { status: 'expired' }
  }

  const now = options.now ?? new Date()

  const result = await withWriteLock(() =>
    options.db.transaction(async (tx) => {
      await tx
        .update(mailboxes)
        .set({ endedAt: now })
        .where(
          and(
            eq(mailboxes.address, address),
            isNull(mailboxes.endedAt),
            isNull(mailboxes.userId),
            lte(mailboxes.expiresAt, now),
          ),
        )

      const mailbox = (
        await tx
          .select()
          .from(mailboxes)
          .where(
            and(
              eq(mailboxes.address, address),
              isNull(mailboxes.endedAt),
              isNull(mailboxes.userId),
              gt(mailboxes.expiresAt, now),
            ),
          )
          .limit(1)
      ).at(0)

      if (!mailbox) {
        return null
      }

      const expiresAt = new Date(now.getTime() + options.ttlSeconds * 1_000)

      await tx
        .update(mailboxes)
        .set({ lastSeenAt: now, expiresAt })
        .where(eq(mailboxes.id, mailbox.id))

      const rows = await tx
        .select({
          id: messages.id,
          fromAddress: messages.fromAddress,
          subject: messages.subject,
          textBody: messages.textBody,
          htmlBody: messages.htmlBody,
          receivedAt: messages.receivedAt,
        })
        .from(messages)
        .where(eq(messages.mailboxId, mailbox.id))
        .orderBy(desc(messages.receivedAt), desc(messages.createdAt))
        .limit(SNAPSHOT_MESSAGE_LIMIT)

      return {
        status: 'active' as const,
        mailboxId: mailbox.id,
        address: mailbox.address,
        expiresAt,
        messages: rows,
      }
    }),
  )

  return result ?? { status: 'expired' }
}

// Read-only probe for hidden tabs; it must not extend the TTL like the snapshot does.
export async function readMailboxPeek(options: {
  db: Database
  address: string
  now?: Date
}): Promise<MailboxPeek> {
  const address = normalizeAddress(options.address)

  if (!address) {
    return { status: 'expired' }
  }

  const now = options.now ?? new Date()

  const mailbox = (
    await options.db
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(
        and(
          eq(mailboxes.address, address),
          isNull(mailboxes.endedAt),
          isNull(mailboxes.userId),
          gt(mailboxes.expiresAt, now),
        ),
      )
      .limit(1)
  ).at(0)

  if (!mailbox) {
    return { status: 'expired' }
  }

  const latestMessage = (
    await options.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.mailboxId, mailbox.id))
      .orderBy(desc(messages.receivedAt), desc(messages.createdAt))
      .limit(1)
  ).at(0)

  return { status: 'active', latestMessageId: latestMessage?.id ?? null }
}

export async function cleanupExpiredMailboxes(options: {
  db: Database
  now?: Date
  retentionSeconds?: number
  receiptRetentionSeconds?: number
  limit?: number
}): Promise<CleanupResult> {
  const now = options.now ?? new Date()
  const retentionSeconds =
    options.retentionSeconds ?? DEFAULT_CLEANUP_RETENTION_SECONDS
  const receiptRetentionSeconds =
    options.receiptRetentionSeconds ?? DEFAULT_RECEIPT_RETENTION_SECONDS
  const limit = options.limit ?? DEFAULT_CLEANUP_LIMIT
  const mailboxCutoff = new Date(now.getTime() - retentionSeconds * 1_000)
  const receiptCutoff = new Date(
    now.getTime() - receiptRetentionSeconds * 1_000,
  )

  return withWriteLock(() =>
    options.db.transaction(async (tx) => {
      const ended = await tx
        .update(mailboxes)
        .set({ endedAt: now })
        .where(
          and(
            isNull(mailboxes.endedAt),
            isNull(mailboxes.userId),
            lte(mailboxes.expiresAt, now),
          ),
        )
        .returning({ id: mailboxes.id })

      const candidates = await tx
        .select({ id: mailboxes.id })
        .from(mailboxes)
        .where(
          and(
            isNull(mailboxes.userId),
            isNotNull(mailboxes.endedAt),
            lte(mailboxes.endedAt, mailboxCutoff),
          ),
        )
        .limit(limit)

      let deletedMessages = 0

      if (candidates.length > 0) {
        const mailboxIds = candidates.map((candidate) => candidate.id)
        const removedMessages = await tx
          .delete(messages)
          .where(inArray(messages.mailboxId, mailboxIds))
          .returning({ id: messages.id })

        deletedMessages = removedMessages.length

        await tx.delete(mailboxes).where(inArray(mailboxes.id, mailboxIds))
      }

      const removedReceipts = await tx
        .delete(webhookReceipts)
        .where(lte(webhookReceipts.processedAt, receiptCutoff))
        .returning({ eventId: webhookReceipts.eventId })

      return {
        ended: ended.length,
        deletedMailboxes: candidates.length,
        deletedMessages,
        deletedReceipts: removedReceipts.length,
      }
    }),
  )
}
