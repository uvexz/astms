import '@tanstack/react-start/server-only'

import { betterAuth } from 'better-auth'

import { createAuthOptions } from './auth-config'

type AuthInstance = ReturnType<typeof betterAuth>

let authInstance: AuthInstance | null = null

export function getAuth(): AuthInstance {
  if (!authInstance) {
    authInstance = betterAuth(createAuthOptions())
  }

  return authInstance
}
