import type { RefObject } from 'react'

import { InfoIcon, StopIcon, TrayIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { InputGroup } from '@cloudflare/kumo/components/input-group'
import { Text } from '@cloudflare/kumo/components/text'

import { formatRemainingTime } from '../format'
import type { MailboxPhase, MailboxPublicConfig } from '../types'

interface CreateMailboxPaneProps {
  config: MailboxPublicConfig
  phase: MailboxPhase
  prefix: string
  onPrefixChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  isCreating: boolean
  formError: string | null
  activeAddress: string | null
  remainingSeconds: number | null
  paused: boolean
  inputRef: RefObject<HTMLInputElement | null>
}

export function CreateMailboxPane({
  config,
  phase,
  prefix,
  onPrefixChange,
  onSubmit,
  onStop,
  isCreating,
  formError,
  activeAddress,
  remainingSeconds,
  paused,
  inputRef,
}: CreateMailboxPaneProps) {
  const isActive = phase === 'active' && activeAddress !== null
  const prefixValue =
    isActive && activeAddress
      ? activeAddress.slice(0, activeAddress.indexOf('@'))
      : prefix
  const brand = config.siteName.startsWith('@')
    ? config.siteName
    : `@${config.siteName}`
  const statusVariant = paused
    ? 'warning'
    : remainingSeconds !== null && remainingSeconds <= 10
      ? 'warning'
      : 'success'

  return (
    <section className="flex min-h-dvh flex-col bg-kumo-base lg:h-dvh lg:min-h-0">
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <Text as="p" variant="secondary" bold>
            {brand}
          </Text>

          <form
            className="mt-6 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()

              if (!isActive) {
                onSubmit()
              }
            }}
            aria-busy={isCreating}
          >
            <InputGroup
              label="邮箱前缀"
              description={
                isActive
                  ? `页面保持在前台会每 ${Math.round(config.pollIntervalMs / 1_000)} 秒自动续期。`
                  : `${config.prefixRuleMessage}。留空将随机生成 10–12 位地址。`
              }
              error={
                formError ? { message: formError, match: true } : undefined
              }
              disabled={isCreating}
              size="base"
              className="w-full"
            >
              <InputGroup.Input
                ref={inputRef}
                value={prefixValue}
                onChange={(event) => onPrefixChange(event.target.value)}
                readOnly={isActive}
                placeholder="输入前缀，留空随机生成"
                maxLength={64}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                passwordManagerIgnore
                aria-label="邮箱前缀"
              />
              <InputGroup.Suffix>@{config.domain}</InputGroup.Suffix>
            </InputGroup>

            {isActive ? (
              <Button
                key="stop"
                type="button"
                variant="secondary"
                size="base"
                className="w-full"
                icon={<StopIcon size={16} />}
                onClick={onStop}
              >
                停止收件
              </Button>
            ) : (
              <Button
                key="start"
                type="submit"
                variant="primary"
                size="base"
                className="w-full"
                loading={isCreating}
                disabled={isCreating}
                icon={<TrayIcon size={16} />}
              >
                {isCreating ? '正在准备地址…' : '开始收件'}
              </Button>
            )}
          </form>

          {isActive ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant} appearance="dot">
                {paused ? '已暂停' : '收件中'}
              </Badge>
              <Text variant="secondary">
                {remainingSeconds === null
                  ? '正在同步有效期…'
                  : `剩余 ${formatRemainingTime(remainingSeconds)}`}
              </Text>
            </div>
          ) : null}

          {phase === 'expired' ? (
            <div className="mt-3">
              <Text variant="secondary">
                上一个地址已过期，再次开始会创建新地址。
              </Text>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex justify-center px-6 pb-8">
        <Banner
          className="w-full max-w-md"
          variant="secondary"
          icon={<InfoIcon size={18} weight="fill" />}
          description="知道此地址的人都能查看邮件，请勿用于敏感信息；页面离开前台后地址会很快失效。"
        />
      </div>
    </section>
  )
}
