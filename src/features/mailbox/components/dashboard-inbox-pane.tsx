import type { RefObject } from 'react'

import {
  EnvelopeSimpleIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Empty } from '@cloudflare/kumo/components/empty'
import { InlineCopyText } from '@cloudflare/kumo/components/inline-copy-text'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Text } from '@cloudflare/kumo/components/text'

import type { DashboardMailbox, MailboxMessageView } from '../types'
import { MessageDetail } from './message-detail'
import { MessageList } from './message-list'

type StatusVariant = 'success' | 'warning' | 'error' | 'info'

interface DashboardInboxPaneProps {
  sectionRef: RefObject<HTMLElement | null>
  mailbox: DashboardMailbox | null
  messages: Array<MailboxMessageView>
  selectedMessageId: string | null
  onSelectMessage: (messageId: string) => void
  onBackToList: () => void
  online: boolean
  isFetching: boolean
  isReconnecting: boolean
  announcement: string
  messageLimit: number
}

function getStatus(props: DashboardInboxPaneProps): {
  variant: StatusVariant
  label: string
} {
  if (!props.online) {
    return { variant: 'warning', label: '已暂停' }
  }

  if (props.isReconnecting) {
    return { variant: 'error', label: '重连中' }
  }

  if (props.isFetching && props.messages.length === 0) {
    return { variant: 'info', label: '同步中' }
  }

  return { variant: 'success', label: '收件中' }
}

export function DashboardInboxPane(props: DashboardInboxPaneProps) {
  const selectedMessage = props.selectedMessageId
    ? (props.messages.find(
        (message) => message.id === props.selectedMessageId,
      ) ?? null)
    : null
  const status = getStatus(props)

  return (
    <section
      ref={props.sectionRef}
      aria-label="固定邮箱收件箱"
      className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-kumo-recessed text-kumo-default lg:h-dvh lg:min-h-0"
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {props.announcement}
      </div>

      {!props.mailbox ? (
        <div className="flex flex-1 items-center justify-center px-6 py-12 lg:px-20">
          <Empty
            size="lg"
            className="border-0 bg-transparent"
            icon={
              <EnvelopeSimpleIcon
                size={48}
                weight="duotone"
                className="text-kumo-inactive"
              />
            }
            title="选择一个固定邮箱"
            description="在左侧创建或选择邮箱后，即可在这里查看邮件。"
          />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4 px-6 pt-8 pb-4 sm:px-8 lg:px-16 lg:pt-16">
            <div className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Text as="h2" variant="heading">
                  收件箱
                </Text>
                <Badge variant="secondary">固定邮箱</Badge>
              </div>
              <InlineCopyText
                value={props.mailbox.address}
                variant="body"
                truncate
                labels={{
                  copyAction: `复制邮箱地址 ${props.mailbox.address}`,
                  copied: '邮箱地址已复制',
                }}
              >
                {props.mailbox.address}
              </InlineCopyText>
              <Text variant="secondary" size="sm">
                不会过期，邮件会一直保留；关闭页面也不会丢失。
              </Text>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-8 sm:px-8 lg:px-16">
            {!props.online ? (
              <Banner
                className="mb-4"
                variant="alert"
                icon={<WifiSlashIcon size={18} weight="fill" />}
                title="网络已断开"
                description="恢复后会自动继续同步；固定邮箱的邮件不会丢失。"
              />
            ) : null}

            {props.isReconnecting && props.online ? (
              <Banner
                className="mb-4"
                variant="error"
                icon={<WarningCircleIcon size={18} weight="fill" />}
                title="同步中断"
                description="正在自动重试，你也可以稍后手动刷新。"
              />
            ) : null}

            {props.isFetching && props.messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <Empty
                  size="sm"
                  className="border-0 bg-transparent"
                  icon={<Loader size="lg" />}
                  title="正在同步邮件"
                  description="正在读取这个固定邮箱的邮件。"
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
                  description="把地址分享给需要的服务即可收信；邮件会一直保留。"
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MessageList
                  messages={props.messages}
                  onSelectMessage={props.onSelectMessage}
                />
                {props.messages.length >= props.messageLimit ? (
                  <div className="mt-3">
                    <Text variant="secondary" size="sm">
                      仅显示最近 {props.messageLimit} 封邮件。
                    </Text>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
