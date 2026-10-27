import { useCallback } from 'react'

import { useKumoToastManager } from '@cloudflare/kumo/components/toast'

export function useCopyAddress() {
  const toastManager = useKumoToastManager()

  return useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        toastManager.add({
          variant: 'success',
          title: '邮箱地址已复制',
          description: value,
        })
      } catch {
        toastManager.add({
          variant: 'warning',
          title: '未能自动复制地址',
          description: `请手动复制：${value}`,
        })
      }
    },
    [toastManager],
  )
}
