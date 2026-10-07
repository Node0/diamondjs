/**
 * @vitest-environment happy-dom
 *
 * v2.2 Phase 1 — one logging vocabulary. The two runtime warnings (spread
 * unsafe-key, inbound smell) are Print('WARNING', ...) calls through
 * @diamondjs/primafacie: prod-visible stink signals with warn-once dedup.
 * The format-drift tripwire asserts they carry primafacie's line shape —
 * a drift back toward a private format re-breaks this test.
 *
 * 2.3.0 (D-26): the last two console.error sites — an effect throwing during
 * a flush, a cleanup throwing in a captured scope — go through Print too, so
 * every runtime report reaches the sinks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DiamondCore } from '../src/core'
import { addSink, configure, type LogRecord } from '@diamondjs/primafacie'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** primafacie line shape: TYPE(pad10): ISO - caller(pad40) - ((( msg ))) */
const PRIMAFACIE_WARNING_LINE =
  /^WARNING {3}: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z - .{40} - \(\(\( .+ \)\)\)$/

describe('runtime warnings speak primafacie (format-drift tripwire)', () => {
  let records: LogRecord[] = []
  let detach: () => void

  beforeEach(() => {
    records = []
    configure({ console: false })
    detach = addSink((r) => records.push(r))
  })
  afterEach(() => {
    detach()
    configure({ console: true })
  })

  it('spread unsafe-key warning matches the primafacie line shape and dedups', async () => {
    const el = document.createElement('div')
    const state = DiamondCore.reactive({ attrs: { onclick: 'x' } as Record<string, unknown> })
    DiamondCore.spread(el, () => state.attrs)
    await tick()

    const warns = records.filter(
      (r) => r.logType === 'WARNING' && r.message.includes("unsafe key 'onclick'")
    )
    expect(warns).toHaveLength(1)
    expect(warns[0].plain).toMatch(PRIMAFACIE_WARNING_LINE)

    // warn-once-per-key dedup retained
    state.attrs = { onclick: 'y' }
    await tick()
    expect(
      records.filter(
        (r) => r.logType === 'WARNING' && r.message.includes("unsafe key 'onclick'")
      )
    ).toHaveLength(1)
  })

  it('inbound-smell warning matches the primafacie line shape and dedups', () => {
    const state = DiamondCore.reactive({ amount: 1234.56 })
    ;(state as Record<string, unknown>).amount = '$1,250.00'

    const warns = records.filter(
      (r) => r.logType === 'WARNING' && r.message.includes('inbound corruption')
    )
    expect(warns).toHaveLength(1)
    expect(warns[0].plain).toMatch(PRIMAFACIE_WARNING_LINE)

    // warn-once-per-property dedup retained
    ;(state as Record<string, unknown>).amount = '$9,999.99'
    expect(
      records.filter(
        (r) => r.logType === 'WARNING' && r.message.includes('inbound corruption')
      )
    ).toHaveLength(1)
  })
})

describe('nothing in the runtime writes to the console directly (D-26)', () => {
  let records: LogRecord[] = []
  let detach: () => void
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    records = []
    configure({ console: false })
    detach = addSink((r) => records.push(r))
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    consoleError.mockRestore()
    detach()
    configure({ console: true })
  })

  it('an effect that throws during a flush prints EXCEPTION, and the flush continues', async () => {
    const state = DiamondCore.reactive({ n: 0 })
    let ran = 0
    DiamondCore.effect(() => {
      if (state.n > 0) throw new Error('boom')
    })
    DiamondCore.effect(() => {
      void state.n
      ran++
    })
    state.n = 1
    await tick()

    expect(ran).toBe(2)
    const thrown = records.filter(
      (r) => r.logType === 'EXCEPTION' && r.message.includes('effect threw during flush')
    )
    expect(thrown).toHaveLength(1)
    expect(thrown[0].message).toContain('boom')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('a cleanup that throws inside a captured scope prints FAILURE, by index', () => {
    const { scope, cleanup } = DiamondCore.captureScope(() => 'value')
    scope.add(() => {
      throw new Error('cleanup boom')
    })
    cleanup()

    const failed = records.filter(
      (r) => r.logType === 'FAILURE' && r.message.includes('cleanup #0 threw')
    )
    expect(failed).toHaveLength(1)
    expect(failed[0].message).toContain('cleanup boom')
    expect(consoleError).not.toHaveBeenCalled()
  })
})
