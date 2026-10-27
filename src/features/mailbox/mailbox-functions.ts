import { createServerFn } from '@tanstack/react-start'
import { getRequestIP } from '@tanstack/react-start/server'
import { z } from 'zod'

import { db } from '#/db'
import { getMailboxConfig, ServerConfigError } from '#/server/config'
import { consumeRateLimit } from '#/server/rate-limit'

import {
  PREFIX_MAX_LENGTH,
  PREFIX_MIN_LENGTH,
  PREFIX_RULE_MESSAGE,
  validatePrefix,
} from './address'
import {
  cleanupExpiredMailboxes,
  createMailboxWithPrefix,
  createOrOpenMailbox,
  MailboxAddressInUseError,
  readMailboxPeek,
  readMailboxSnapshot,
} from './mailbox-service'
import type {
  CreateMailboxResult,
  MailboxPeekResult,
  MailboxPublicConfig,
  MailboxSnapshotResult,
} from './types'

const CREATE_RATE_LIMIT = 20
const CREATE_RATE_WINDOW_MS = 60_000

async function runOpportunisticCleanup() {
  try {
    await cleanupExpiredMailboxes({ db, limit: 20 })
  } catch (error) {
    console.warn(
      '[mailbox] opportunistic cleanup failed',
      error instanceof Error ? error.name : 'unknown',
    )
  }
}

export const getMailboxPublicConfig = createServerFn({
  method: 'GET',
}).handler(async (): Promise<MailboxPublicConfig> => {
  const config = getMailboxConfig()

  return {
    siteName: config.siteName,
    domain: config.domain,
    ttlSeconds: config.ttlSeconds,
    pollIntervalMs: config.pollIntervalMs,
    prefixMinLength: PREFIX_MIN_LENGTH,
    prefixMaxLength: PREFIX_MAX_LENGTH,
    prefixRuleMessage: PREFIX_RULE_MESSAGE,
  }
})

export const createMailbox = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      prefix: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ data }): Promise<CreateMailboxResult> => {
    const ip = getRequestIP({ xForwardedFor: true }) ?? 'unknown'

    if (
      !consumeRateLimit(
        `mailbox-create:${ip}`,
        CREATE_RATE_LIMIT,
        CREATE_RATE_WINDOW_MS,
      )
    ) {
      return {
        status: 'rate_limited',
        message: '操作过于频繁，请稍后再试',
      }
    }

    try {
      const config = getMailboxConfig()
      const rawPrefix = data.prefix?.trim() ?? ''
      let created

      if (rawPrefix) {
        const validation = validatePrefix(rawPrefix)

        if (!validation.ok) {
          return { status: 'invalid_prefix', message: validation.message }
        }

        created = await createMailboxWithPrefix({
          db,
          domain: config.domain,
          ttlSeconds: config.ttlSeconds,
          prefix: validation.prefix,
        })
      } else {
        created = await createOrOpenMailbox({
          db,
          domain: config.domain,
          ttlSeconds: config.ttlSeconds,
        })
      }

      await runOpportunisticCleanup()

      return {
        status: 'active',
        mailboxId: created.mailboxId,
        address: created.address,
        expiresAt: created.expiresAt.toISOString(),
        serverNow: new Date().toISOString(),
        joinedExisting: created.joinedExisting,
        pollIntervalMs: config.pollIntervalMs,
      }
    } catch (error) {
      if (error instanceof MailboxAddressInUseError) {
        return {
          status: 'address_in_use',
          message: '该地址暂不可用，请换一个前缀或稍后再试',
        }
      }

      if (error instanceof ServerConfigError) {
        console.error('[mailbox] create unavailable', error.variables.join(','))
        return {
          status: 'unavailable',
          message: '服务暂时不可用，请稍后再试',
        }
      }

      throw error
    }
  })

export const peekMailbox = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      address: z.string().trim().min(3).max(320),
    }),
  )
  .handler(async ({ data }): Promise<MailboxPeekResult> => {
    return readMailboxPeek({ db, address: data.address })
  })

export const getMailboxSnapshot = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      address: z.string().trim().min(3).max(320),
    }),
  )
  .handler(async ({ data }): Promise<MailboxSnapshotResult> => {
    const config = getMailboxConfig()
    const snapshot = await readMailboxSnapshot({
      db,
      address: data.address,
      ttlSeconds: config.ttlSeconds,
    })

    if (snapshot.status === 'expired') {
      return { status: 'expired' }
    }

    return {
      status: 'active',
      mailboxId: snapshot.mailboxId,
      address: snapshot.address,
      expiresAt: snapshot.expiresAt.toISOString(),
      serverNow: new Date().toISOString(),
      pollIntervalMs: config.pollIntervalMs,
      messages: snapshot.messages.map((message) => ({
        id: message.id,
        fromAddress: message.fromAddress,
        subject: message.subject,
        textBody: message.textBody,
        htmlBody: message.htmlBody,
        receivedAt: message.receivedAt.toISOString(),
      })),
    }
  })
