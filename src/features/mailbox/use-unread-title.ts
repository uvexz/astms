import { useEffect, useRef, useState } from 'react'

import { useQuery } from '@tanstack/react-query'

import { peekMailbox } from './mailbox-functions'

const UNREAD_TITLE = '您有一封未读邮件'

interface UseUnreadTitleOptions {
  address: string | null
  baseTitle: string
  latestMessageId: string | null
  pollIntervalMs: number
  visible: boolean
  online: boolean
}

export function useUnreadTitle(options: UseUnreadTitleOptions): void {
  const [hasUnread, setHasUnread] = useState(false)
  const [peekStopped, setPeekStopped] = useState(false)
  const hiddenSinceRef = useRef(0)

  useEffect(() => {
    hiddenSinceRef.current = options.visible ? 0 : Date.now()
    setHasUnread(false)
    setPeekStopped(false)
  }, [options.visible, options.address])

  const peekQuery = useQuery({
    queryKey: ['mailbox-peek', options.address],
    queryFn: () =>
      peekMailbox({ data: { address: options.address as string } }),
    enabled:
      options.address !== null &&
      !options.visible &&
      options.online &&
      !peekStopped,
    refetchInterval: options.pollIntervalMs,
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    const data = peekQuery.data

    if (options.visible || !data) {
      return
    }

    if (peekQuery.dataUpdatedAt < hiddenSinceRef.current) {
      return
    }

    if (data.status === 'expired') {
      setPeekStopped(true)
      setHasUnread(false)
      return
    }

    if (data.latestMessageId !== options.latestMessageId) {
      setHasUnread(true)
    }
  }, [
    options.visible,
    options.latestMessageId,
    peekQuery.data,
    peekQuery.dataUpdatedAt,
  ])

  useEffect(() => {
    document.title = hasUnread
      ? `（${UNREAD_TITLE}）${options.baseTitle}`
      : options.baseTitle
  }, [hasUnread, options.baseTitle])
}
