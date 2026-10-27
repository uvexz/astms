import {
  CopyIcon,
  EnvelopeSimpleIcon,
  HouseIcon,
  SignOutIcon,
  TrashIcon,
  UserCircleIcon,
} from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Text } from '@cloudflare/kumo/components/text'

import { getProviderLabel } from '#/features/auth/auth-providers'
import type { ViewerUser } from '#/features/auth/types'

import { formatShortDateTime } from '../format'
import type { DashboardConfig, DashboardMailbox } from '../types'
import { CreateFixedMailboxForm } from './create-fixed-mailbox-form'

interface DashboardSidebarProps {
  viewer: ViewerUser
  config: DashboardConfig
  mailboxes: Array<DashboardMailbox>
  selectedMailboxId: string | null
  prefix: string
  createError: string | null
  isCreating: boolean
  isDeleting: boolean
  onPrefixChange: (value: string) => void
  onCreate: () => void
  onCreateTemporaryMailbox: () => void
  onSelectMailbox: (mailbox: DashboardMailbox) => void
  onDeleteMailbox: (mailbox: DashboardMailbox) => void
  onCopyAddress: (address: string) => void
  onBackHome: () => void
  onSignOut: () => void
}

function ViewerAvatar({ viewer }: { viewer: ViewerUser }) {
  if (!viewer.image) {
    return <UserCircleIcon size={16} />
  }

  return (
    <img
      src={viewer.image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="h-5 w-5 rounded-full object-cover"
    />
  )
}

export function DashboardSidebar({
  viewer,
  config,
  mailboxes,
  selectedMailboxId,
  prefix,
  createError,
  isCreating,
  isDeleting,
  onPrefixChange,
  onCreate,
  onCreateTemporaryMailbox,
  onSelectMailbox,
  onDeleteMailbox,
  onCopyAddress,
  onBackHome,
  onSignOut,
}: DashboardSidebarProps) {
  const brand = config.siteName.startsWith('@')
    ? config.siteName
    : `@${config.siteName}`
  const providerLabel = getProviderLabel(viewer.provider)
  const used = mailboxes.length
  const atLimit = used >= config.limit

  return (
    <aside className="flex min-h-dvh flex-col bg-kumo-base lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-5 pt-5">
        <Text as="p" variant="secondary" bold>
          {brand}
        </Text>

        <div
          className="flex min-w-0 items-center gap-1"
          title={`${providerLabel ? `${providerLabel} 账号` : '当前账号'} · ${viewer.name}`}
        >
          <ViewerAvatar viewer={viewer} />
          <span className="max-w-24 truncate text-[14px] text-kumo-subtle">
            {viewer.name}
          </span>
          <Button
            variant="ghost"
            shape="square"
            size="sm"
            icon={<HouseIcon size={16} />}
            aria-label="返回首页"
            title="返回首页"
            onClick={onBackHome}
          />
          <Button
            variant="ghost"
            shape="square"
            size="sm"
            icon={<SignOutIcon size={16} />}
            aria-label="退出登录"
            title="退出登录"
            onClick={onSignOut}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <Text as="h1" variant="heading">
            我的邮箱
          </Text>
          <span title={`满 ${config.limit} 个后，新建会移除最久未打开的邮箱`}>
            <Badge variant={atLimit ? 'warning' : 'secondary'}>
              {used} / {config.limit}
            </Badge>
          </span>
        </div>

        <CreateFixedMailboxForm
          config={config}
          prefix={prefix}
          onPrefixChange={onPrefixChange}
          onSubmit={onCreate}
          onCreateTemporaryMailbox={onCreateTemporaryMailbox}
          isCreating={isCreating}
          error={createError}
        />

        <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
          {mailboxes.length === 0 ? (
            <Empty
              size="sm"
              className="border-0 bg-transparent"
              icon={
                <EnvelopeSimpleIcon
                  size={32}
                  weight="duotone"
                  className="text-kumo-inactive"
                />
              }
              title="还没有邮箱"
              description="输入前缀或留空，创建第一个邮箱。"
            />
          ) : (
            <ul className="flex min-w-0 flex-col gap-0.5">
              {mailboxes.map((mailbox) => {
                const selected = mailbox.id === selectedMailboxId

                return (
                  <li key={mailbox.id} className="group/row min-w-0">
                    <div
                      className={[
                        'relative flex min-w-0 items-center gap-0.5 rounded-lg p-1',
                        selected
                          ? 'bg-kumo-tint'
                          : 'hover:bg-kumo-tint/60 focus-within:bg-kumo-tint/60',
                      ].join(' ')}
                    >
                      {selected ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-kumo-brand"
                        />
                      ) : null}

                      <button
                        type="button"
                        onClick={() => onSelectMailbox(mailbox)}
                        aria-current={selected ? 'true' : undefined}
                        title={`${mailbox.address} · 创建于 ${formatShortDateTime(mailbox.createdAt)}`}
                        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded px-2 py-1 text-left focus-visible:ring-2 focus-visible:ring-kumo-brand focus-visible:outline-none"
                      >
                        <Text as="span" bold truncate>
                          {mailbox.address}
                        </Text>
                        <Text
                          as="span"
                          variant={
                            mailbox.unreadCount > 0 ? 'body' : 'secondary'
                          }
                          truncate
                        >
                          {mailbox.unreadCount > 0
                            ? `${mailbox.unreadCount} 封未读 / ${mailbox.messageCount} 封邮件`
                            : `${mailbox.messageCount} 封邮件`}
                        </Text>
                      </button>

                      <div className="flex shrink-0 items-center opacity-100 lg:opacity-0 lg:group-hover/row:opacity-100 lg:group-focus-within/row:opacity-100">
                        <Button
                          variant="ghost"
                          shape="square"
                          size="sm"
                          icon={<CopyIcon size={16} />}
                          aria-label={`复制邮箱地址 ${mailbox.address}`}
                          title="复制地址"
                          onClick={() => onCopyAddress(mailbox.address)}
                        />
                        <Button
                          variant="ghost"
                          shape="square"
                          size="sm"
                          icon={<TrashIcon size={16} />}
                          aria-label={`删除邮箱 ${mailbox.address}`}
                          title="删除邮箱"
                          disabled={isDeleting}
                          onClick={() => onDeleteMailbox(mailbox)}
                        />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  )
}
