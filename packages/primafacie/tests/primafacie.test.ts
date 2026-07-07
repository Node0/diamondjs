/**
 * Primafacie paradigm tests — format fidelity, gating, sink plumbing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Print,
  addSink,
  configure,
  LOG_TYPE_SYMBOLS,
  type LogRecord,
} from '../src/primafacie'

describe('Print', () => {
  let detach: (() => void) | null = null
  let records: LogRecord[] = []

  beforeEach(() => {
    records = []
    configure({ console: false, enableDebug: true, enableTrace: false })
    detach = addSink((r) => records.push(r))
  })

  afterEach(() => {
    detach?.()
    configure({ console: true })
  })

  it('formats the line with padded type, timestamp, caller, and symbol pair', () => {
    Print('SUCCESS', 'it worked')
    expect(records).toHaveLength(1)
    const r = records[0]
    expect(r.logType).toBe('SUCCESS')
    expect(r.plain).toMatch(
      /^SUCCESS {3}: \d{4}-\d{2}-\d{2}T[\d:.]+Z - .{40} - \^\^\^ it worked \^\^\^$/
    )
  })

  it('preserves the original symbol pairs verbatim', () => {
    expect(LOG_TYPE_SYMBOLS.WARNING).toEqual(['(((', ')))'])
    expect(LOG_TYPE_SYMBOLS.STARTING).toEqual(['>>>', '>>>'])
    expect(LOG_TYPE_SYMBOLS.COMPLETED).toEqual(['<<<', '<<<'])
    expect(LOG_TYPE_SYMBOLS.CRITICAL).toEqual(['***', '***'])
  })

  it('drops TRACE unless enabled', () => {
    Print('TRACE', 'hidden')
    expect(records).toHaveLength(0)
    configure({ enableTrace: true })
    Print('TRACE', 'visible')
    expect(records).toHaveLength(1)
  })

  it('drops DEBUG when disabled', () => {
    configure({ enableDebug: false })
    Print('DEBUG', 'hidden')
    expect(records).toHaveLength(0)
  })

  it('extracts a caller name from the stack', () => {
    function namedCaller(): void {
      Print('INFO', 'from a named function')
    }
    namedCaller()
    expect(records[0].functionName).toContain('namedCaller')
  })

  it('a throwing sink does not break Print or other sinks', () => {
    const bad = addSink(() => {
      throw new Error('transport down')
    })
    expect(() => Print('INFO', 'still fine')).not.toThrow()
    expect(records).toHaveLength(1)
    bad()
  })

  it('detaching a sink stops delivery', () => {
    detach?.()
    detach = null
    Print('INFO', 'nobody home')
    expect(records).toHaveLength(0)
  })

  it('routes console output through the type-appropriate method', () => {
    configure({ console: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    Print('WARNING', 'careful')
    Print('CRITICAL', 'bad')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
