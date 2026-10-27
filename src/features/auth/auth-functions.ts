import { createServerFn } from '@tanstack/react-start'

import type { ViewerResult } from './types'

export const getViewer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ViewerResult> => {
    const { readViewer } = await import('./auth-server')
    return readViewer()
  },
)
