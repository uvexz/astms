import { useEffect, useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useKumoToastManager } from '@cloudflare/kumo/components/toast'

import { validatePrefix } from '#/features/mailbox/address'
import { CreateMailboxPane } from '#/features/mailbox/components/create-mailbox-pane'
import { InboxPane } from '#/features/mailbox/components/inbox-pane'
import {
  createMailbox,
  getMailboxPublicConfig,
  getMailboxSnapshot,
} from '#/features/mailbox/mailbox-functions'
import type {
  MailboxPhase,
  MailboxSnapshotResult,
} from '#/features/mailbox/types'
import { useBrowserAvailability } from '#/features/mailbox/use-browser-availability'
import { useCountdown } from '#/features/mailbox/use-countdown'

const SESSION_STORAGE_KEY = 'astms.current-mailbox'

export const Route = createFileRoute('/')({
  loader: () => getMailboxPublicConfig(),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.siteName ?? 'ASTMS'} — 临时邮箱`,
      },
      {
        name: 'description',
        content: `${loaderData?.siteName ?? 'ASTMS'} 是一个无需注册的临时邮箱服务。创建一个临时地址，在线期间接收邮件，离开后自动失效。`,
      },
    ],
  }),
  component: HomePage,
  errorComponent: () => (
    <div className="flex min-h-dvh items-center justify-center bg-kumo-base p-8">
      <p className="text-base text-kumo-subtle">
        服务配置暂时不可用，请稍后再试。
      </p>
    </div>
  ),
})

function HomePage() {
  const config = Route.useLoaderData()
  const queryClient = useQueryClient()
  const toastManager = useKumoToastManager()
  const { online, visible } = useBrowserAvailability()
  const inputRef = useRef<HTMLInputElement>(null)
  const inboxRef = useRef<HTMLElement>(null)

  const [phase, setPhase] = useState<MailboxPhase>('idle')
  const [address, setAddress] = useState<string | null>(null)
  const [prefix, setPrefix] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  )
  const [announcement, setAnnouncement] = useState('')
  const [isRestoring, setIsRestoring] = useState(false)
  const [pollIntervalMs, setPollIntervalMs] = useState(config.pollIntervalMs)
  const [activeWindow, setActiveWindow] = useState<{
    expiresAt: string
    serverNow: string
  } | null>(null)
  const restoredPendingRef = useRef(false)
  const previousMessageCountRef = useRef(0)
  const hasLoadedSnapshotRef = useRef(false)

  useEffect(() => {
    let stored: string | null = null

    try {
      stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
    } catch {
      stored = null
    }

    if (!stored) {
      return
    }

    restoredPendingRef.current = true
    setIsRestoring(true)
    setAddress(stored)
    setPhase('active')
    setAnnouncement('正在恢复上次的收件地址')
  }, [])

  const snapshotQuery = useQuery({
    queryKey: ['mailbox-snapshot', address],
    queryFn: () =>
      getMailboxSnapshot({
        data: { address: address as string },
      }),
    enabled: address !== null && online && visible,
    refetchInterval: pollIntervalMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    const data = snapshotQuery.data

    if (!address || !data) {
      return
    }

    if (data.status === 'expired') {
      const wasRestoring = restoredPendingRef.current

      restoredPendingRef.current = false
      previousMessageCountRef.current = 0
      hasLoadedSnapshotRef.current = false
      setIsRestoring(false)
      setSelectedMessageId(null)
      setActiveWindow(null)
      setAddress(null)
      setPhase(wasRestoring ? 'idle' : 'expired')
      setAnnouncement(wasRestoring ? '' : '临时地址已过期')

      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY)
      } catch {
        // Storage may be unavailable; the in-memory state is already cleared.
      }

      queryClient.removeQueries({
        queryKey: ['mailbox-snapshot', address],
      })
      return
    }

    const wasRestoring = restoredPendingRef.current

    restoredPendingRef.current = false
    setIsRestoring(false)
    setPhase('active')
    setPollIntervalMs(data.pollIntervalMs)

    if (wasRestoring) {
      setAnnouncement('收件状态已恢复')
    }
    setActiveWindow({ expiresAt: data.expiresAt, serverNow: data.serverNow })

    const messageCount = data.messages.length

    if (
      hasLoadedSnapshotRef.current &&
      messageCount > previousMessageCountRef.current
    ) {
      const latest = data.messages[0]
      setAnnouncement(`收到新邮件：${latest.subject?.trim() || '无主题'}`)
    }

    previousMessageCountRef.current = messageCount
    hasLoadedSnapshotRef.current = true
  }, [address, snapshotQuery.data, queryClient])

  async function copyAddressToClipboard(value: string) {
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
  }

  function scrollToInboxOnMobile() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      return
    }

    inboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const createMutation = useMutation({
    mutationFn: (value: string) =>
      createMailbox({ data: { prefix: value || undefined } }),
    onSuccess: (result) => {
      if (result.status !== 'active') {
        setFormError(result.message)
        setPhase('idle')
        setAnnouncement(result.message)
        return
      }

      restoredPendingRef.current = false
      previousMessageCountRef.current = 0
      hasLoadedSnapshotRef.current = false
      setFormError(null)
      setSelectedMessageId(null)
      setIsRestoring(false)
      setActiveWindow({
        expiresAt: result.expiresAt,
        serverNow: result.serverNow,
      })
      setPollIntervalMs(result.pollIntervalMs)

      if (!result.joinedExisting) {
        const emptySnapshot: MailboxSnapshotResult = {
          status: 'active',
          mailboxId: result.mailboxId,
          address: result.address,
          expiresAt: result.expiresAt,
          serverNow: result.serverNow,
          pollIntervalMs: result.pollIntervalMs,
          messages: [],
        }

        queryClient.setQueryData(
          ['mailbox-snapshot', result.address],
          emptySnapshot,
        )
      }

      setAddress(result.address)
      setPhase('active')
      setAnnouncement(
        result.joinedExisting
          ? '已打开现有收件地址'
          : '地址已创建，正在等待邮件',
      )

      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, result.address)
      } catch {
        // Refreshing will simply start from the idle state.
      }

      void copyAddressToClipboard(result.address)
      scrollToInboxOnMobile()
    },
    onError: () => {
      setFormError('创建失败，请检查网络后重试')
      setPhase('idle')
      setAnnouncement('创建失败，请稍后再试')
    },
  })

  const remainingSeconds = useCountdown(
    activeWindow?.expiresAt ?? null,
    activeWindow?.serverNow ?? null,
  )

  function handlePrefixChange(value: string) {
    setPrefix(value)

    if (formError) {
      setFormError(null)
    }
  }

  function handleStart() {
    if (createMutation.isPending) {
      return
    }

    const trimmed = prefix.trim()

    if (trimmed) {
      const validation = validatePrefix(trimmed)

      if (!validation.ok) {
        setFormError(validation.message)
        setAnnouncement(validation.message)
        return
      }
    }

    setFormError(null)
    setSelectedMessageId(null)
    setAnnouncement('正在创建临时地址')
    setPhase('creating')
    createMutation.mutate(trimmed)
  }

  function handleRestart() {
    setPhase('idle')
    setAnnouncement('')
    setFormError(null)
    inputRef.current?.focus()
  }

  function handleStop() {
    if (address) {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY)
      } catch {
        // Ignore storage failures; the in-memory state is cleared below.
      }

      queryClient.removeQueries({ queryKey: ['mailbox-snapshot', address] })
      setPrefix(address.slice(0, address.indexOf('@')))
    }

    restoredPendingRef.current = false
    previousMessageCountRef.current = 0
    hasLoadedSnapshotRef.current = false
    setIsRestoring(false)
    setSelectedMessageId(null)
    setActiveWindow(null)
    setAddress(null)
    setPhase('idle')
    setAnnouncement('已停止收件')
  }

  const messages =
    snapshotQuery.data?.status === 'active' ? snapshotQuery.data.messages : []
  const isReconnecting =
    address !== null && snapshotQuery.isError && online && visible

  return (
    <main className="min-h-dvh bg-kumo-base text-kumo-default lg:grid lg:h-dvh lg:grid-cols-2 lg:overflow-hidden">
      <CreateMailboxPane
        config={config}
        phase={phase}
        prefix={prefix}
        onPrefixChange={handlePrefixChange}
        onSubmit={handleStart}
        onStop={handleStop}
        isCreating={createMutation.isPending}
        formError={formError}
        activeAddress={address}
        remainingSeconds={remainingSeconds}
        paused={!online}
        inputRef={inputRef}
      />
      <InboxPane
        sectionRef={inboxRef}
        phase={phase}
        address={address}
        messages={messages}
        remainingSeconds={remainingSeconds}
        pollIntervalMs={pollIntervalMs}
        online={online}
        isReconnecting={isReconnecting}
        isRestoring={isRestoring}
        isFetching={snapshotQuery.isFetching}
        selectedMessageId={selectedMessageId}
        announcement={announcement}
        onSelectMessage={setSelectedMessageId}
        onBackToList={() => setSelectedMessageId(null)}
        onRestart={handleRestart}
      />
    </main>
  )
}
