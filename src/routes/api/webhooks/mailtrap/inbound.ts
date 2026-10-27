import { createFileRoute } from '@tanstack/react-router'

import { db } from '#/db'
import { getInboundMessage } from '#/features/mailtrap/client'
import { handleMailtrapWebhook } from '#/features/mailtrap/webhook-service'
import { getMailtrapConfig } from '#/server/config'

const MAX_BODY_BYTES = 1_048_576

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  if (!stream) {
    return new Uint8Array(0)
  }

  const reader = stream.getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      total += value.byteLength

      if (total > limit) {
        await reader.cancel().catch(() => {})
        return null
      }

      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

export const Route = createFileRoute('/api/webhooks/mailtrap/inbound')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentLength = Number(request.headers.get('content-length') ?? 0)

        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
          return json({ error: 'payload_too_large' }, 413)
        }

        const rawBody = await readStreamWithLimit(request.body, MAX_BODY_BYTES)

        if (!rawBody) {
          return json({ error: 'payload_too_large' }, 413)
        }

        try {
          const config = getMailtrapConfig()
          const result = await handleMailtrapWebhook({
            rawBody,
            signature: request.headers.get('mailtrap-signature'),
            deps: {
              db,
              inboxId: config.inboxId,
              webhookSecret: config.webhookSecret,
              getMessage: (inboxId, messageId) =>
                getInboundMessage({
                  apiToken: config.apiToken,
                  inboxId,
                  messageId,
                }),
            },
          })

          return json(result.body, result.status)
        } catch (error) {
          console.error(
            '[mailtrap] webhook route failed',
            error instanceof Error ? error.name : 'unknown',
          )

          return json({ error: 'internal_error' }, 500)
        }
      },
      GET: () => json({ error: 'method_not_allowed' }, 405),
    },
  },
})
