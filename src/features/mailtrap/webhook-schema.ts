import '@tanstack/react-start/server-only'

import { z } from 'zod'

export const mailtrapWebhookEventSchema = z.object({
  event: z.string().min(1),
  event_id: z.string().min(1),
  inbox_id: z
    .union([z.number().int(), z.string().min(1)])
    .transform((value) => String(value)),
  message_id: z
    .union([z.string().min(1), z.number()])
    .transform((value) => String(value)),
  timestamp: z.union([z.number(), z.string()]).optional(),
  from: z.string().optional(),
})

export const mailtrapWebhookPayloadSchema = z.object({
  events: z.array(mailtrapWebhookEventSchema).max(100),
})

export type MailtrapWebhookEvent = z.infer<typeof mailtrapWebhookEventSchema>
