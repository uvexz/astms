import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import type { Database } from '#/db'
import { mailboxes, messages, user } from '#/db/schema'
import { createTestDatabase } from '#/test-utils/database'

import { createMailboxWithPrefix } from './mailbox-service'
import {
  countOwnedMailboxes,
  createOwnedMailboxWithPrefix,
  deleteOwnedMailbox,
  FIXED_MAILBOX_EXPIRES_AT,
  listOwnedMailboxes,
  markOwnedMessageRead,
  readOwnedMailboxSnapshot,
} from './owned-mailbox-service'

const DOMAIN = 'example.test'
const TTL_SECONDS = 90
const START = new Date('2026-10-27T00:00:00.000Z')

function at(seconds: number) {
  return new Date(START.getTime() + seconds * 1_000)
}

async function insertUser(db: Database, now = START) {
  const id = randomUUID()

  await db.insert(user).values({
    id,
    name: 'Test User',
    email: `${id}@oauth.invalid`,
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
  })

  return id
}

async function insertFixedMailbox(
  db: Database,
  options: {
    userId: string
    prefix: string
    createdAt?: Date
    lastSeenAt?: Date
  },
) {
  const id = randomUUID()
  const createdAt = options.createdAt ?? START
  const lastSeenAt = options.lastSeenAt ?? createdAt

  await db.insert(mailboxes).values({
    id,
    address: `${options.prefix}@${DOMAIN}`,
    localPart: options.prefix,
    domain: DOMAIN,
    userId: options.userId,
    createdAt,
    lastSeenAt,
    expiresAt: FIXED_MAILBOX_EXPIRES_AT,
  })

  return id
}

async function insertMessage(db: Database, mailboxId: string, subject: string) {
  const id = randomUUID()

  await db.insert(messages).values({
    id,
    mailboxId,
    mailtrapMessageId: randomUUID(),
    fromAddress: 'sender@example.test',
    recipientsJson: JSON.stringify([`${mailboxId}@${DOMAIN}`]),
    subject,
    textBody: 'hello',
    htmlBody: null,
    receivedAt: at(5),
    createdAt: at(5),
  })

  return id
}

describe('owned fixed mailboxes', () => {
  let db: Database
  let close: () => void

  beforeEach(async () => {
    const testDb = await createTestDatabase()
    db = testDb.db
    close = () => testDb.client.close()
  })

  afterEach(() => {
    close()
  })

  test('creates a permanent mailbox and lists it for its owner', async () => {
    const userId = await insertUser(db)
    const result = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix: 'fixed-one',
      now: START,
    })

    expect(result.status).toBe('active')

    if (result.status !== 'active') {
      return
    }

    expect(result.created).toBe(true)
    expect(result.mailbox.address).toBe('fixed-one@example.test')

    const [row] = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, result.mailbox.id))

    expect(row.userId).toBe(userId)
    expect(row.expiresAt.toISOString()).toBe(
      FIXED_MAILBOX_EXPIRES_AT.toISOString(),
    )

    const listed = await listOwnedMailboxes({ db, userId })
    expect(listed).toHaveLength(1)
    expect(listed[0].address).toBe('fixed-one@example.test')
  })

  test('opens the same user existing mailbox instead of creating a duplicate', async () => {
    const userId = await insertUser(db)
    const first = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix: 'fixed-open',
      now: START,
    })
    const second = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix: 'fixed-open',
      now: at(10),
    })

    expect(first.status).toBe('active')
    expect(second.status).toBe('active')

    if (first.status !== 'active' || second.status !== 'active') {
      return
    }

    expect(second.created).toBe(false)
    expect(second.mailbox.id).toBe(first.mailbox.id)
  })

  test('rejects an address owned by another user', async () => {
    const firstUser = await insertUser(db)
    const secondUser = await insertUser(db)

    await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId: firstUser,
      prefix: 'fixed-shared',
      now: START,
    })

    const result = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId: secondUser,
      prefix: 'fixed-shared',
      now: at(10),
    })

    expect(result).toEqual({ status: 'address_in_use' })
  })

  test('rejects an active anonymous mailbox but can take over an expired one', async () => {
    const userId = await insertUser(db)

    const anonymous = await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'fixed-taken',
      now: START,
    })

    const blocked = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix: 'fixed-taken',
      now: at(10),
    })

    expect(blocked).toEqual({ status: 'address_in_use' })

    const takeover = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix: 'fixed-taken',
      now: at(91),
    })

    expect(takeover.status).toBe('active')

    if (takeover.status !== 'active') {
      return
    }

    expect(takeover.created).toBe(true)
    expect(takeover.mailbox.id).not.toBe(anonymous.mailboxId)

    const [oldRow] = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, anonymous.mailboxId))

    expect(oldRow.endedAt?.toISOString()).toBe(at(91).toISOString())
  })

  test('evicts the least recently used mailbox at the 50 limit', async () => {
    const userId = await insertUser(db)

    for (let index = 0; index < 50; index += 1) {
      await insertFixedMailbox(db, {
        userId,
        prefix: `box-${String(index).padStart(2, '0')}`,
        createdAt: START,
        lastSeenAt: at(index),
      })
    }

    const result = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix: 'new-box',
      now: at(100),
    })

    expect(result.status).toBe('active')

    if (result.status !== 'active') {
      return
    }

    expect(result.evictedAddress).toBe('box-00@example.test')
    expect(await countOwnedMailboxes({ db, userId })).toBe(50)

    const remaining = await listOwnedMailboxes({ db, userId })
    expect(
      remaining.some((mailbox) => mailbox.address === 'box-00@example.test'),
    ).toBe(false)
    expect(
      remaining.some((mailbox) => mailbox.address === 'new-box@example.test'),
    ).toBe(true)
  })

  test('only the owner can read and delete a fixed mailbox', async () => {
    const owner = await insertUser(db)
    const stranger = await insertUser(db)
    const created = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId: owner,
      prefix: 'private-box',
      now: START,
    })

    expect(created.status).toBe('active')

    if (created.status !== 'active') {
      return
    }

    await insertMessage(db, created.mailbox.id, 'owner only')

    expect(
      await readOwnedMailboxSnapshot({
        db,
        userId: stranger,
        mailboxId: created.mailbox.id,
        now: at(10),
      }),
    ).toBeNull()

    expect(
      await deleteOwnedMailbox({
        db,
        userId: stranger,
        mailboxId: created.mailbox.id,
      }),
    ).toBe(false)

    const snapshot = await readOwnedMailboxSnapshot({
      db,
      userId: owner,
      mailboxId: created.mailbox.id,
      now: at(10),
    })

    expect(snapshot?.messages).toHaveLength(1)
    expect(snapshot?.messages[0].subject).toBe('owner only')
    expect(snapshot?.lastSeenAt.toISOString()).toBe(at(10).toISOString())

    expect(
      await deleteOwnedMailbox({
        db,
        userId: owner,
        mailboxId: created.mailbox.id,
      }),
    ).toBe(true)

    expect(await db.select().from(messages)).toHaveLength(0)
    expect(await db.select().from(mailboxes)).toHaveLength(0)
  })

  test('reports unread counts and marks a message read once', async () => {
    const userId = await insertUser(db)
    const created = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix: 'counted-box',
      now: START,
    })

    expect(created.status).toBe('active')

    if (created.status !== 'active') {
      return
    }

    const firstMessageId = await insertMessage(db, created.mailbox.id, 'first')
    await insertMessage(db, created.mailbox.id, 'second')
    await insertMessage(db, created.mailbox.id, 'third')

    const [listed] = await listOwnedMailboxes({ db, userId })
    expect(listed.messageCount).toBe(3)
    expect(listed.unreadCount).toBe(3)

    const counts = await markOwnedMessageRead({
      db,
      userId,
      mailboxId: created.mailbox.id,
      messageId: firstMessageId,
      now: at(10),
    })

    expect(counts).toEqual({ messageCount: 3, unreadCount: 2 })

    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, firstMessageId))

    expect(message.readAt?.toISOString()).toBe(at(10).toISOString())

    const repeated = await markOwnedMessageRead({
      db,
      userId,
      mailboxId: created.mailbox.id,
      messageId: firstMessageId,
      now: at(20),
    })

    expect(repeated).toEqual({ messageCount: 3, unreadCount: 2 })

    const [unchanged] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, firstMessageId))

    expect(unchanged.readAt?.toISOString()).toBe(at(10).toISOString())
  })

  test('only the owner can mark messages read', async () => {
    const owner = await insertUser(db)
    const stranger = await insertUser(db)
    const created = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId: owner,
      prefix: 'read-private-box',
      now: START,
    })

    expect(created.status).toBe('active')

    if (created.status !== 'active') {
      return
    }

    const messageId = await insertMessage(db, created.mailbox.id, 'private')

    expect(
      await markOwnedMessageRead({
        db,
        userId: stranger,
        mailboxId: created.mailbox.id,
        messageId,
        now: at(10),
      }),
    ).toBeNull()

    const [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))

    expect(message.readAt).toBeNull()
  })

  test('keeps fixed mailboxes readable regardless of elapsed time', async () => {
    const userId = await insertUser(db)
    const created = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix: 'fixed-forever',
      now: START,
    })

    expect(created.status).toBe('active')

    if (created.status !== 'active') {
      return
    }

    const snapshot = await readOwnedMailboxSnapshot({
      db,
      userId,
      mailboxId: created.mailbox.id,
      now: new Date('2099-01-01T00:00:00.000Z'),
    })

    expect(snapshot?.address).toBe('fixed-forever@example.test')
  })
})
