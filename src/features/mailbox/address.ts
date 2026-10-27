export const PREFIX_MIN_LENGTH = 6
export const PREFIX_MAX_LENGTH = 32
export const PREFIX_RULE_MESSAGE =
  '前缀需为 6–32 位，只能包含字母、数字和 -，并以字母或数字开头和结尾'

const PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]{4,30}[a-z0-9]$/
const LOCAL_PART_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

export const RANDOM_FIRST_NAMES: readonly string[] = [
  'alex',
  'ben',
  'chris',
  'daniel',
  'david',
  'ethan',
  'george',
  'harry',
  'henry',
  'jack',
  'jacob',
  'james',
  'john',
  'kevin',
  'leo',
  'lucas',
  'mark',
  'mason',
  'matthew',
  'nathan',
  'noah',
  'oliver',
  'oscar',
  'peter',
  'ryan',
  'sam',
  'thomas',
  'tom',
  'william',
  'zack',
]

export const RANDOM_LAST_NAMES: readonly string[] = [
  'adams',
  'allen',
  'baker',
  'brooks',
  'campbell',
  'carter',
  'clark',
  'cooper',
  'davis',
  'evans',
  'fisher',
  'foster',
  'gray',
  'green',
  'hall',
  'harris',
  'hayes',
  'holland',
  'jackson',
  'king',
  'lewis',
  'martin',
  'miller',
  'moore',
  'morgan',
  'parker',
  'reed',
  'turner',
  'walker',
  'young',
]

export type PrefixValidation =
  { ok: true; prefix: string } | { ok: false; message: string }

export function normalizePrefix(raw: string): string {
  return raw.trim().toLowerCase()
}

export function validatePrefix(raw: string): PrefixValidation {
  const prefix = normalizePrefix(raw)

  if (!PREFIX_PATTERN.test(prefix)) {
    return { ok: false, message: PREFIX_RULE_MESSAGE }
  }

  return { ok: true, prefix }
}

export function normalizeAddress(raw: string): string | null {
  const address = raw.trim().toLowerCase()
  const separator = address.lastIndexOf('@')

  if (separator <= 0 || separator !== address.indexOf('@')) {
    return null
  }

  const localPart = address.slice(0, separator)
  const domain = address.slice(separator + 1)

  if (
    localPart.length > 64 ||
    !LOCAL_PART_PATTERN.test(localPart) ||
    !DOMAIN_PATTERN.test(domain)
  ) {
    return null
  }

  return `${localPart}@${domain}`
}

export function extractEmailAddress(raw: string): string | null {
  const trimmed = raw.trim()
  const angleMatch = trimmed.match(/<([^<>]+)>/)
  return normalizeAddress(angleMatch ? angleMatch[1] : trimmed)
}

export function formatMailboxAddress(prefix: string, domain: string): string {
  return `${prefix}@${domain}`
}

function randomIndex(maxExclusive: number): number {
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  const values = new Uint32Array(1)

  do {
    crypto.getRandomValues(values)
  } while (values[0] >= limit)

  return values[0] % maxExclusive
}

export function generateRandomPrefix(): string {
  const firstName = RANDOM_FIRST_NAMES[randomIndex(RANDOM_FIRST_NAMES.length)]
  const lastName = RANDOM_LAST_NAMES[randomIndex(RANDOM_LAST_NAMES.length)]
  const number = 100 + randomIndex(900)

  return `${firstName}-${lastName}${number}`
}
