import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { XIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Text } from '@cloudflare/kumo/components/text'
import { useKumoToastManager } from '@cloudflare/kumo/components/toast'

import { getViewer } from '#/features/auth/auth-functions'
import { validateFixedPrefix } from '#/features/mailbox/address'
import { DashboardInboxPane } from '#/features/mailbox/components/dashboard-inbox-pane'
import { DashboardSidebar } from '#/features/mailbox/components/dashboard-sidebar'
import {
  createMyMailbox,
  deleteMyMailbox,
  getDashboardConfig,
  getMyMailboxSnapshot,
  listMyMailboxes,
  markMyMessageRead,
} from '#/features/mailbox/owned-mailbox-functions'
import type {
  DashboardMailbox,
  ListMyMailboxesResult,
} from '#/features/mailbox/types'
import { useBrowserAvailability } from '#/features/mailbox/use-browser-availability'
import { useCopyAddress } from '#/features/mailbox/use-copy-address'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/dashboard')({
  validateSearch: (search: Record<string, unknown>) => {
    const result: { mailbox?: string } = {}

    if (typeof search.mailbox === 'string') {
      result.mailbox = search.mailbox
    }

    return result
  },
  beforeLoad: async () => {
    const viewer = await getViewer()

    if (!viewer.user) {
      throw redirect({ to: '/', search: { login: true } })
    }

    return { viewer }
  },
  loader: async ({ context }) => {
    const [list, config] = await Promise.all([
      listMyMailboxes(),
      getDashboardConfig(),
    ])

    if (list.status !== 'ok' || !context.viewer.user) {
      throw redirect({ to: '/', search: { login: true } })
    }

    return {
      viewer: context.viewer.user,
      mailboxes: list.mailboxes,
      config,
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.config.siteName ?? 'ASTMS'} — 我的邮箱`,
      },
      {
        name: 'description',
        content: '管理固定邮箱与收件。',
      },
    ],
  }),
  component: DashboardPage,
  errorComponent: () => (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-kumo-base p-8">
      <Text variant="secondary">后台暂时不可用，请稍后再试。</Text>
      <Button variant="secondary" onClick={() => window.location.assign('/')}>
        返回首页
      </Button>
    </div>
  ),
})

function DashboardPage() {
  const { viewer, mailboxes: initialMailboxes, config } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const toastManager = useKumoToastManager()
  const copyAddress = useCopyAddress()
  const { online, visible } = useBrowserAvailability()
  const inboxRef = useRef<HTMLElement>(null)
  const redirectingRef = useRef(false)
  const previousMailboxIdRef = useRef<string | null>(null)
  const previousMessageCountRef = useRef(0)
  const hasLoadedSnapshotRef = useRef(false)

  const [prefix, setPrefix] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  )
  const [announcement, setAnnouncement] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DashboardMailbox | null>(
    null,
  )

  const handleUnauthorized = useCallback(() => {
    if (redirectingRef.current) {
      return
    }

    redirectingRef.current = true
    queryClient.clear()
    toastManager.add({
      variant: 'warning',
      title: '登录已过期，请重新登录',
    })
    void router.invalidate().finally(() => {
      void navigate({ to: '/', search: { login: true }, replace: true })
    })
  }, [navigate, queryClient, router, toastManager])

  const listQuery = useQuery({
    queryKey: ['my-mailboxes'],
    queryFn: () => listMyMailboxes(),
    initialData: {
      status: 'ok',
      mailboxes: initialMailboxes,
      limit: config.limit,
    } satisfies ListMyMailboxesResult,
    enabled: online && visible,
    refetchInterval: config.pollIntervalMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  })

  const mailboxes =
    listQuery.data.status === 'ok' ? listQuery.data.mailboxes : []
  const sortedMailboxes = useMemo(() => {
    const unread = mailboxes.filter((mailbox) => mailbox.unreadCount > 0)

    if (unread.length === 0) {
      return mailboxes
    }

    return [
      ...unread,
      ...mailboxes.filter((mailbox) => mailbox.unreadCount === 0),
    ]
  }, [mailboxes])
  const selectedMailbox = useMemo(() => {
    if (search.mailbox) {
      const matched = sortedMailboxes.find(
        (mailbox) => mailbox.id === search.mailbox,
      )

      if (matched) {
        return matched
      }
    }

    return sortedMailboxes.at(0) ?? null
  }, [search.mailbox, sortedMailboxes])

  const snapshotQuery = useQuery({
    queryKey: ['my-mailbox-snapshot', selectedMailbox?.id ?? 'none'],
    queryFn: () =>
      getMyMailboxSnapshot({
        data: { mailboxId: selectedMailbox?.id as string },
      }),
    enabled: selectedMailbox !== null && online && visible,
    refetchInterval: config.pollIntervalMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const messages =
    snapshotQuery.data?.status === 'active' ? snapshotQuery.data.messages : []

  useEffect(() => {
    if (listQuery.data.status === 'unauthenticated') {
      handleUnauthorized()
    }
  }, [handleUnauthorized, listQuery.data])

  useEffect(() => {
    if (snapshotQuery.data?.status === 'unauthenticated') {
      handleUnauthorized()
    }
  }, [handleUnauthorized, snapshotQuery.data])

  useEffect(() => {
    if (selectedMailbox && search.mailbox !== selectedMailbox.id) {
      void navigate({
        search: { mailbox: selectedMailbox.id },
        replace: true,
      })
    } else if (!selectedMailbox && search.mailbox) {
      void navigate({ search: {}, replace: true })
    }
  }, [navigate, search.mailbox, selectedMailbox])

  useEffect(() => {
    if (previousMailboxIdRef.current === (selectedMailbox?.id ?? null)) {
      return
    }

    previousMailboxIdRef.current = selectedMailbox?.id ?? null
    previousMessageCountRef.current = 0
    hasLoadedSnapshotRef.current = false
    setSelectedMessageId(null)
  }, [selectedMailbox?.id])

  useEffect(() => {
    const data = snapshotQuery.data

    if (!data || data.status !== 'active') {
      return
    }

    const count = data.messages.length

    if (
      hasLoadedSnapshotRef.current &&
      count > previousMessageCountRef.current
    ) {
      setAnnouncement(
        `收到新邮件：${data.messages[0]?.subject?.trim() || '无主题'}`,
      )
    }

    previousMessageCountRef.current = count
    hasLoadedSnapshotRef.current = true
  }, [snapshotQuery.data])

  useEffect(() => {
    if (snapshotQuery.data?.status !== 'not_found' || !selectedMailbox) {
      return
    }

    const removedId = selectedMailbox.id

    queryClient.setQueryData<ListMyMailboxesResult>(
      ['my-mailboxes'],
      (previous) =>
        previous && previous.status === 'ok'
          ? {
              ...previous,
              mailboxes: previous.mailboxes.filter(
                (mailbox) => mailbox.id !== removedId,
              ),
            }
          : previous,
    )
    queryClient.removeQueries({
      queryKey: ['my-mailbox-snapshot', removedId],
    })
    setSelectedMessageId(null)
    toastManager.add({
      variant: 'warning',
      title: '邮箱已被删除',
    })
    void queryClient.invalidateQueries({ queryKey: ['my-mailboxes'] })
  }, [queryClient, selectedMailbox, snapshotQuery.data, toastManager])

  const createMutation = useMutation({
    mutationFn: (value: string) =>
      createMyMailbox({ data: { prefix: value || undefined } }),
    onSuccess: (result) => {
      if (result.status === 'unauthenticated') {
        handleUnauthorized()
        return
      }

      if (result.status !== 'active') {
        setCreateError(result.message)
        setAnnouncement(result.message)
        return
      }

      setCreateError(null)
      setPrefix('')
      setAnnouncement(result.created ? '固定邮箱已创建' : '已打开现有固定邮箱')

      if (result.evictedAddress) {
        toastManager.add({
          variant: 'warning',
          title: '已移除最久未打开的邮箱',
          description: result.evictedAddress,
        })
      }

      queryClient.setQueryData<ListMyMailboxesResult>(
        ['my-mailboxes'],
        (previous) => {
          if (!previous || previous.status !== 'ok') {
            return previous
          }

          const remaining = previous.mailboxes.filter(
            (mailbox) =>
              mailbox.id !== result.mailbox.id &&
              mailbox.address !== result.evictedAddress,
          )

          return {
            ...previous,
            mailboxes: [result.mailbox, ...remaining].slice(0, config.limit),
          }
        },
      )
      void queryClient.invalidateQueries({ queryKey: ['my-mailboxes'] })
      void copyAddress(result.mailbox.address)
      void navigate({
        search: { mailbox: result.mailbox.id },
        replace: true,
      })
      scrollToInbox()
    },
    onError: () => {
      setCreateError('创建失败，请稍后再试')
      setAnnouncement('创建失败，请稍后再试')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (mailboxId: string) => deleteMyMailbox({ data: { mailboxId } }),
    onSuccess: (result, mailboxId) => {
      if (result.status === 'unauthenticated') {
        handleUnauthorized()
        return
      }

      if (result.status === 'rate_limited') {
        toastManager.add({
          variant: 'warning',
          title: result.message,
        })
        return
      }

      if (result.status === 'not_found') {
        toastManager.add({
          variant: 'warning',
          title: '邮箱不存在或已被删除',
        })
      } else {
        toastManager.add({
          variant: 'success',
          title: '邮箱已删除',
        })
      }

      queryClient.setQueryData<ListMyMailboxesResult>(
        ['my-mailboxes'],
        (previous) =>
          previous && previous.status === 'ok'
            ? {
                ...previous,
                mailboxes: previous.mailboxes.filter(
                  (mailbox) => mailbox.id !== mailboxId,
                ),
              }
            : previous,
      )
      queryClient.removeQueries({
        queryKey: ['my-mailbox-snapshot', mailboxId],
      })

      if (selectedMailbox?.id === mailboxId) {
        setSelectedMessageId(null)
        const remaining = sortedMailboxes.filter(
          (mailbox) => mailbox.id !== mailboxId,
        )
        void navigate({
          search: remaining[0] ? { mailbox: remaining[0].id } : {},
          replace: true,
        })
      }
    },
    onError: () => {
      toastManager.add({
        variant: 'error',
        title: '删除失败，请稍后再试',
      })
    },
  })

  const markReadMutation = useMutation({
    mutationFn: (input: { mailboxId: string; messageId: string }) =>
      markMyMessageRead({ data: input }),
    onSuccess: (result, input) => {
      if (result.status === 'unauthenticated') {
        handleUnauthorized()
        return
      }

      if (result.status !== 'ok') {
        return
      }

      queryClient.setQueryData<ListMyMailboxesResult>(
        ['my-mailboxes'],
        (previous) =>
          previous && previous.status === 'ok'
            ? {
                ...previous,
                mailboxes: previous.mailboxes.map((mailbox) =>
                  mailbox.id === input.mailboxId
                    ? {
                        ...mailbox,
                        messageCount: result.messageCount,
                        unreadCount: result.unreadCount,
                      }
                    : mailbox,
                ),
              }
            : previous,
      )
    },
  })

  function scrollToInbox() {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      return
    }

    requestAnimationFrame(() => {
      inboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function handleSelectMailbox(mailbox: DashboardMailbox) {
    setSelectedMessageId(null)
    void navigate({ search: { mailbox: mailbox.id }, replace: true })
    scrollToInbox()
  }

  function handleSelectMessage(messageId: string) {
    setSelectedMessageId(messageId)

    if (selectedMailbox) {
      markReadMutation.mutate({
        mailboxId: selectedMailbox.id,
        messageId,
      })
    }
  }

  function handleCreate() {
    if (createMutation.isPending) {
      return
    }

    const trimmed = prefix.trim()

    if (trimmed) {
      const validation = validateFixedPrefix(trimmed)

      if (!validation.ok) {
        setCreateError(validation.message)
        setAnnouncement(validation.message)
        return
      }
    }

    setCreateError(null)
    setAnnouncement('正在创建固定邮箱')
    createMutation.mutate(trimmed)
  }

  function handlePrefixChange(value: string) {
    setPrefix(value)

    if (createError) {
      setCreateError(null)
    }
  }

  function confirmDelete() {
    if (!deleteTarget) {
      return
    }

    deleteMutation.mutate(deleteTarget.id)
    setDeleteTarget(null)
  }

  async function handleSignOut() {
    try {
      await authClient.signOut()
    } catch {
      // The local session is cleared by Better Auth on the server.
    }

    queryClient.clear()
    await router.invalidate()
    await navigate({ to: '/' })
  }

  const isReconnecting =
    selectedMailbox !== null && snapshotQuery.isError && online && visible

  return (
    <main className="min-h-dvh bg-kumo-base text-kumo-default lg:grid lg:h-dvh lg:grid-cols-[minmax(280px,340px)_1fr] lg:overflow-hidden">
      <DashboardSidebar
        viewer={viewer}
        config={config}
        mailboxes={sortedMailboxes}
        selectedMailboxId={selectedMailbox?.id ?? null}
        prefix={prefix}
        createError={createError}
        isCreating={createMutation.isPending}
        isDeleting={deleteMutation.isPending}
        onPrefixChange={handlePrefixChange}
        onCreate={handleCreate}
        onCreateTemporaryMailbox={() => void navigate({ to: '/' })}
        onSelectMailbox={handleSelectMailbox}
        onDeleteMailbox={setDeleteTarget}
        onCopyAddress={(address) => void copyAddress(address)}
        onBackHome={() => void navigate({ to: '/' })}
        onSignOut={() => void handleSignOut()}
      />

      <DashboardInboxPane
        sectionRef={inboxRef}
        mailbox={selectedMailbox}
        messages={messages}
        selectedMessageId={selectedMessageId}
        onSelectMessage={handleSelectMessage}
        onBackToList={() => setSelectedMessageId(null)}
        online={online}
        isFetching={snapshotQuery.isFetching}
        isReconnecting={isReconnecting}
        announcement={announcement}
        messageLimit={config.messageLimit}
      />

      <Dialog.Root
        role="alertdialog"
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <Dialog className="px-6 py-5 sm:px-8 sm:py-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <Dialog.Title className="text-lg">删除邮箱？</Dialog.Title>
            <Dialog.Close
              aria-label="关闭删除确认"
              render={(props) => (
                <Button
                  {...props}
                  variant="ghost"
                  shape="square"
                  icon={<XIcon size={16} />}
                  aria-label="关闭删除确认"
                />
              )}
            />
          </div>
          <Dialog.Description>
            <Text as="span" variant="secondary">
              {deleteTarget?.address} 及全部邮件会被立即删除，无法恢复。
            </Text>
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={confirmDelete}
            >
              删除
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </main>
  )
}
