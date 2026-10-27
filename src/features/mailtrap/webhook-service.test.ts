import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createHmac, randomUUID } from 'node:crypto'

import type { Database } from '#/db'
import { messages, user, webhookReceipts } from '#/db/schema'
import { createMailboxWithPrefix } from '#/features/mailbox/mailbox-service'
import {
  createOwnedMailboxWithPrefix,
  deleteOwnedMailbox,
} from '#/features/mailbox/owned-mailbox-service'
import { createTestDatabase } from '#/test-utils/database'

import type { InboundMessage } from './client'
import { MailtrapRequestError } from './client'
import { handleMailtrapWebhook } from './webhook-service'

const SECRET = '0123456789abcdef0123456789abcdef'
const INBOX_ID = '7'
const DOMAIN = 'example.test'
const TTL_SECONDS = 90
const START = new Date('2026-10-27T00:00:00.000Z')

function at(seconds: number) {
  return new Date(START.getTime() + seconds * 1_000)
}

function sign(body: string, secret = SECRET) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: 'inbound.message_received',
    event_id: 'evt-1',
    inbox_id: Number(INBOX_ID),
    message_id: 'msg-1',
    timestamp: 1_760_000_000,
    from: 'Alice',
    ...overrides,
  }
}

function makePayload(events: Array<Record<string, unknown>>) {
  return JSON.stringify({ events })
}

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    inboxId: INBOX_ID,
    fromAddress: 'Alice <alice@sender.test>',
    to: ['inbox-one@example.test'],
    subject: 'Hello',
    textBody: 'Plain body',
    htmlBody: '<p>HTML body<script>alert(1)</script></p>',
    receivedAt: START,
    ...overrides,
  }
}

describe('handleMailtrapWebhook', () => {
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

  async function createMailbox(prefix: string, now = START) {
    return createMailboxWithPrefix({
      db,
      domain: DOMAIN,
      ttlSeconds: TTL_SECONDS,
      prefix,
      now,
    })
  }

  async function createFixedMailbox(prefix: string, now = START) {
    const userId = randomUUID()

    await db.insert(user).values({
      id: userId,
      name: 'Fixed User',
      email: `${userId}@oauth.invalid`,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    })

    const result = await createOwnedMailboxWithPrefix({
      db,
      domain: DOMAIN,
      userId,
      prefix,
      now,
    })

    if (result.status !== 'active') {
      throw new Error('Unable to create fixed mailbox for test')
    }

    return { ...result.mailbox, userId }
  }

  function callWebhook(options: {
    body: string
    signature?: string | null
    now?: Date
    getMessage?: (inboxId: string, messageId: string) => Promise<InboundMessage>
  }) {
    const getMessage =
      options.getMessage ?? (() => Promise.resolve(makeMessage()))
    const state = { fetchCount: 0 }

    const result = handleMailtrapWebhook({
      rawBody: new TextEncoder().encode(options.body),
      signature:
        options.signature === undefined
          ? sign(options.body)
          : options.signature,
      deps: {
        db,
        inboxId: INBOX_ID,
        webhookSecret: SECRET,
        now: () => options.now ?? at(10),
        getMessage: (inboxId, messageId) => {
          state.fetchCount += 1
          return getMessage(inboxId, messageId)
        },
        logger: { warn: () => {}, error: () => {} },
      },
    })

    return { result, state }
  }

  test('stores a message for an active mailbox and records the event', async () => {
    const mailbox = await createMailbox('inbox-one')
    const body = makePayload([makeEvent()])
    const { result } = callWebhook({ body })

    expect((await result).status).toBe(200)

    const stored = await db.select().from(messages)
    expect(stored).toHaveLength(1)
    expect(stored[0].mailboxId).toBe(mailbox.mailboxId)
    expect(stored[0].mailtrapMessageId).toBe('msg-1')
    expect(stored[0].fromAddress).toBe('Alice <alice@sender.test>')
    expect(stored[0].subject).toBe('Hello')
    expect(stored[0].textBody).toBe('Plain body')
    expect(stored[0].htmlBody).toContain('<p>HTML body')
    expect(stored[0].htmlBody).not.toContain('<script')
    expect(JSON.parse(stored[0].recipientsJson)).toEqual([
      'inbox-one@example.test',
    ])

    const receipts = await db.select().from(webhookReceipts)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].outcome).toBe('stored')
  })

  test('rejects a missing or invalid signature', async () => {
    const mailbox = await createMailbox('inbox-one')
    const body = makePayload([makeEvent()])

    const missing = callWebhook({ body, signature: null })
    const invalid = callWebhook({ body, signature: sign(body, 'wrong') })

    expect((await missing.result).status).toBe(401)
    expect((await invalid.result).status).toBe(401)
    expect(await db.select().from(messages)).toHaveLength(0)
    expect(await db.select().from(webhookReceipts)).toHaveLength(0)
    expect(mailbox.mailboxId).toBeTruthy()
  })

  test('rejects malformed JSON with a valid signature', async () => {
    await createMailbox('inbox-one')
    const { result } = callWebhook({ body: 'not-json' })

    expect((await result).status).toBe(400)
    expect(await db.select().from(webhookReceipts)).toHaveLength(0)
  })

  test('verifies the exact raw body, even for whitespace differences', async () => {
    await createMailbox('inbox-one')
    const raw = '{"events":[]}  '
    const reserialized = JSON.stringify(JSON.parse(raw))

    const { result } = callWebhook({
      body: raw,
      signature: sign(reserialized),
    })

    expect((await result).status).toBe(401)
  })

  test('ignores unrelated event types without fetching a message', async () => {
    await createMailbox('inbox-one')
    const body = makePayload([makeEvent({ event: 'inbound.other' })])
    const { result, state } = callWebhook({ body })

    expect((await result).status).toBe(200)
    expect(state.fetchCount).toBe(0)

    const receipts = await db.select().from(webhookReceipts)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].outcome).toBe('ignored')
  })

  test('ignores events for a different inbox', async () => {
    await createMailbox('inbox-one')
    const body = makePayload([makeEvent({ inbox_id: 8 })])
    const { result, state } = callWebhook({ body })

    expect((await result).status).toBe(200)
    expect(state.fetchCount).toBe(0)

    const receipts = await db.select().from(webhookReceipts)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].outcome).toBe('ignored')
    expect(receipts[0].inboxId).toBe('8')
    expect(await db.select().from(messages)).toHaveLength(0)
  })

  test('processes a repeated event_id only once', async () => {
    await createMailbox('inbox-one')
    const body = makePayload([makeEvent()])

    const first = callWebhook({ body })
    expect((await first.result).status).toBe(200)

    const second = callWebhook({ body })
    expect((await second.result).status).toBe(200)
    expect(second.state.fetchCount).toBe(0)
    expect(await db.select().from(messages)).toHaveLength(1)
    expect(await db.select().from(webhookReceipts)).toHaveLength(1)
  })

  test('does not duplicate a message when different events repeat the message_id', async () => {
    await createMailbox('inbox-one')

    const first = callWebhook({
      body: makePayload([makeEvent({ event_id: 'evt-1' })]),
    })
    const second = callWebhook({
      body: makePayload([makeEvent({ event_id: 'evt-2' })]),
    })

    expect((await first.result).status).toBe(200)
    expect((await second.result).status).toBe(200)
    expect(await db.select().from(messages)).toHaveLength(1)
    expect(await db.select().from(webhookReceipts)).toHaveLength(2)
  })

  test('ignores a message with no matching active address', async () => {
    await createMailbox('inbox-one')
    const body = makePayload([makeEvent()])
    const { result } = callWebhook({
      body,
      getMessage: () =>
        Promise.resolve(makeMessage({ to: ['nobody@example.test'] })),
    })

    expect((await result).status).toBe(200)

    const receipts = await db.select().from(webhookReceipts)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].outcome).toBe('ignored')
    expect(await db.select().from(messages)).toHaveLength(0)
  })

  test('ignores a message for an expired address', async () => {
    await createMailbox('inbox-one')
    const { result } = callWebhook({
      body: makePayload([makeEvent()]),
      now: at(91),
    })

    expect((await result).status).toBe(200)

    const receipts = await db.select().from(webhookReceipts)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].outcome).toBe('ignored')
    expect(await db.select().from(messages)).toHaveLength(0)
  })

  test('stores one message for each matching active mailbox', async () => {
    const first = await createMailbox('inbox-one')
    const second = await createMailbox('inbox-two')
    const body = makePayload([makeEvent()])
    const { result } = callWebhook({
      body,
      getMessage: () =>
        Promise.resolve(
          makeMessage({
            to: [first.address, second.address],
          }),
        ),
    })

    expect((await result).status).toBe(200)

    const stored = await db.select().from(messages)
    expect(stored).toHaveLength(2)
    expect(stored.map((row) => row.mailboxId).sort()).toEqual(
      [first.mailboxId, second.mailboxId].sort(),
    )
    expect(JSON.parse(stored[0].recipientsJson)).toEqual(
      [first.address, second.address].sort(),
    )
  })

  test('returns a retryable error and records nothing when Mailtrap fails', async () => {
    await createMailbox('inbox-one')
    const body = makePayload([makeEvent()])

    const { result } = callWebhook({
      body,
      getMessage: () =>
        Promise.reject(
          new MailtrapRequestError('retryable', 'upstream down', 503),
        ),
    })

    expect((await result).status).toBe(500)
    expect(await db.select().from(webhookReceipts)).toHaveLength(0)
    expect(await db.select().from(messages)).toHaveLength(0)

    const retry = callWebhook({ body })
    expect((await retry.result).status).toBe(200)
    expect(await db.select().from(messages)).toHaveLength(1)
  })

  test('acknowledges and records permanently failed messages', async () => {
    await createMailbox('inbox-one')
    const { result } = callWebhook({
      body: makePayload([makeEvent()]),
      getMessage: () =>
        Promise.reject(new MailtrapRequestError('permanent', 'not found', 404)),
    })

    expect((await result).status).toBe(200)

    const receipts = await db.select().from(webhookReceipts)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].outcome).toBe('ignored')
    expect(await db.select().from(messages)).toHaveLength(0)
  })

  test('normalizes display-name recipients before matching', async () => {
    const mailbox = await createMailbox('inbox-one')
    const body = makePayload([makeEvent()])
    const { result } = callWebhook({
      body,
      getMessage: () =>
        Promise.resolve(
          makeMessage({
            to: ['Inbox One <INBOX-ONE@Example.Test>'],
          }),
        ),
    })

    expect((await result).status).toBe(200)

    const stored = await db.select().from(messages)
    expect(stored).toHaveLength(1)
    expect(stored[0].mailboxId).toBe(mailbox.mailboxId)
    expect(JSON.parse(stored[0].recipientsJson)).toEqual([
      'inbox-one@example.test',
    ])
  })

  test('matches a dotted recipient to a fixed mailbox', async () => {
    const fixed = await createFixedMailbox('abc')
    const body = makePayload([makeEvent()])
    const { result } = callWebhook({
      body,
      getMessage: () =>
        Promise.resolve(makeMessage({ to: ['a.b.c@example.test'] })),
    })

    expect((await result).status).toBe(200)

    const stored = await db.select().from(messages)
    expect(stored).toHaveLength(1)
    expect(stored[0].mailboxId).toBe(fixed.id)
    expect(JSON.parse(stored[0].recipientsJson)).toEqual(['a.b.c@example.test'])
  })

  test('does not match dotted recipients to anonymous mailboxes', async () => {
    await createMailbox('abcdef')
    const body = makePayload([makeEvent()])
    const { result } = callWebhook({
      body,
      getMessage: () =>
        Promise.resolve(makeMessage({ to: ['a.b.c.d.e.f@example.test'] })),
    })

    expect((await result).status).toBe(200)
    expect(await db.select().from(messages)).toHaveLength(0)

    const receipts = await db.select().from(webhookReceipts)
    expect(receipts[0].outcome).toBe('ignored')
  })

  test('stores mail for a fixed mailbox after the anonymous TTL window', async () => {
    const fixed = await createFixedMailbox('fixed-ttl')
    const body = makePayload([makeEvent()])
    const { result } = callWebhook({
      body,
      now: at(10_000),
      getMessage: () =>
        Promise.resolve(makeMessage({ to: ['fixed-ttl@example.test'] })),
    })

    expect((await result).status).toBe(200)

    const stored = await db.select().from(messages)
    expect(stored).toHaveLength(1)
    expect(stored[0].mailboxId).toBe(fixed.id)
  })

  test('ignores a message for a deleted fixed mailbox', async () => {
    const fixed = await createFixedMailbox('fixed-gone')

    expect(
      await deleteOwnedMailbox({
        db,
        userId: fixed.userId,
        mailboxId: fixed.id,
      }),
    ).toBe(true)

    const body = makePayload([makeEvent()])
    const { result } = callWebhook({
      body,
      getMessage: () =>
        Promise.resolve(makeMessage({ to: ['fixed-gone@example.test'] })),
    })

    expect((await result).status).toBe(200)
    expect(await db.select().from(messages)).toHaveLength(0)
  })
})
