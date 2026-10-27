export type AuthProviderId = 'github' | 'google' | 'sb'

export interface AuthProviderAvailability {
  github: boolean
  google: boolean
  sb: boolean
}

export interface ViewerUser {
  id: string
  name: string
  image: string | null
  provider: string | null
}

export interface ViewerResult {
  user: ViewerUser | null
  authReady: boolean
  providers: AuthProviderAvailability
  emailPasswordLogin: boolean
}
