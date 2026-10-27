export function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error

  for (let depth = 0; depth < 4; depth += 1) {
    if (!(current instanceof Error)) {
      return false
    }

    const code = (current as { code?: string }).code

    if (
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      code === 'SQLITE_CONSTRAINT' ||
      /unique constraint failed/i.test(current.message)
    ) {
      return true
    }

    current = (current as { cause?: unknown }).cause
  }

  return false
}
