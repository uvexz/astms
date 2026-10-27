import { useEffect, useState } from 'react'

export interface BrowserAvailability {
  online: boolean
  visible: boolean
}

export function useBrowserAvailability(): BrowserAvailability {
  const [online, setOnline] = useState(true)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    const updateVisibility = () =>
      setVisible(document.visibilityState === 'visible')

    updateOnline()
    updateVisibility()

    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    document.addEventListener('visibilitychange', updateVisibility)

    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [])

  return { online, visible }
}
