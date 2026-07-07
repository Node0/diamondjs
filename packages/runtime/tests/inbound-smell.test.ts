/**
 * Inbound smell check (DDR §3.3 row 3 / §5.1) — runtime backstop that warns when
 * a display-formatted string overwrites a numeric model value.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DiamondCore } from '../src/core'

describe('inbound corruption smell check', () => {
  afterEach(() => vi.restoreAllMocks())

  it('warns when a non-numeric string overwrites a number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = DiamondCore.reactive({ amount: 1234.56 })

    state.amount = '$1,250.00' as unknown as number

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[Diamond] inbound corruption')
    expect(warn.mock.calls[0][0]).toContain('amount')
  })

  it('warns at most once per property (no spam)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = DiamondCore.reactive({ amount: 1 })

    state.amount = 'abc' as unknown as number
    state.amount = 'def' as unknown as number
    state.amount = 'ghi' as unknown as number

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does NOT warn for a clean numeric string (benign)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = DiamondCore.reactive({ amount: 1 })

    state.amount = '1250' as unknown as number // Number('1250') is valid

    expect(warn).not.toHaveBeenCalled()
  })

  it('does NOT warn for number→number or plain string→string writes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = DiamondCore.reactive({ n: 1, s: 'a' })

    state.n = 2
    state.s = 'formatted'

    expect(warn).not.toHaveBeenCalled()
  })

  describe('v2.1 widening (user-ratified; §5.1 rows 2–3, best-effort dev heuristics)', () => {
    it('warns when a locale-formatted date overwrites a canonical ISO date', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const state = DiamondCore.reactive({ due: '2026-03-01' })

      state.due = '03/01/2026'

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('canonical ISO date')
      expect(warn.mock.calls[0][0]).toContain('due')
    })

    it('does NOT warn for ISO→ISO date updates', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const state = DiamondCore.reactive({ due: '2026-03-01' })

      state.due = '2026-04-15'

      expect(warn).not.toHaveBeenCalled()
    })

    it('warns when a formatted phone overwrites a canonical 10-digit string', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const state = DiamondCore.reactive({ phone: '5551234567' })

      state.phone = '(555) 123-4567'

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('canonical 10-digit')
      expect(warn.mock.calls[0][0]).toContain('phone')
    })

    it('does NOT warn for 10-digit→10-digit phone updates', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const state = DiamondCore.reactive({ phone: '5551234567' })

      state.phone = '5559876543'

      expect(warn).not.toHaveBeenCalled()
    })
  })
})
