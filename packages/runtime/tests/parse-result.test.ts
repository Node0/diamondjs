import { describe, it, expect } from 'vitest'
import { ParseResult } from '../src/parse-result'

describe('ParseResult', () => {
  it('ok() builds a valid result with no error', () => {
    const r: ParseResult<number> = ParseResult.ok(1234.56, '$1,234.56')
    expect(r.valid).toBe(true)
    expect(r.value).toBe(1234.56)
    expect(r.raw).toBe('$1,234.56')
    expect(r.error).toBeNull()
  })

  it('fail() builds an invalid result that retains raw and carries the error', () => {
    const r: ParseResult<number> = ParseResult.fail('abc', 'Not a valid amount')
    expect(r.valid).toBe(false)
    expect(r.value).toBeNull()
    expect(r.raw).toBe('abc')
    expect(r.error).toBe('Not a valid amount')
  })
})
