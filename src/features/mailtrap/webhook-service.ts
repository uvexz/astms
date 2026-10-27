import '@tanstack/react-start/server-only'

import { randomUUID } from 'node:crypto'

import { and, eq, gt, inArray, isNull } from 'drizzle-orm'

import type { Database } from '#/db'
import { mailboxes, messages, webhookReceipts } from '#/db/schema'
import { extractEmailAddress } from '#/features/mailbox/address'
import { withWriteLock } from '#/server/write-lock'

import type { InboundMessage } from './client'
import { MailtrapRequestError } from './client'
import { sanitizeEmailHtml } from './sanitize'
import { verifyMailtrapSignature } from './signature'
import type { MailtrapWebhookEvent } from './webhook-schema'
import { mailtrapWebhookPayloadSchema } from './webhook-schema'

const INBOUND_EVENT = 'inbound.message_received'

export interface WebhookDependencies {
  db: Database
  inboxId: string
  webhookSecret: string
  getMessage: (inboxId: string, messageId: string) => Promise<InboundMessage>
  now?: () => Date
  logger?: Pick<Console, 'warn' | 'error'>
}

export interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

async function recordIgnoredReceipt(
  deps: WebhookDependencies,
  event: MailtrapWebhookEvent,
  processedAt: Date,
) {
  await withWriteLock(() =>
    deps.db
      .insert(webhookReceipts)
      .values({
        eventId: event.event_id,
        inboxId: event.inbox_id,
        mailtrapMessageId: event.message_id,
        outcome: 'ignored',
        processedAt,
      })
      .onConflictDoNothing(),
  )
}

export async function handleMailtrapWebhook(options: {
  rawBody: Uint8Array
  signature: string | null
  deps: WebhookDependencies
}): Promise<WebhookResult> {
  const { deps } = options

  if (
    !verifyMailtrapSignature(
      options.rawBody,
      options.signature,
      deps.webhookSecret,
    )
  ) {
    deps.logger?.warn('[mailtrap] rejected webhook with invalid signature')
    return { status: 401, body: { error: 'invalid_signature' } }
  }

  let payload: unknown

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      options.rawBody,
    )
    payload = JSON.parse(text)
  } catch {
    return { status: 400, body: { error: 'invalid_payload' } }
  }

  const parsed = mailtrapWebhookPayloadSchema.safeParse(payload)

  if (!parsed.success) {
    return { status: 400, body: { error: 'invalid_payload' } }
  }

  const logger = deps.logger ?? console

  try {
    for (const event of parsed.data.events) {
      const existingReceipt = (
        await deps.db
          .select({ eventId: webhookReceipts.eventId })
          .from(webhookReceipts)
          .where(eq(webhookReceipts.eventId, event.event_id))
          .limit(1)
      ).at(0)

      if (existingReceipt) {
        continue
      }

      const now = deps.now?.() ?? new Date()

      if (event.event !== INBOUND_EVENT) {
        await recordIgnoredReceipt(deps, event, now)
        continue
      }

      if (event.inbox_id !== deps.inboxId) {
        logger.warn('[mailtrap] ignoring webhook for another inbox', {
          eventId: event.event_id,
          inboxId: event.inbox_id,
        })
        await recordIgnoredReceipt(deps, event, now)
        continue
      }

      let message: InboundMessage

      try {
        message = await deps.getMessage(deps.inboxId, event.message_id)
      } catch (error) {
        if (
          error instanceof MailtrapRequestError &&
          error.kind === 'permanent'
        ) {
          logger.warn('[mailtrap] dropping permanently failed message', {
            eventId: event.event_id,
            status: error.status ?? 0,
          })
          await recordIgnoredReceipt(deps, event, now)
          continue
        }

        logger.error('[mailtrap] message fetch failed', {
          eventId: event.event_id,
          status:
            error instanceof MailtrapRequestError ? (error.status ?? 0) : 0,
          error: error instanceof Error ? error.name : 'unknown',
        })

        return { status: 500, body: { error: 'upstream_unavailable' } }
      }

      const processedAt = deps.now?.() ?? new Date()
      const recipients = [
        ...new Set(
          message.to
            .map(extractEmailAddress)
            .filter((address): address is string => address !== null),
        ),
      ]

      let matchedMailboxes: Array<{ id: string; address: string }> = []

      if (recipients.length > 0) {
        matchedMailboxes = await deps.db
          .select({ id: mailboxes.id, address: mailboxes.address })
          .from(mailboxes)
          .where(
            and(
              inArray(mailboxes.address, recipients),
              isNull(mailboxes.endedAt),
              gt(mailboxes.expiresAt, processedAt),
            ),
          )
      }

      if (matchedMailboxes.length === 0) {
        await recordIgnoredReceipt(deps, event, processedAt)
        continue
      }

      const recipientsJson = JSON.stringify(recipients)
      const htmlBody = message.htmlBody
        ? sanitizeEmailHtml(message.htmlBody)
        : null

      try {
        await withWriteLock(() =>
          deps.db.transaction(async (tx) => {
            for (const mailbox of matchedMailboxes) {
              await tx
                .insert(messages)
                .values({
                  id: randomUUID(),
                  mailboxId: mailbox.id,
                  mailtrapMessageId: message.id,
                  fromAddress: message.fromAddress,
                  recipientsJson,
                  subject: message.subject,
                  textBody: message.textBody,
                  htmlBody,
                  receivedAt: message.receivedAt,
                  createdAt: processedAt,
                })
                .onConflictDoNothing()
            }

            await tx
              .insert(webhookReceipts)
              .values({
                eventId: event.event_id,
                inboxId: event.inbox_id,
                mailtrapMessageId: event.message_id,
                outcome: 'stored',
                processedAt,
              })
              .onConflictDoNothing()
          }),
        )
      } catch (error) {
        logger.error('[mailtrap] failed to persist message', {
          eventId: event.event_id,
          error: error instanceof Error ? error.name : 'unknown',
        })

        return { status: 500, body: { error: 'storage_unavailable' } }
      }
    }

    return { status: 200, body: { received: true } }
  } catch (error) {
    logger.error('[mailtrap] webhook processing failed', {
      error: error instanceof Error ? error.name : 'unknown',
    })

    return { status: 500, body: { error: 'storage_unavailable' } }
  }
}
