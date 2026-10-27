import { useState } from 'react'

import { ArrowLeftIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Text } from '@cloudflare/kumo/components/text'

import { formatAbsoluteTime } from '../format'
import type { MailboxMessageView } from '../types'
import { HtmlMessageFrame, LinkifiedText } from './message-body'

export function MessageDetail({
  message,
  onBack,
}: {
  message: MailboxMessageView
  onBack: () => void
}) {
  const [view, setView] = useState<'text' | 'html'>(
    message.textBody || !message.htmlBody ? 'text' : 'html',
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          shape="square"
          icon={<ArrowLeftIcon size={16} />}
          aria-label="返回邮件列表"
          onClick={onBack}
        />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 break-words">
          <Text as="h2" variant="heading">
            {message.subject?.trim() || '无主题'}
          </Text>
          <div className="break-words">
            <Text variant="secondary">
              {message.fromAddress?.trim() || '未知发件人'} ·{' '}
              <time dateTime={message.receivedAt}>
                {formatAbsoluteTime(message.receivedAt)}
              </time>
            </Text>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="正文格式" className="flex gap-1">
          {message.textBody ? (
            <Button
              variant={view === 'text' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'text'}
              onClick={() => setView('text')}
            >
              纯文本
            </Button>
          ) : null}
          {message.htmlBody ? (
            <Button
              variant={view === 'html' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'html'}
              onClick={() => setView('html')}
            >
              HTML
            </Button>
          ) : null}
        </div>
        <Text variant="secondary">
          {view === 'html'
            ? 'HTML 已净化，远程图片默认阻止加载'
            : '文本中的链接会在新标签页打开'}
        </Text>
      </div>

      <div className="scrollbar-subtle mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg bg-kumo-base px-5 py-4 ring ring-kumo-line">
        {view === 'html' && message.htmlBody ? (
          <HtmlMessageFrame html={message.htmlBody} />
        ) : message.textBody ? (
          <LinkifiedText text={message.textBody} />
        ) : (
          <Text variant="secondary">此邮件没有可显示的正文。</Text>
        )}
      </div>
    </div>
  )
}
