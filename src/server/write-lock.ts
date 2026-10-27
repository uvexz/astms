import '@tanstack/react-start/server-only'

let queue: Promise<unknown> = Promise.resolve()

export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)

  queue = run.then(
    () => undefined,
    () => undefined,
  )

  return run
}
