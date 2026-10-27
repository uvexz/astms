import { useState } from 'react'

import {
  GithubLogoIcon,
  GlobeIcon,
  GoogleLogoIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Text } from '@cloudflare/kumo/components/text'

import { authClient } from '#/lib/auth-client'

import {
  AUTH_PROVIDER_DESCRIPTIONS,
  AUTH_PROVIDER_LABELS,
} from '../auth-providers'
import type { AuthProviderAvailability, AuthProviderId } from '../types'

interface LoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: AuthProviderAvailability
  authReady: boolean
  emailPasswordLogin: boolean
}

const PROVIDER_ICONS: Record<AuthProviderId, React.ReactNode> = {
  github: <GithubLogoIcon size={18} />,
  google: <GoogleLogoIcon size={18} />,
  sb: <GlobeIcon size={18} />,
}

const PROVIDER_ORDER: Array<AuthProviderId> = ['github', 'google', 'sb']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

function deriveViewerName(email: string): string {
  const localPart = email.slice(0, email.lastIndexOf('@')).trim()
  return localPart.slice(0, 32) || '邮箱用户'
}

function mapCredentialError(code: string | undefined): string {
  switch (code) {
    case 'EMAIL_PASSWORD_DISABLED':
    case 'EMAIL_PASSWORD_SIGN_UP_DISABLED':
      return '账号密码登录暂未开放'
    case 'INVALID_EMAIL':
      return '请输入有效的邮箱地址'
    case 'PASSWORD_TOO_SHORT':
      return `密码至少 ${PASSWORD_MIN_LENGTH} 位`
    case 'PASSWORD_TOO_LONG':
      return `密码最多 ${PASSWORD_MAX_LENGTH} 位`
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return '邮箱或密码不正确'
    case 'RATE_LIMITED':
      return '尝试过于频繁，请稍后再试'
    default:
      return '登录失败，请稍后再试'
  }
}

export function LoginDialog({
  open,
  onOpenChange,
  providers,
  authReady,
  emailPasswordLogin,
}: LoginDialogProps) {
  const [pendingProvider, setPendingProvider] = useState<AuthProviderId | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const enabledProviders = PROVIDER_ORDER.filter(
    (provider) => providers[provider],
  )
  const hasLoginMethod = enabledProviders.length > 0 || emailPasswordLogin

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen === open) {
      return
    }

    if (!nextOpen) {
      setPendingProvider(null)
      setError(null)
      setEmailBusy(false)
      setEmailError(null)
    }

    onOpenChange(nextOpen)
  }

  async function handleCredentialSignIn() {
    if (emailBusy) {
      return
    }

    const normalizedEmail = email.trim().toLowerCase()

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setEmailError('请输入有效的邮箱地址')
      return
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      setEmailError(`密码至少 ${PASSWORD_MIN_LENGTH} 位`)
      return
    }

    if (password.length > PASSWORD_MAX_LENGTH) {
      setEmailError(`密码最多 ${PASSWORD_MAX_LENGTH} 位`)
      return
    }

    setEmailBusy(true)
    setEmailError(null)

    try {
      const signIn = await authClient.signIn.email({
        email: normalizedEmail,
        password,
        callbackURL: '/dashboard',
      })

      if (!signIn.error) {
        window.location.assign('/dashboard')
        return
      }

      if (signIn.error.code !== 'INVALID_EMAIL_OR_PASSWORD') {
        setEmailError(mapCredentialError(signIn.error.code))
        setEmailBusy(false)
        return
      }

      // No account for this address yet: the first sign-in registers it.
      const signUp = await authClient.signUp.email({
        email: normalizedEmail,
        password,
        name: deriveViewerName(normalizedEmail),
        callbackURL: '/dashboard',
      })

      if (!signUp.error) {
        window.location.assign('/dashboard')
        return
      }

      if (signUp.error.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
        // Existing account with a wrong password, or a concurrent first
        // sign-in that won the race. One retry covers the race.
        const retry = await authClient.signIn.email({
          email: normalizedEmail,
          password,
          callbackURL: '/dashboard',
        })

        if (!retry.error) {
          window.location.assign('/dashboard')
          return
        }

        setEmailError('邮箱或密码不正确')
        setEmailBusy(false)
        return
      }

      setEmailError(mapCredentialError(signUp.error.code))
      setEmailBusy(false)
    } catch {
      setEmailError('登录失败，请稍后再试')
      setEmailBusy(false)
    }
  }

  async function handleSignIn(provider: AuthProviderId) {
    if (pendingProvider) {
      return
    }

    setError(null)
    setPendingProvider(provider)

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: '/dashboard',
        errorCallbackURL: '/?login=1',
      })

      if (result.error) {
        setError('登录失败，请稍后再试')
        setPendingProvider(null)
      }
    } catch {
      setError('登录失败，请稍后再试')
      setPendingProvider(null)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog className="max-h-[calc(100dvh-4rem)] overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-lg">登录</Dialog.Title>
            <Dialog.Description className="mt-1">
              <Text as="span" variant="secondary">
                {emailPasswordLogin
                  ? '登录后管理你的固定邮箱；支持第三方账号或邮箱密码。'
                  : '使用第三方账号登录，管理你的固定邮箱。'}
              </Text>
            </Dialog.Description>
          </div>
          <Dialog.Close
            aria-label="关闭登录弹窗"
            render={(props) => (
              <Button
                {...props}
                variant="ghost"
                shape="square"
                icon={<XIcon size={16} />}
                aria-label="关闭登录弹窗"
              />
            )}
          />
        </div>

        {!authReady ? (
          <Banner
            variant="secondary"
            title="登录暂未开放"
            description="登录服务尚未配置，请稍后再试。"
          />
        ) : !hasLoginMethod ? (
          <Banner
            variant="secondary"
            title="登录暂未开放"
            description="暂未配置可用的登录方式。"
          />
        ) : (
          <div className="grid gap-5">
            {enabledProviders.length > 0 ? (
              <div className="grid gap-2">
                {enabledProviders.map((provider) => (
                  <Button
                    key={provider}
                    variant="secondary"
                    size="base"
                    className="w-full"
                    icon={PROVIDER_ICONS[provider]}
                    loading={pendingProvider === provider}
                    disabled={
                      emailBusy ||
                      (pendingProvider !== null && pendingProvider !== provider)
                    }
                    onClick={() => handleSignIn(provider)}
                  >
                    {AUTH_PROVIDER_LABELS[provider]}
                  </Button>
                ))}
                <div className="mt-1">
                  <Text variant="secondary">
                    {enabledProviders
                      .map((provider) => AUTH_PROVIDER_DESCRIPTIONS[provider])
                      .join('、')}
                  </Text>
                </div>
              </div>
            ) : null}

            {emailPasswordLogin ? (
              <div className="grid gap-2 border-t border-kumo-line pt-4">
                <Text variant="secondary" bold>
                  邮箱密码登录
                </Text>
                <Text variant="secondary">
                  首次登录会自动注册账号，无需单独注册。
                </Text>
                <form
                  className="mt-1 grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleCredentialSignIn()
                  }}
                  aria-busy={emailBusy}
                >
                  <Input
                    label="邮箱"
                    type="email"
                    name="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value)

                      if (emailError) {
                        setEmailError(null)
                      }
                    }}
                  />
                  <Input
                    label="密码"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    description={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 位`}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)

                      if (emailError) {
                        setEmailError(null)
                      }
                    }}
                  />
                  {emailError ? (
                    <Text variant="error" role="alert">
                      {emailError}
                    </Text>
                  ) : null}
                  <Button
                    type="submit"
                    variant="primary"
                    size="base"
                    className="w-full"
                    loading={emailBusy}
                    disabled={emailBusy || !email.trim() || !password}
                  >
                    登录 / 注册
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <div className="mt-4">
            <Banner variant="error" title="登录失败" description={error} />
          </div>
        ) : null}

        <div className="mt-5 border-t border-kumo-line pt-4">
          <Text variant="secondary">
            仅用于登录，不保存第三方密码，也不展示第三方邮箱。登录后可创建最多
            50 个固定邮箱。
          </Text>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
