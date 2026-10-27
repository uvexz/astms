import {
  CopyIcon,
  EnvelopeSimpleIcon,
  HouseIcon,
  InfoIcon,
  SignOutIcon,
  TrashIcon,
  UserCircleIcon,
} from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Text } from '@cloudflare/kumo/components/text'

import { getProviderLabel } from '#/features/auth/auth-providers'
import type { ViewerUser } from '#/features/auth/types'

import { formatAbsoluteTime } from '../format'
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
          <span className="max-w-24 truncate text-sm text-kumo-subtle">
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

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5">
        <div>
          <div className="flex items-center justify-between gap-2">
            <Text as="h1" variant="heading">
              我的邮箱
            </Text>
            <Badge variant={atLimit ? 'warning' : 'secondary'}>
              {used} / {config.limit}
            </Badge>
          </div>
          <div className="mt-1">
            <Text variant="secondary" size="sm">
              固定邮箱不会过期；满 {config.limit}{' '}
              个后新建会自动删除最久未打开的一个。
            </Text>
          </div>
        </div>

        <CreateFixedMailboxForm
          config={config}
          prefix={prefix}
          onPrefixChange={onPrefixChange}
          onSubmit={onCreate}
          isCreating={isCreating}
          error={createError}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
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
              title="还没有固定邮箱"
              description="输入前缀或留空随机生成第一个固定邮箱。"
            />
          ) : (
            <ul className="flex min-w-0 flex-col gap-1.5">
              {mailboxes.map((mailbox) => {
                const selected = mailbox.id === selectedMailboxId

                return (
                  <li key={mailbox.id} className="min-w-0">
                    <div
                      className={
                        selected
                          ? 'flex items-center gap-1 rounded-lg bg-kumo-tint px-1.5 py-1.5 ring-2 ring-kumo-brand'
                          : 'flex items-center gap-1 rounded-lg px-1.5 py-1.5 hover:bg-kumo-tint/60'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => onSelectMailbox(mailbox)}
                        className="min-w-0 flex-1 rounded-md px-2 py-1 text-left focus-visible:ring-2 focus-visible:ring-kumo-brand focus-visible:outline-none"
                        aria-current={selected ? 'true' : undefined}
                      >
                        <span className="block min-w-0">
                          <Text as="span" bold truncate>
                            {mailbox.address}
                          </Text>
                        </span>
                        <span className="block">
                          <Text as="span" variant="secondary" size="sm">
                            创建于 {formatAbsoluteTime(mailbox.createdAt)}
                          </Text>
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        shape="square"
                        size="sm"
                        icon={<CopyIcon size={16} />}
                        aria-label={`复制邮箱地址 ${mailbox.address}`}
                        onClick={() => onCopyAddress(mailbox.address)}
                      />
                      <Button
                        variant="ghost"
                        shape="square"
                        size="sm"
                        icon={<TrashIcon size={16} />}
                        aria-label={`删除邮箱 ${mailbox.address}`}
                        disabled={isDeleting}
                        onClick={() => onDeleteMailbox(mailbox)}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="px-5 pb-5">
        <Banner
          variant="secondary"
          icon={<InfoIcon size={18} weight="fill" />}
          description="固定邮箱只有你能查看；地址可以分享给任何人用于收信。"
        />
      </div>
    </aside>
  )
}
