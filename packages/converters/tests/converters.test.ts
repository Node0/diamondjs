import { describe, it, expect } from 'vitest'
import { CurrencyConverter, DateConverter, PhoneConverter, IntConverter, SlugConverter } from '../src/index'

describe('CurrencyConverter', () => {
  it('formats a number to a localized currency string', () => {
    expect(CurrencyConverter.format(1234.56, 'USD')).toBe('$1,234.56')
  })

  it('parses a currency string back to a number (round-trip)', () => {
    const r = CurrencyConverter.parse('$1,234.56', 'USD')
    expect(r.valid).toBe(true)
    expect(r.value).toBeCloseTo(1234.56)
  })

  it('fails on non-numeric input and retains raw', () => {
    const r = CurrencyConverter.parse('abc')
    expect(r.valid).toBe(false)
    expect(r.value).toBeNull()
    expect(r.raw).toBe('abc')
    expect(r.error).toBeTruthy()
  })

  it('format ∘ parse is identity on the numeric value', () => {
    const r = CurrencyConverter.parse(CurrencyConverter.format(42, 'USD'), 'USD')
    expect(r.value).toBeCloseTo(42)
  })
})

describe('DateConverter', () => {
  it('parses an ISO date as UTC midnight (offset-safe)', () => {
    const r = DateConverter.parse('2026-06-29')
    expect(r.valid).toBe(true)
    expect(r.value?.toISOString()).toBe('2026-06-29T00:00:00.000Z')
  })

  it('rejects an invalid calendar date (Feb 30)', () => {
    const r = DateConverter.parse('2024-02-30')
    expect(r.valid).toBe(false)
  })

  it('formats a Date to a date string (UTC)', () => {
    const d = new Date(Date.UTC(2026, 5, 29))
    expect(DateConverter.format(d)).toBe('06/29/2026')
  })
})

describe('PhoneConverter', () => {
  it('formats a canonical 10-digit number', () => {
    expect(PhoneConverter.format('5551234567')).toBe('(555) 123-4567')
  })

  it('parses a formatted number to canonical digits', () => {
    const r = PhoneConverter.parse('(555) 123-4567')
    expect(r.valid).toBe(true)
    expect(r.value).toBe('5551234567')
  })

  it('strips a leading country code', () => {
    expect(PhoneConverter.parse('1 (555) 123-4567').value).toBe('5551234567')
  })

  it('fails on too few digits', () => {
    expect(PhoneConverter.parse('555-1234').valid).toBe(false)
  })
})

describe('IntConverter (v2.2.1 — route-param battery)', () => {
  it('parses whole numbers strictly', () => {
    expect(IntConverter.parse('42')).toMatchObject({ valid: true, value: 42 })
    expect(IntConverter.parse('-7')).toMatchObject({ valid: true, value: -7 })
  })
  it('rejects floats, text, and empty', () => {
    for (const raw of ['3.5', 'abc', '', '4two', '1e3']) {
      expect(IntConverter.parse(raw).valid, raw).toBe(false)
    }
  })
  it('rejects out-of-safe-range integers', () => {
    expect(IntConverter.parse('9007199254740993').valid).toBe(false)
  })
  it('formats integers back to decimal strings', () => {
    expect(IntConverter.format(42)).toBe('42')
    expect(IntConverter.format(3.5)).toBe('')
  })
})

describe('SlugConverter (v2.2.1 — route-param battery)', () => {
  it('parses lowercase kebab-case slugs with a leading letter', () => {
    expect(SlugConverter.parse('kafka-orders')).toMatchObject({
      valid: true,
      value: 'kafka-orders',
    })
    expect(SlugConverter.parse('a1')).toMatchObject({ valid: true, value: 'a1' })
  })
  it('rejects uppercase, snake_case, leading digits, and symbols', () => {
    for (const raw of ['Kafka', 'snake_case', '1st', 'bad!slug', '-lead', '']) {
      expect(SlugConverter.parse(raw).valid, raw).toBe(false)
    }
  })
  it('format passes canonical slugs through and blanks non-slugs', () => {
    expect(SlugConverter.format('kafka-orders')).toBe('kafka-orders')
    expect(SlugConverter.format('Not A Slug')).toBe('')
  })
})
