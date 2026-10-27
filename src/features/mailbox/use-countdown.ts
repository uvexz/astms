import { useEffect, useState } from 'react'

function getRemainingSeconds(expiresAt: string, serverNow: string): number {
  const remainingMs =
    new Date(expiresAt).getTime() - new Date(serverNow).getTime()
  return Math.max(0, Math.ceil(remainingMs / 1_000))
}

export function useCountdown(
  expiresAt: string | null,
  serverNow: string | null,
): number | null {
  const [deadline, setDeadline] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt || !serverNow) {
      setDeadline(null)
      return
    }

    setDeadline(Date.now() + getRemainingSeconds(expiresAt, serverNow) * 1_000)
  }, [expiresAt, serverNow])

  useEffect(() => {
    if (deadline === null) {
      return
    }

    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [deadline])

  if (deadline === null) {
    return null
  }

  return Math.max(0, Math.ceil((deadline - now) / 1_000))
}
