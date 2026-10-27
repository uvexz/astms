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
  onCreateTemporaryMailbox: () => void
  isCreating: boolean
  error: string | null
}

export function CreateFixedMailboxForm({
  config,
  prefix,
  onPrefixChange,
  onSubmit,
  onCreateTemporaryMailbox,
  isCreating,
  error,
}: CreateFixedMailboxFormProps) {
  const normalizedPrefix = normalizeFixedPrefix(prefix)
  const showPreview =
    prefix.includes('.') && normalizedPrefix.length > 0 && !error

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      aria-busy={isCreating}
    >
      <div className="grid gap-1.5">
        <InputGroup
          error={error ? { message: error, match: true } : undefined}
          disabled={isCreating}
          size="base"
          className="w-full"
        >
          <InputGroup.Input
            value={prefix}
            onChange={(event) => onPrefixChange(event.target.value)}
            placeholder="输入前缀，留空随机"
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
          <Text variant="secondary">
            点号会被忽略，将创建 {normalizedPrefix}@{config.domain}
          </Text>
        ) : (
          <Text variant="secondary">3–32 位，字母、数字或 -</Text>
        )}
      </div>

      {error ? (
        <Text variant="error" role="alert">
          {error}
        </Text>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="submit"
          variant="primary"
          size="base"
          className="w-full"
          loading={isCreating}
          disabled={isCreating}
          icon={<PlusIcon size={16} />}
        >
          创建邮箱
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="base"
          className="w-full"
          onClick={onCreateTemporaryMailbox}
        >
          创建临时邮箱
        </Button>
      </div>
    </form>
  )
}
