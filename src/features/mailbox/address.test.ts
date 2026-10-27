import { describe, expect, test } from 'bun:test'

import {
  canonicalizeFixedAddress,
  extractEmailAddress,
  generateRandomPrefix,
  normalizeAddress,
  normalizeFixedPrefix,
  normalizePrefix,
  RANDOM_FIRST_NAMES,
  RANDOM_LAST_NAMES,
  validateFixedPrefix,
  validatePrefix,
} from './address'

describe('normalizePrefix', () => {
  test('trims and lowercases input', () => {
    expect(normalizePrefix('  Hello-World  ')).toBe('hello-world')
  })
})

describe('validatePrefix', () => {
  test('accepts a valid prefix', () => {
    expect(validatePrefix('hello-123')).toEqual({
      ok: true,
      prefix: 'hello-123',
    })
  })

  test('accepts the minimum and maximum lengths', () => {
    expect(validatePrefix('abc123').ok).toBe(true)
    expect(validatePrefix('a'.repeat(32)).ok).toBe(true)
  })

  test('rejects too short, too long, or bad edge characters', () => {
    expect(validatePrefix('abc12').ok).toBe(false)
    expect(validatePrefix('a'.repeat(33)).ok).toBe(false)
    expect(validatePrefix('-hello').ok).toBe(false)
    expect(validatePrefix('hello-').ok).toBe(false)
  })

  test('rejects illegal characters', () => {
    expect(validatePrefix('hello_world').ok).toBe(false)
    expect(validatePrefix('hello.world').ok).toBe(false)
    expect(validatePrefix('你好世界你好').ok).toBe(false)
    expect(validatePrefix('hello@world').ok).toBe(false)
  })
})

describe('fixed prefix rules', () => {
  test('removes dots before validating', () => {
    expect(normalizeFixedPrefix(' A.B.C ')).toBe('abc')
    expect(validateFixedPrefix('a.b.c')).toEqual({ ok: true, prefix: 'abc' })
    expect(validateFixedPrefix('.abc.')).toEqual({ ok: true, prefix: 'abc' })
    expect(validateFixedPrefix('a..b..c')).toEqual({ ok: true, prefix: 'abc' })
  })

  test('accepts three to thirty-two characters after removing dots', () => {
    expect(validateFixedPrefix('a.b').ok).toBe(false)
    expect(validateFixedPrefix('a-b').ok).toBe(true)
    expect(validateFixedPrefix('a'.repeat(32)).ok).toBe(true)
    expect(validateFixedPrefix(`${'a'.repeat(32)}.b`).ok).toBe(false)
  })

  test('rejects illegal characters after removing dots', () => {
    expect(validateFixedPrefix('a_b').ok).toBe(false)
    expect(validateFixedPrefix('你好世界').ok).toBe(false)
    expect(validateFixedPrefix('-abc').ok).toBe(false)
    expect(validateFixedPrefix('abc-').ok).toBe(false)
    expect(validateFixedPrefix('...').ok).toBe(false)
  })
})

describe('canonicalizeFixedAddress', () => {
  test('removes dots from the local part only', () => {
    expect(canonicalizeFixedAddress('A.B.C@Example.Test')).toBe(
      'abc@example.test',
    )
    expect(canonicalizeFixedAddress('ab.c@sub.example.test')).toBe(
      'abc@sub.example.test',
    )
    expect(canonicalizeFixedAddress('abc@example.test')).toBe(
      'abc@example.test',
    )
  })

  test('returns null for malformed addresses', () => {
    expect(canonicalizeFixedAddress('not-an-email')).toBeNull()
    expect(canonicalizeFixedAddress('a..b@example.test')).toBe(
      'ab@example.test',
    )
  })
})

describe('generateRandomPrefix', () => {
  test('combines a first name, last name, and three-digit number', () => {
    for (let i = 0; i < 200; i += 1) {
      const prefix = generateRandomPrefix()
      const match = /^([a-z]+)-([a-z]+)(\d{3})$/.exec(prefix)

      expect(match).not.toBeNull()
      expect(validatePrefix(prefix).ok).toBe(true)

      if (!match) {
        continue
      }

      expect(RANDOM_FIRST_NAMES).toContain(match[1])
      expect(RANDOM_LAST_NAMES).toContain(match[2])

      const number = Number(match[3])
      expect(number).toBeGreaterThanOrEqual(100)
      expect(number).toBeLessThanOrEqual(999)
    }
  })

  test('ships 30 unique first and last names', () => {
    expect(RANDOM_FIRST_NAMES).toHaveLength(30)
    expect(new Set(RANDOM_FIRST_NAMES).size).toBe(30)
    expect(RANDOM_LAST_NAMES).toHaveLength(30)
    expect(new Set(RANDOM_LAST_NAMES).size).toBe(30)
  })
})

describe('normalizeAddress', () => {
  test('normalizes a complete address', () => {
    expect(normalizeAddress('  User-1@Domain.Name ')).toBe('user-1@domain.name')
    expect(normalizeAddress(' A.B.C@Domain.Name ')).toBe('a.b.c@domain.name')
  })

  test('rejects malformed addresses', () => {
    expect(normalizeAddress('user@')).toBeNull()
    expect(normalizeAddress('@domain.name')).toBeNull()
    expect(normalizeAddress('user@@domain.name')).toBeNull()
    expect(normalizeAddress('user@domain')).toBeNull()
    expect(normalizeAddress('not-an-email')).toBeNull()
  })
})

describe('extractEmailAddress', () => {
  test('extracts from a display-name address', () => {
    expect(extractEmailAddress('Alice <Alice@Domain.Name>')).toBe(
      'alice@domain.name',
    )
  })

  test('accepts a bare address', () => {
    expect(extractEmailAddress('bob@domain.name')).toBe('bob@domain.name')
  })

  test('returns null for invalid recipients', () => {
    expect(extractEmailAddress('unknown')).toBeNull()
  })
})
