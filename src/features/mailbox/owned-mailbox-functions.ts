import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { db } from '#/db'
import { requireViewer } from '#/features/auth/auth-server'
import { getMailboxConfig, ServerConfigError } from '#/server/config'
import { consumeRateLimit } from '#/server/rate-limit'

import {
  FIXED_PREFIX_MAX_LENGTH,
  FIXED_PREFIX_MIN_LENGTH,
  FIXED_PREFIX_RULE_MESSAGE,
  validateFixedPrefix,
} from './address'
import {
  createOwnedMailboxWithPrefix,
  createRandomOwnedMailbox,
  deleteOwnedMailbox,
  FIXED_MAILBOX_LIMIT,
  FIXED_MAILBOX_MESSAGE_LIMIT,
  listOwnedMailboxes,
  markOwnedMessageRead,
  readOwnedMailboxSnapshot,
} from './owned-mailbox-service'
import type {
  MailboxMessageCounts,
  OwnedMailboxSummary,
} from './owned-mailbox-service'
import { MailboxAddressInUseError } from './mailbox-service'
import type {
  CreateMyMailboxResult,
  DashboardConfig,
  DashboardMailbox,
  DeleteMyMailboxResult,
  ListMyMailboxesResult,
  MarkMyMessageReadResult,
  MyMailboxSnapshotResult,
} from './types'

const CREATE_RATE_LIMIT = 10
const DELETE_RATE_LIMIT = 10
const RATE_WINDOW_MS = 60_000

function serializeMailbox(
  mailbox: OwnedMailboxSummary & Partial<MailboxMessageCounts>,
): DashboardMailbox {
  return {
    id: mailbox.id,
    address: mailbox.address,
    createdAt: mailbox.createdAt.toISOString(),
    lastSeenAt: mailbox.lastSeenAt.toISOString(),
    messageCount: mailbox.messageCount ?? 0,
    unreadCount: mailbox.unreadCount ?? 0,
  }
}

export const getDashboardConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardConfig> => {
    const config = getMailboxConfig()

    return {
      siteName: config.siteName,
      domain: config.domain,
      pollIntervalMs: config.pollIntervalMs,
      limit: FIXED_MAILBOX_LIMIT,
      prefixMinLength: FIXED_PREFIX_MIN_LENGTH,
      prefixMaxLength: FIXED_PREFIX_MAX_LENGTH,
      prefixRuleMessage: FIXED_PREFIX_RULE_MESSAGE,
      messageLimit: FIXED_MAILBOX_MESSAGE_LIMIT,
    }
  },
)

export const listMyMailboxes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ListMyMailboxesResult> => {
    const viewer = await requireViewer()

    if (!viewer) {
      return { status: 'unauthenticated' }
    }

    const mailboxes = await listOwnedMailboxes({
      db,
      userId: viewer.id,
    })

    return {
      status: 'ok',
      mailboxes: mailboxes.map(serializeMailbox),
      limit: FIXED_MAILBOX_LIMIT,
    }
  },
)

export const createMyMailbox = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      prefix: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ data }): Promise<CreateMyMailboxResult> => {
    const viewer = await requireViewer()

    if (!viewer) {
      return { status: 'unauthenticated' }
    }

    if (
      !consumeRateLimit(
        `owned-mailbox-create:${viewer.id}`,
        CREATE_RATE_LIMIT,
        RATE_WINDOW_MS,
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
      let result

      if (rawPrefix) {
        const validation = validateFixedPrefix(rawPrefix)

        if (!validation.ok) {
          return { status: 'invalid_prefix', message: validation.message }
        }

        result = await createOwnedMailboxWithPrefix({
          db,
          domain: config.domain,
          userId: viewer.id,
          prefix: validation.prefix,
        })
      } else {
        result = await createRandomOwnedMailbox({
          db,
          domain: config.domain,
          userId: viewer.id,
        })
      }

      if (result.status === 'address_in_use') {
        return {
          status: 'address_in_use',
          message: '该地址暂不可用，请换一个前缀或稍后再试',
        }
      }

      return {
        status: 'active',
        mailbox: serializeMailbox(result.mailbox),
        created: result.created,
        evictedAddress: result.evictedAddress,
      }
    } catch (error) {
      if (error instanceof MailboxAddressInUseError) {
        return {
          status: 'address_in_use',
          message: '该地址暂不可用，请换一个前缀或稍后再试',
        }
      }

      if (error instanceof ServerConfigError) {
        console.error(
          '[owned-mailbox] create unavailable',
          error.variables.join(','),
        )
        return {
          status: 'unavailable',
          message: '服务暂时不可用，请稍后再试',
        }
      }

      console.error(
        '[owned-mailbox] create failed',
        error instanceof Error ? error.name : 'unknown',
      )
      return {
        status: 'unavailable',
        message: '创建失败，请稍后再试',
      }
    }
  })

export const getMyMailboxSnapshot = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      mailboxId: z.string().trim().min(1).max(64),
    }),
  )
  .handler(async ({ data }): Promise<MyMailboxSnapshotResult> => {
    const viewer = await requireViewer()

    if (!viewer) {
      return { status: 'unauthenticated' }
    }

    const snapshot = await readOwnedMailboxSnapshot({
      db,
      userId: viewer.id,
      mailboxId: data.mailboxId,
    })

    if (!snapshot) {
      return { status: 'not_found' }
    }

    return {
      status: 'active',
      mailbox: serializeMailbox(snapshot),
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

export const markMyMessageRead = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      mailboxId: z.string().trim().min(1).max(64),
      messageId: z.string().trim().min(1).max(64),
    }),
  )
  .handler(async ({ data }): Promise<MarkMyMessageReadResult> => {
    const viewer = await requireViewer()

    if (!viewer) {
      return { status: 'unauthenticated' }
    }

    const counts = await markOwnedMessageRead({
      db,
      userId: viewer.id,
      mailboxId: data.mailboxId,
      messageId: data.messageId,
    })

    if (!counts) {
      return { status: 'not_found' }
    }

    return { status: 'ok', ...counts }
  })

export const deleteMyMailbox = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      mailboxId: z.string().trim().min(1).max(64),
    }),
  )
  .handler(async ({ data }): Promise<DeleteMyMailboxResult> => {
    const viewer = await requireViewer()

    if (!viewer) {
      return { status: 'unauthenticated' }
    }

    if (
      !consumeRateLimit(
        `owned-mailbox-delete:${viewer.id}`,
        DELETE_RATE_LIMIT,
        RATE_WINDOW_MS,
      )
    ) {
      return {
        status: 'rate_limited',
        message: '操作过于频繁，请稍后再试',
      }
    }

    const deleted = await deleteOwnedMailbox({
      db,
      userId: viewer.id,
      mailboxId: data.mailboxId,
    })

    return deleted ? { status: 'deleted' } : { status: 'not_found' }
  })
