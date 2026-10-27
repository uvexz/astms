import '@tanstack/react-start/server-only'

import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import type { Database } from '#/db'
import { mailboxes, messages } from '#/db/schema'
import { withWriteLock } from '#/server/write-lock'

import { formatMailboxAddress, generateRandomPrefix } from './address'
import { isUniqueConstraintError } from './db-errors'
import type { SnapshotMessage } from './mailbox-service'

export const FIXED_MAILBOX_LIMIT = 50
export const FIXED_MAILBOX_MESSAGE_LIMIT = 200
export const FIXED_MAILBOX_EXPIRES_AT = new Date('9999-12-31T23:59:59.999Z')

const RANDOM_PREFIX_ATTEMPTS = 5

export interface OwnedMailboxSummary {
  id: string
  address: string
  createdAt: Date
  lastSeenAt: Date
}

export interface OwnedMailboxListEntry extends OwnedMailboxSummary {
  messageCount: number
  unreadCount: number
}

export interface MailboxMessageCounts {
  messageCount: number
  unreadCount: number
}

export interface OwnedMailboxSnapshot extends OwnedMailboxSummary {
  messages: Array<SnapshotMessage>
}

export type CreateOwnedMailboxResult =
  | {
      status: 'active'
      mailbox: OwnedMailboxSummary
      created: boolean
      evictedAddress: string | null
    }
  | { status: 'address_in_use' }

type TryCreateResult = CreateOwnedMailboxResult | { status: 'retry' }

interface CreateOwnedMailboxOptions {
  db: Database
  domain: string
  userId: string
  now?: Date
  limit?: number
}

interface TryCreateOptions extends CreateOwnedMailboxOptions {
  localPart: string
  joinExisting: boolean
}

function toSummary(row: {
  id: string
  address: string
  createdAt: Date
  lastSeenAt: Date
}): OwnedMailboxSummary {
  return {
    id: row.id,
    address: row.address,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  }
}

async function findActiveAddress(
  db: Database,
  address: string,
): Promise<
  | {
      id: string
      address: string
      userId: string | null
      createdAt: Date
      lastSeenAt: Date
      expiresAt: Date
    }
  | undefined
> {
  return (
    await db
      .select({
        id: mailboxes.id,
        address: mailboxes.address,
        userId: mailboxes.userId,
        createdAt: mailboxes.createdAt,
        lastSeenAt: mailboxes.lastSeenAt,
        expiresAt: mailboxes.expiresAt,
      })
      .from(mailboxes)
      .where(and(eq(mailboxes.address, address), isNull(mailboxes.endedAt)))
      .limit(1)
  ).at(0)
}

async function tryCreateOwnedMailbox(
  options: TryCreateOptions,
): Promise<TryCreateResult> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? FIXED_MAILBOX_LIMIT
  const address = formatMailboxAddress(options.localPart, options.domain)

  try {
    return await withWriteLock(() =>
      options.db.transaction(async (tx) => {
        const existing = (
          await tx
            .select({
              id: mailboxes.id,
              address: mailboxes.address,
              userId: mailboxes.userId,
              createdAt: mailboxes.createdAt,
              lastSeenAt: mailboxes.lastSeenAt,
              expiresAt: mailboxes.expiresAt,
            })
            .from(mailboxes)
            .where(
              and(eq(mailboxes.address, address), isNull(mailboxes.endedAt)),
            )
            .limit(1)
        ).at(0)

        if (existing) {
          const isExpiredAnonymous =
            existing.userId === null &&
            existing.expiresAt.getTime() <= now.getTime()

          if (!isExpiredAnonymous) {
            if (existing.userId === options.userId) {
              if (options.joinExisting) {
                return {
                  status: 'active' as const,
                  mailbox: toSummary(existing),
                  created: false,
                  evictedAddress: null,
                }
              }

              return { status: 'retry' as const }
            }

            if (options.joinExisting) {
              return { status: 'address_in_use' as const }
            }

            return { status: 'retry' as const }
          }

          await tx
            .update(mailboxes)
            .set({ endedAt: now })
            .where(eq(mailboxes.id, existing.id))
        }

        const countRow = (
          await tx
            .select({ count: sql<number>`count(*)` })
            .from(mailboxes)
            .where(
              and(
                eq(mailboxes.userId, options.userId),
                isNull(mailboxes.endedAt),
              ),
            )
        ).at(0)
        const count = countRow?.count ?? 0
        let evictedAddress: string | null = null

        if (count >= limit) {
          const evicted = (
            await tx
              .select({ id: mailboxes.id, address: mailboxes.address })
              .from(mailboxes)
              .where(
                and(
                  eq(mailboxes.userId, options.userId),
                  isNull(mailboxes.endedAt),
                ),
              )
              .orderBy(asc(mailboxes.lastSeenAt), asc(mailboxes.createdAt))
              .limit(1)
          ).at(0)

          if (!evicted) {
            throw new Error('Unable to evict a fixed mailbox')
          }

          await tx.delete(mailboxes).where(eq(mailboxes.id, evicted.id))
          evictedAddress = evicted.address
        }

        const mailboxId = randomUUID()
        const createdAt = now

        await tx.insert(mailboxes).values({
          id: mailboxId,
          address,
          localPart: options.localPart,
          domain: options.domain,
          userId: options.userId,
          createdAt,
          lastSeenAt: createdAt,
          expiresAt: FIXED_MAILBOX_EXPIRES_AT,
        })

        return {
          status: 'active' as const,
          mailbox: {
            id: mailboxId,
            address,
            createdAt,
            lastSeenAt: createdAt,
          },
          created: true,
          evictedAddress,
        }
      }),
    )
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const existing = await findActiveAddress(options.db, address)

    if (
      existing &&
      options.joinExisting &&
      existing.userId === options.userId
    ) {
      return {
        status: 'active',
        mailbox: toSummary(existing),
        created: false,
        evictedAddress: null,
      }
    }

    if (existing && options.joinExisting) {
      return { status: 'address_in_use' }
    }

    return { status: 'retry' }
  }
}

export async function createOwnedMailboxWithPrefix(
  options: CreateOwnedMailboxOptions & { prefix: string },
): Promise<CreateOwnedMailboxResult> {
  return tryCreateOwnedMailbox({
    ...options,
    localPart: options.prefix,
    joinExisting: true,
  }).then((result) =>
    result.status === 'retry' ? { status: 'address_in_use' } : result,
  )
}

export async function createRandomOwnedMailbox(
  options: CreateOwnedMailboxOptions,
): Promise<CreateOwnedMailboxResult> {
  for (let attempt = 0; attempt < RANDOM_PREFIX_ATTEMPTS; attempt += 1) {
    const result = await tryCreateOwnedMailbox({
      ...options,
      localPart: generateRandomPrefix(),
      joinExisting: false,
    })

    if (result.status !== 'retry') {
      return result
    }
  }

  throw new Error('Unable to allocate a fixed mailbox prefix')
}

export async function listOwnedMailboxes(options: {
  db: Database
  userId: string
  limit?: number
}): Promise<Array<OwnedMailboxListEntry>> {
  const rows = await options.db
    .select({
      id: mailboxes.id,
      address: mailboxes.address,
      createdAt: mailboxes.createdAt,
      lastSeenAt: mailboxes.lastSeenAt,
      messageCount: sql<number>`count(${messages.id})`,
      unreadCount: sql<number>`count(case when ${messages.readAt} is null then ${messages.id} end)`,
    })
    .from(mailboxes)
    .leftJoin(messages, eq(messages.mailboxId, mailboxes.id))
    .where(and(eq(mailboxes.userId, options.userId), isNull(mailboxes.endedAt)))
    .groupBy(
      mailboxes.id,
      mailboxes.address,
      mailboxes.createdAt,
      mailboxes.lastSeenAt,
    )
    .orderBy(desc(mailboxes.createdAt))
    .limit(options.limit ?? FIXED_MAILBOX_LIMIT)

  return rows.map((row) => ({
    id: row.id,
    address: row.address,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    messageCount: Number(row.messageCount),
    unreadCount: Number(row.unreadCount),
  }))
}

export async function markOwnedMessageRead(options: {
  db: Database
  userId: string
  mailboxId: string
  messageId: string
  now?: Date
}): Promise<MailboxMessageCounts | null> {
  const now = options.now ?? new Date()

  return withWriteLock(() =>
    options.db.transaction(async (tx) => {
      const mailbox = (
        await tx
          .select({ id: mailboxes.id })
          .from(mailboxes)
          .where(
            and(
              eq(mailboxes.id, options.mailboxId),
              eq(mailboxes.userId, options.userId),
              isNull(mailboxes.endedAt),
            ),
          )
          .limit(1)
      ).at(0)

      if (!mailbox) {
        return null
      }

      await tx
        .update(messages)
        .set({ readAt: now })
        .where(
          and(
            eq(messages.id, options.messageId),
            eq(messages.mailboxId, mailbox.id),
            isNull(messages.readAt),
          ),
        )

      const counts = (
        await tx
          .select({
            messageCount: sql<number>`count(*)`,
            unreadCount: sql<number>`count(case when ${messages.readAt} is null then 1 end)`,
          })
          .from(messages)
          .where(eq(messages.mailboxId, mailbox.id))
      ).at(0)

      return {
        messageCount: Number(counts?.messageCount ?? 0),
        unreadCount: Number(counts?.unreadCount ?? 0),
      }
    }),
  )
}

export async function readOwnedMailboxSnapshot(options: {
  db: Database
  userId: string
  mailboxId: string
  now?: Date
  messageLimit?: number
}): Promise<OwnedMailboxSnapshot | null> {
  const now = options.now ?? new Date()

  return withWriteLock(() =>
    options.db.transaction(async (tx) => {
      const mailbox = (
        await tx
          .select({
            id: mailboxes.id,
            address: mailboxes.address,
            createdAt: mailboxes.createdAt,
            lastSeenAt: mailboxes.lastSeenAt,
          })
          .from(mailboxes)
          .where(
            and(
              eq(mailboxes.id, options.mailboxId),
              eq(mailboxes.userId, options.userId),
              isNull(mailboxes.endedAt),
            ),
          )
          .limit(1)
      ).at(0)

      if (!mailbox) {
        return null
      }

      await tx
        .update(mailboxes)
        .set({ lastSeenAt: now })
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
        .limit(options.messageLimit ?? FIXED_MAILBOX_MESSAGE_LIMIT)

      return {
        ...mailbox,
        lastSeenAt: now,
        messages: rows,
      }
    }),
  )
}

export async function deleteOwnedMailbox(options: {
  db: Database
  userId: string
  mailboxId: string
}): Promise<boolean> {
  return withWriteLock(() =>
    options.db.transaction(async (tx) => {
      const mailbox = (
        await tx
          .select({ id: mailboxes.id })
          .from(mailboxes)
          .where(
            and(
              eq(mailboxes.id, options.mailboxId),
              eq(mailboxes.userId, options.userId),
              isNull(mailboxes.endedAt),
            ),
          )
          .limit(1)
      ).at(0)

      if (!mailbox) {
        return false
      }

      await tx.delete(mailboxes).where(eq(mailboxes.id, mailbox.id))
      return true
    }),
  )
}

export async function countOwnedMailboxes(options: {
  db: Database
  userId: string
}): Promise<number> {
  const row = (
    await options.db
      .select({ count: sql<number>`count(*)` })
      .from(mailboxes)
      .where(
        and(eq(mailboxes.userId, options.userId), isNull(mailboxes.endedAt)),
      )
  ).at(0)

  return row?.count ?? 0
}
