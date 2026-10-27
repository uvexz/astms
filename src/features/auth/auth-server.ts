import '@tanstack/react-start/server-only'

import { getRequestHeaders } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'

import { db } from '#/db'
import { account } from '#/db/schema'
import { getAuth } from '#/lib/auth'
import {
  getAuthProviderAvailability,
  isAuthConfigured,
  isEmailPasswordLoginEnabled,
} from '#/lib/auth-config'

import type { ViewerResult, ViewerUser } from './types'

let warnedAboutSessionLookup = false

export async function readViewer(): Promise<ViewerResult> {
  const providers = getAuthProviderAvailability()
  const authReady = isAuthConfigured()
  const emailPasswordLogin = isEmailPasswordLoginEnabled()

  if (!authReady) {
    return { user: null, authReady, providers, emailPasswordLogin }
  }

  try {
    const session = await getAuth().api.getSession({
      headers: getRequestHeaders(),
    })

    if (!session?.user) {
      return { user: null, authReady, providers, emailPasswordLogin }
    }

    const providerRow = (
      await db
        .select({ providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, session.user.id))
        .limit(1)
    ).at(0)

    return {
      user: {
        id: session.user.id,
        name: session.user.name.trim() || '用户',
        image: session.user.image ?? null,
        provider: providerRow?.providerId ?? null,
      },
      authReady,
      providers,
      emailPasswordLogin,
    }
  } catch (error) {
    if (!warnedAboutSessionLookup) {
      warnedAboutSessionLookup = true
      console.warn(
        '[auth] session lookup failed',
        error instanceof Error ? error.name : 'unknown',
      )
    }

    return { user: null, authReady, providers, emailPasswordLogin }
  }
}

export async function requireViewer(): Promise<ViewerUser | null> {
  const viewer = await readViewer()
  return viewer.user
}
