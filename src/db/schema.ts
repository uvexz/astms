import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth-schema'

export * from './auth-schema'

export const mailboxes = sqliteTable(
  'mailboxes',
  {
    id: text('id').primaryKey(),
    address: text('address').notNull(),
    localPart: text('local_part').notNull(),
    domain: text('domain').notNull(),
    userId: text('user_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    // Fixed mailboxes use a far-future sentinel; they are identified by user_id.
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('mailboxes_address_ended_at_idx').on(table.address, table.endedAt),
    uniqueIndex('mailboxes_active_address_idx')
      .on(table.address)
      .where(sql`${table.endedAt} is null`),
    index('mailboxes_expires_at_idx').on(table.expiresAt),
    index('mailboxes_user_id_ended_at_idx').on(table.userId, table.endedAt),
  ],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    mailtrapMessageId: text('mailtrap_message_id').notNull(),
    fromAddress: text('from_address'),
    recipientsJson: text('recipients_json').notNull(),
    subject: text('subject'),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('messages_mailbox_mailtrap_message_idx').on(
      table.mailboxId,
      table.mailtrapMessageId,
    ),
    index('messages_mailbox_received_at_idx').on(
      table.mailboxId,
      table.receivedAt,
    ),
  ],
)

export const webhookReceipts = sqliteTable(
  'webhook_receipts',
  {
    eventId: text('event_id').primaryKey(),
    inboxId: text('inbox_id').notNull(),
    mailtrapMessageId: text('mailtrap_message_id').notNull(),
    outcome: text('outcome', { enum: ['stored', 'ignored'] }).notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('webhook_receipts_processed_at_idx').on(table.processedAt)],
)

export type Mailbox = typeof mailboxes.$inferSelect
export type NewMailbox = typeof mailboxes.$inferInsert
export type StoredMessage = typeof messages.$inferSelect
export type NewStoredMessage = typeof messages.$inferInsert
export type WebhookReceipt = typeof webhookReceipts.$inferSelect
