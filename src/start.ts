import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === 'serverFn',
})

let configValidated = false

const securityHeadersMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ next }) => {
    if (!configValidated) {
      const { validateServerConfig } = await import('#/server/config')
      validateServerConfig()
      configValidated = true
    }

    const result = await next()
    const { response } = result

    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    )
    response.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    )

    return result
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, securityHeadersMiddleware],
}))
