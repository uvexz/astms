import { PlusIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { InputGroup } from '@cloudflare/kumo/components/input-group'
import { Text } from '@cloudflare/kumo/components/text'

import { normalizeFixedPrefix } from '../address'
import type { DashboardConfig } from '../types'

interface CreateFixedMailboxFormProps {
  config: DashboardConfig
  prefix: string
  onPrefixChange: (value: string) => void
  onSubmit: () => void
  isCreating: boolean
  error: string | null
}

export function CreateFixedMailboxForm({
  config,
  prefix,
  onPrefixChange,
  onSubmit,
  isCreating,
  error,
}: CreateFixedMailboxFormProps) {
  const normalizedPrefix = normalizeFixedPrefix(prefix)
  const showPreview =
    prefix.includes('.') && normalizedPrefix.length > 0 && !error

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      aria-busy={isCreating}
    >
      <InputGroup
        error={error ? { message: error, match: true } : undefined}
        disabled={isCreating}
        size="base"
        className="w-full"
      >
        <InputGroup.Input
          value={prefix}
          onChange={(event) => onPrefixChange(event.target.value)}
          placeholder="输入前缀，留空随机生成"
          maxLength={64}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          passwordManagerIgnore
          aria-label="固定邮箱前缀"
        />
        <InputGroup.Suffix>@{config.domain}</InputGroup.Suffix>
      </InputGroup>

      {showPreview ? (
        <Text variant="secondary" size="sm">
          点号会被忽略，将创建 {normalizedPrefix}@{config.domain}
        </Text>
      ) : null}

      {error ? (
        <Text variant="error" size="sm" role="alert">
          {error}
        </Text>
      ) : (
        <Text variant="secondary" size="sm">
          {config.prefixRuleMessage}
        </Text>
      )}

      <Button
        type="submit"
        variant="primary"
        size="base"
        className="w-full"
        loading={isCreating}
        disabled={isCreating}
        icon={<PlusIcon size={16} />}
      >
        创建固定邮箱
      </Button>
    </form>
  )
}
