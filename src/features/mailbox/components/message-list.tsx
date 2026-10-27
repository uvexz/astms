import { Text } from '@cloudflare/kumo/components/text'

import { formatAbsoluteTime, formatSender, messagePreview } from '../format'
import type { MailboxMessageView } from '../types'

export function MessageList({
  messages,
  onSelectMessage,
}: {
  messages: Array<MailboxMessageView>
  onSelectMessage: (messageId: string) => void
}) {
  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {messages.map((message) => (
        <li key={message.id} className="min-w-0">
          <button
            type="button"
            onClick={() => onSelectMessage(message.id)}
            className="w-full rounded-lg bg-kumo-base px-5 py-4 text-left ring ring-kumo-line hover:bg-kumo-tint focus-visible:ring-2 focus-visible:ring-kumo-brand focus-visible:outline-none"
          >
            <span className="flex items-baseline justify-between gap-4">
              <Text as="span" bold truncate>
                {message.subject?.trim() || '无主题'}
              </Text>
              <span className="shrink-0">
                <Text as="span" variant="secondary">
                  {formatAbsoluteTime(message.receivedAt)}
                </Text>
              </span>
            </span>
            <span className="mt-1 block truncate">
              <Text as="span" variant="secondary">
                {formatSender(message.fromAddress)} · {messagePreview(message)}
              </Text>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
