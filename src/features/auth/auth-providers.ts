import type { AuthProviderId } from './types'

export const AUTH_PROVIDER_LABELS: Record<AuthProviderId, string> = {
  github: 'GitHub',
  google: 'Google',
  sb: 'SB.SB 论坛',
}

export const AUTH_PROVIDER_DESCRIPTIONS: Record<AuthProviderId, string> = {
  github: '使用 GitHub 账号登录',
  google: '使用 Google 账号登录',
  sb: '使用 SB.SB 论坛账号登录',
}

export function getProviderLabel(provider: string | null): string | null {
  if (!provider) {
    return null
  }

  if (provider === 'credential') {
    return '邮箱密码'
  }

  return provider in AUTH_PROVIDER_LABELS
    ? AUTH_PROVIDER_LABELS[provider as AuthProviderId]
    : provider
}
