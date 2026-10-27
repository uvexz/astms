import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { randomUUID } from 'node:crypto'

import type { Database } from '#/db'
import { mailboxes, messages } from '#/db/schema'
import { createTestDatabase } from '#/test-utils/database'

import {
  cleanupExpiredMailboxes,
  createMailboxWithPrefix,
  createOrOpenMailbox,
  readMailboxSnapshot,
} from './mailbox-service'

const DOMAIN = 'example.test'
const TTL_SECONDS = 90
const START = new Date('2026-10-27T00:00:00.000Z')

function at(seconds: number) {
  return new Date(START.getTime() + seconds * 1_000)
}

async function insertMessage(db: Database, mailboxId: string, subject: string) {
  await db.insert(messages).values({
    id: randomUUID(),
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
}

describe('mailbox lifecycle', () => {
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

  test('opens an existing active address instead of creating a duplicate', async () => {
    const first = await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'hello-world',
      now: START,
    })

    const second = await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'hello-world',
      now: at(10),
    })

    expect(first.joinedExisting).toBe(false)
    expect(second.joinedExisting).toBe(true)
    expect(second.mailboxId).toBe(first.mailboxId)
    expect(second.address).toBe('hello-world@example.test')
  })

  test('creates one mailbox when the same address is created concurrently', async () => {
    const results = await Promise.all([
      createMailboxWithPrefix({
        db,
        domain: DOMAIN,
        ttlSeconds: TTL_SECONDS,
        prefix: 'race-condition',
        now: START,
      }),
      createMailboxWithPrefix({
        db,
        domain: DOMAIN,
        ttlSeconds: TTL_SECONDS,
        prefix: 'race-condition',
        now: START,
      }),
    ])

    expect(results[0].mailboxId).toBe(results[1].mailboxId)
    expect(await db.select().from(mailboxes)).toHaveLength(1)
  })

  test('generates secure random prefixes when no prefix is given', async () => {
    const created = await createOrOpenMailbox({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      now: START,
    })

    expect(created.address).toMatch(/^[a-z]+-[a-z]+\d{3}@example\.test$/)
    expect(created.joinedExisting).toBe(false)
  })

  test('extends the expiry on each successful snapshot read', async () => {
    const created = await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'heartbeat-1',
      now: START,
    })

    await insertMessage(db, created.mailboxId, 'first message')

    const snapshot = await readMailboxSnapshot({
      db,
      address: created.address,
      ttlSeconds: TTL_SECONDS,
      now: at(30),
    })

    expect(snapshot.status).toBe('active')

    if (snapshot.status !== 'active') {
      return
    }

    expect(snapshot.messages).toHaveLength(1)
    expect(snapshot.messages[0].subject).toBe('first message')
    expect(snapshot.expiresAt.toISOString()).toBe(at(120).toISOString())
  })

  test('expires when polling stops beyond the TTL', async () => {
    const created = await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'no-heartbeat',
      now: START,
    })

    const snapshot = await readMailboxSnapshot({
      db,
      address: created.address,
      ttlSeconds: TTL_SECONDS,
      now: at(91),
    })

    expect(snapshot).toEqual({ status: 'expired' })
  })

  test('does not expose old messages when an expired address is recreated', async () => {
    const first = await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'reuse-me',
      now: START,
    })

    await insertMessage(db, first.mailboxId, 'old secret')

    const second = await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'reuse-me',
      now: at(91),
    })

    expect(second.mailboxId).not.toBe(first.mailboxId)

    const snapshot = await readMailboxSnapshot({
      db,
      address: second.address,
      ttlSeconds: TTL_SECONDS,
      now: at(92),
    })

    expect(snapshot.status).toBe('active')

    if (snapshot.status === 'active') {
      expect(snapshot.messages).toEqual([])
    }
  })

  test('ends and deletes expired mailboxes with their messages', async () => {
    const created = await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'cleanup-me',
      now: START,
    })

    await insertMessage(db, created.mailboxId, 'to be deleted')

    const result = await cleanupExpiredMailboxes({
      db,
      now: at(91),
      retentionSeconds: 0,
    })

    expect(result.ended).toBe(1)
    expect(result.deletedMailboxes).toBe(1)
    expect(result.deletedMessages).toBe(1)
    expect(await db.select().from(mailboxes)).toHaveLength(0)
    expect(await db.select().from(messages)).toHaveLength(0)
  })

  test('keeps recently ended mailboxes during the retention window', async () => {
    await createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix: 'retain-me',
      now: START,
    })

    const result = await cleanupExpiredMailboxes({
      db,
      now: at(91),
      retentionSeconds: 3_600,
    })

    expect(result.ended).toBe(1)
    expect(result.deletedMailboxes).toBe(0)
    expect(await db.select().from(mailboxes)).toHaveLength(1)
  })
})
