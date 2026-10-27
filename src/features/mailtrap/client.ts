import '@tanstack/react-start/server-only'

import { z } from 'zod'

const MAILTRAP_BASE_URL = 'https://mailtrap.io'
const DEFAULT_TIMEOUT_MS = 10_000

const messageResponseSchema = z.object({
  id: z.string().min(1),
  inbox_id: z.union([z.number(), z.string()]).transform(String),
  from: z.string().nullable().optional(),
  to: z.array(z.string()).default([]),
  subject: z.string().nullable().optional(),
  text_body: z.string().nullable().optional(),
  html_body: z.string().nullable().optional(),
  received_at: z.string().min(1),
})

export interface InboundMessage {
  id: string
  inboxId: string
  fromAddress: string | null
  to: Array<string>
  subject: string | null
  textBody: string | null
  htmlBody: string | null
  receivedAt: Date
}

export type MailtrapFailureKind = 'permanent' | 'retryable'

export class MailtrapRequestError extends Error {
  readonly kind: MailtrapFailureKind
  readonly status?: number

  constructor(kind: MailtrapFailureKind, message: string, status?: number) {
    super(message)
    this.name = 'MailtrapRequestError'
    this.kind = kind
    this.status = status
  }
}

export interface GetInboundMessageOptions {
  apiToken: string
  inboxId: string
  messageId: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function getInboundMessage(
  options: GetInboundMessageOptions,
): Promise<InboundMessage> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const url = `${MAILTRAP_BASE_URL}/api/inbound/inboxes/${encodeURIComponent(
    options.inboxId,
  )}/messages/${encodeURIComponent(options.messageId)}`

  let response: Response

  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new MailtrapRequestError('retryable', 'Mailtrap request failed')
  }

  if (response.status === 401 || response.status === 403) {
    throw new MailtrapRequestError(
      'permanent',
      'Mailtrap rejected the API credentials',
      response.status,
    )
  }

  if (response.status === 404) {
    throw new MailtrapRequestError(
      'permanent',
      'Mailtrap message was not found',
      response.status,
    )
  }

  if (response.status === 429 || response.status >= 500) {
    throw new MailtrapRequestError(
      'retryable',
      'Mailtrap is temporarily unavailable',
      response.status,
    )
  }

  if (!response.ok) {
    throw new MailtrapRequestError(
      'permanent',
      'Mailtrap rejected the request',
      response.status,
    )
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new MailtrapRequestError(
      'permanent',
      'Mailtrap returned an invalid response',
    )
  }

  const parsed = messageResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new MailtrapRequestError(
      'permanent',
      'Mailtrap returned an unexpected response shape',
    )
  }

  if (parsed.data.inbox_id !== options.inboxId) {
    throw new MailtrapRequestError(
      'permanent',
      'Mailtrap returned a message from a different inbox',
    )
  }

  const receivedAt = new Date(parsed.data.received_at)

  if (Number.isNaN(receivedAt.getTime())) {
    throw new MailtrapRequestError(
      'permanent',
      'Mailtrap returned an invalid received_at value',
    )
  }

  return {
    id: parsed.data.id,
    inboxId: parsed.data.inbox_id,
    fromAddress: parsed.data.from ?? null,
    to: parsed.data.to,
    subject: parsed.data.subject ?? null,
    textBody: parsed.data.text_body ?? null,
    htmlBody: parsed.data.html_body ?? null,
    receivedAt,
  }
}
