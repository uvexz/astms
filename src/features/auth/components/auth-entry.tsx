import { SignInIcon, UserCircleIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'

import type { ViewerUser } from '../types'

interface AuthEntryProps {
  viewer: ViewerUser | null
  onLoginClick: () => void
  onDashboardClick: () => void
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

export function AuthEntry({
  viewer,
  onLoginClick,
  onDashboardClick,
}: AuthEntryProps) {
  if (viewer) {
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={<ViewerAvatar viewer={viewer} />}
        onClick={onDashboardClick}
        title={`${viewer.name} · 进入后台`}
        aria-label={`进入后台，当前账号 ${viewer.name}`}
      >
        进入后台
      </Button>
    )
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<SignInIcon size={16} />}
      onClick={onLoginClick}
    >
      登录
    </Button>
  )
}
