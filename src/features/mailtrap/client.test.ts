import { describe, expect, test } from 'bun:test'

import { getInboundMessage, MailtrapRequestError } from './client'

const INBOX_ID = '7'
const MESSAGE_ID = 'msg-1'

interface FetchCall {
  url: string
  init?: RequestInit
}

function createFetchMock(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const calls: Array<FetchCall> = []

  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return handler(url, init)
  }) as unknown as typeof fetch

  return { fetchImpl, calls }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const validPayload = {
  id: 'msg-1',
  inbox_id: 7,
  from: 'Alice <alice@sender.test>',
  to: ['user@domain.test'],
  subject: 'Hello',
  text_body: 'Plain body',
  html_body: '<p>HTML body</p>',
  received_at: '2026-10-27T00:00:00.000Z',
}

async function expectMailtrapError(
  promise: Promise<unknown>,
  kind: 'permanent' | 'retryable',
) {
  try {
    await promise
    throw new Error('Expected getInboundMessage to throw')
  } catch (error) {
    expect(error).toBeInstanceOf(MailtrapRequestError)
    expect((error as MailtrapRequestError).kind).toBe(kind)
  }
}

describe('getInboundMessage', () => {
  test('fetches and validates a message with a bearer token', async () => {
    const { fetchImpl, calls } = createFetchMock(() =>
      Promise.resolve(jsonResponse(validPayload)),
    )

    const message = await getInboundMessage({
      apiToken: 'secret-token',
      inboxId: INBOX_ID,
      messageId: MESSAGE_ID,
      fetchImpl,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://mailtrap.io/api/inbound/inboxes/7/messages/msg-1',
    )
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe(
      'Bearer secret-token',
    )
    expect(message).toEqual({
      id: 'msg-1',
      inboxId: '7',
      fromAddress: 'Alice <alice@sender.test>',
      to: ['user@domain.test'],
      subject: 'Hello',
      textBody: 'Plain body',
      htmlBody: '<p>HTML body</p>',
      receivedAt: new Date('2026-10-27T00:00:00.000Z'),
    })
  })

  test('treats 401, 403, and 404 as permanent failures', async () => {
    for (const status of [401, 403, 404]) {
      const { fetchImpl } = createFetchMock(() =>
        Promise.resolve(jsonResponse({ error: 'nope' }, status)),
      )

      await expectMailtrapError(
        getInboundMessage({
          apiToken: 'token',
          inboxId: INBOX_ID,
          messageId: MESSAGE_ID,
          fetchImpl,
        }),
        'permanent',
      )
    }
  })

  test('treats 429 and 5xx as retryable failures', async () => {
    for (const status of [429, 500, 503]) {
      const { fetchImpl } = createFetchMock(() =>
        Promise.resolve(jsonResponse({ error: 'later' }, status)),
      )

      await expectMailtrapError(
        getInboundMessage({
          apiToken: 'token',
          inboxId: INBOX_ID,
          messageId: MESSAGE_ID,
          fetchImpl,
        }),
        'retryable',
      )
    }
  })

  test('treats network errors as retryable', async () => {
    const { fetchImpl } = createFetchMock(() =>
      Promise.reject(new TypeError('network down')),
    )

    await expectMailtrapError(
      getInboundMessage({
        apiToken: 'token',
        inboxId: INBOX_ID,
        messageId: MESSAGE_ID,
        fetchImpl,
      }),
      'retryable',
    )
  })

  test('treats malformed JSON as a permanent failure', async () => {
    const { fetchImpl } = createFetchMock(() =>
      Promise.resolve(new Response('not json', { status: 200 })),
    )

    await expectMailtrapError(
      getInboundMessage({
        apiToken: 'token',
        inboxId: INBOX_ID,
        messageId: MESSAGE_ID,
        fetchImpl,
      }),
      'permanent',
    )
  })

  test('treats unexpected shapes and mismatched inboxes as permanent', async () => {
    const malformed = createFetchMock(() =>
      Promise.resolve(jsonResponse({ id: 'msg-1' })),
    )

    await expectMailtrapError(
      getInboundMessage({
        apiToken: 'token',
        inboxId: INBOX_ID,
        messageId: MESSAGE_ID,
        fetchImpl: malformed.fetchImpl,
      }),
      'permanent',
    )

    const mismatched = createFetchMock(() =>
      Promise.resolve(jsonResponse({ ...validPayload, inbox_id: 8 })),
    )

    await expectMailtrapError(
      getInboundMessage({
        apiToken: 'token',
        inboxId: INBOX_ID,
        messageId: MESSAGE_ID,
        fetchImpl: mismatched.fetchImpl,
      }),
      'permanent',
    )
  })
})
