import { useState } from 'react'
import type { RefObject } from 'react'

import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ClockCountdownIcon,
  EnvelopeSimpleIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { InlineCopyText } from '@cloudflare/kumo/components/inline-copy-text'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Text } from '@cloudflare/kumo/components/text'

import {
  formatAbsoluteTime,
  formatRemainingTime,
  formatSender,
  messagePreview,
} from '../format'
import type { MailboxMessageView, MailboxPhase } from '../types'
import { MatrixRain } from './matrix-rain'
import { HtmlMessageFrame, LinkifiedText } from './message-body'

type StatusVariant = 'success' | 'warning' | 'error' | 'info'

interface InboxPaneProps {
  sectionRef: RefObject<HTMLElement | null>
  phase: MailboxPhase
  address: string | null
  messages: Array<MailboxMessageView>
  remainingSeconds: number | null
  pollIntervalMs: number
  online: boolean
  isReconnecting: boolean
  isRestoring: boolean
  isFetching: boolean
  selectedMessageId: string | null
  announcement: string
  onSelectMessage: (messageId: string) => void
  onBackToList: () => void
  onRestart: () => void
}

function getStatus(props: InboxPaneProps): {
  variant: StatusVariant
  label: string
} {
  if (!props.online) {
    return { variant: 'warning', label: '已暂停' }
  }

  if (props.isReconnecting) {
    return { variant: 'error', label: '重连中' }
  }

  if (props.isRestoring || (props.isFetching && props.messages.length === 0)) {
    return { variant: 'info', label: '同步中' }
  }

  if (props.remainingSeconds !== null && props.remainingSeconds <= 10) {
    return { variant: 'warning', label: '即将失效' }
  }

  return { variant: 'success', label: '收件中' }
}

export function InboxPane(props: InboxPaneProps) {
  const selectedMessage = props.selectedMessageId
    ? (props.messages.find(
        (message) => message.id === props.selectedMessageId,
      ) ?? null)
    : null
  const status = getStatus(props)
  const showMatrixRain = props.messages.length === 0

  return (
    <section
      ref={props.sectionRef}
      aria-label="收件箱"
      className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-kumo-recessed text-kumo-default lg:h-dvh lg:min-h-0"
    >
      {showMatrixRain ? (
        <MatrixRain className="pointer-events-none absolute inset-0 -z-10 h-full w-full text-kumo-success" />
      ) : null}

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {props.announcement}
      </div>

      {props.phase === 'idle' ? (
        <div className="flex flex-1 items-center justify-center px-6 py-12 lg:px-20">
          <Empty
            size="lg"
            className="border-0 bg-transparent"
            title="准备开始"
            description="在左侧输入前缀，或直接点击“开始收件”。"
          />
        </div>
      ) : null}

      {props.phase === 'creating' ? (
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <Empty
            size="lg"
            className="border-0 bg-transparent"
            icon={<Loader size="lg" />}
            title="正在准备地址"
            description="马上就好，正在创建临时收件箱。"
          />
        </div>
      ) : null}

      {props.phase === 'expired' ? (
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <Empty
            size="sm"
            className="border-0 bg-transparent"
            icon={
              <ClockCountdownIcon
                size={40}
                weight="duotone"
                className="text-kumo-warning"
              />
            }
            title="地址已过期"
            description="离开前台超过有效期后，地址与邮件不再保留。"
            contents={
              <Button
                variant="primary"
                icon={<ArrowCounterClockwiseIcon size={16} />}
                onClick={props.onRestart}
              >
                重新开始
              </Button>
            }
          />
        </div>
      ) : null}

      {props.phase === 'active' ? (
        <>
          <div className="flex items-start justify-between gap-4 px-6 pt-8 pb-4 sm:px-8 lg:px-20 lg:pt-20">
            <div className="grid min-w-0 gap-1.5">
              <Text as="h2" variant="heading">
                收件箱
              </Text>
              {props.address ? (
                <InlineCopyText
                  value={props.address}
                  variant="body"
                  truncate
                  labels={{
                    copyAction: `复制邮箱地址 ${props.address}`,
                    copied: '邮箱地址已复制',
                  }}
                >
                  {props.address}
                </InlineCopyText>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Badge variant={status.variant}>{status.label}</Badge>
              {props.remainingSeconds !== null ? (
                <Text variant="secondary">
                  剩余 {formatRemainingTime(props.remainingSeconds)}
                </Text>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-8 sm:px-8 lg:px-20">
            {!props.online ? (
              <Banner
                className="mb-4"
                variant="alert"
                icon={<WifiSlashIcon size={18} weight="fill" />}
                title="网络已断开"
                description="恢复后会自动继续收件，离线期间不会续期。"
              />
            ) : null}

            {props.isReconnecting && props.online ? (
              <Banner
                className="mb-4"
                variant="error"
                icon={<WarningCircleIcon size={18} weight="fill" />}
                title="同步中断"
                description="正在自动重试，页面保持在前台即可继续收件。"
              />
            ) : null}

            {props.isRestoring ? (
              <div className="flex flex-1 items-center justify-center">
                <Empty
                  size="sm"
                  className="border-0 bg-transparent"
                  icon={<Loader size="lg" />}
                  title="正在恢复收件状态"
                  description="正在确认地址是否仍在有效期内。"
                />
              </div>
            ) : selectedMessage ? (
              <MessageDetail
                key={selectedMessage.id}
                message={selectedMessage}
                onBack={props.onBackToList}
              />
            ) : props.messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <Empty
                  size="sm"
                  className="border-0 bg-transparent"
                  icon={
                    <EnvelopeSimpleIcon
                      size={36}
                      weight="duotone"
                      className="text-kumo-inactive"
                    />
                  }
                  title="正在等待邮件"
                  description="保持页面在前台，新邮件会自动出现在这里。"
                />
              </div>
            ) : (
              <ul className="flex min-w-0 flex-col gap-2">
                {props.messages.map((message) => (
                  <li key={message.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => props.onSelectMessage(message.id)}
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
                          {formatSender(message.fromAddress)} ·{' '}
                          {messagePreview(message)}
                        </Text>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}

function MessageDetail({
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

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg bg-kumo-base p-5 ring ring-kumo-line">
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
