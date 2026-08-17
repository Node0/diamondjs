/**
 * v2.2 Phase 1 — logging consolidation additions:
 * WsLogMessage.plain round-trip (byte-identical), wsReceiver (silent),
 * datestamped fileSink rollover (injected clock), enableDebug env gating.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Print, addSink, type LogRecord } from '../src/primafacie'
import { wsSink, type WsLogMessage } from '../src/ws-sink'
import { fileSink, wsReceiver } from '../src/node'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('WS round-trip (v2.2)', () => {
  it('the line is formatted exactly once: file line === browser line, byte-identical', () => {
    // Capture the browser-side record
    let browserRecord: LogRecord | null = null
    const detach = addSink((r) => (browserRecord = r))

    // Fake WebSocket that captures what wsSink sends
    const sent: string[] = []
    class FakeWebSocket {
      static OPEN = 1
      readyState = 1
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(public url: string) {}
      send(data: string): void {
        sent.push(data)
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const sink = wsSink('wss://example/logs')
    Print('STATE', 'round-trip probe')
    detach()
    expect(browserRecord).not.toBeNull()

    // First delivery opens the lazy connection (record dropped by design);
    // the fake is immediately OPEN, so replay the same record.
    sink(browserRecord!)
    if (sent.length === 0) sink(browserRecord!)
    expect(sent.length).toBeGreaterThan(0)

    const msg = JSON.parse(sent[0]) as WsLogMessage
    expect(msg.plain).toBe(browserRecord!.plain)

    // Server half: wsReceiver → sink; the appended line must be byte-identical
    const serverLines: string[] = []
    const receive = wsReceiver((rec) => serverLines.push(rec.plain))
    receive(msg)
    expect(serverLines).toEqual([browserRecord!.plain])
  })

  it('wsReceiver is silent (no console echo) and contains sink throws', () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    const msg: WsLogMessage = {
      type: 'browser_log',
      logType: 'WARNING',
      message: 'm',
      timestamp: 'ts',
      functionName: 'fn',
      plain: 'WARNING   : ts - fn - ((( m )))',
      url: '',
      userAgent: '',
    }
    const throwing = wsReceiver(() => {
      throw new Error('sink boom')
    })
    expect(() => throwing(msg)).not.toThrow()
    for (const s of spies) expect(s).not.toHaveBeenCalled()
    spies.forEach((s) => s.mockRestore())
  })

  it('wsReceiver ignores non-browser_log messages', () => {
    const lines: string[] = []
    const receive = wsReceiver((rec) => lines.push(rec.plain))
    receive({ type: 'other' } as unknown as WsLogMessage)
    expect(lines).toEqual([])
  })
})

describe('datestamped fileSink (v2.2)', () => {
  const record = (plain: string): LogRecord => ({
    logType: 'INFO',
    message: 'x',
    timestamp: 'ts',
    functionName: 'fn',
    plain,
  })

  it('rolls by date-in-filename when the injected clock crosses midnight', () => {
    const dir = mkdtempSync(join(tmpdir(), 'primafacie-'))
    try {
      let now = new Date('2026-08-16T23:59:00Z')
      const sink = fileSink(dir, { datestamped: true, now: () => now })

      sink(record('line one'))
      now = new Date('2026-08-17T00:01:00Z') // per-append string compare rolls
      sink(record('line two'))

      expect(readFileSync(join(dir, 'access-2026-08-16.log'), 'utf-8')).toBe(
        'line one\n'
      )
      expect(readFileSync(join(dir, 'access-2026-08-17.log'), 'utf-8')).toBe(
        'line two\n'
      )
      expect(existsSync(join(dir, 'access.log'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('defaults to the original undated filenames (datestamped off)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'primafacie-'))
    try {
      const sink = fileSink(dir)
      sink(record('plain line'))
      expect(readFileSync(join(dir, 'access.log'), 'utf-8')).toBe('plain line\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('enableDebug env gating (v2.2 — dead initializer fixed)', () => {
  it('DEBUG_LOGGING=false actually gates DEBUG lines off at init', async () => {
    vi.stubEnv('DEBUG_LOGGING', 'false')
    vi.resetModules()
    const fresh = await import('../src/primafacie')
    const records: LogRecord[] = []
    const detach = fresh.addSink((r) => records.push(r))
    fresh.configure({ console: false })
    fresh.Print('DEBUG', 'should be dropped')
    fresh.Print('INFO', 'should pass')
    detach()
    fresh.configure({ console: true })
    expect(records.map((r) => r.logType)).toEqual(['INFO'])
  })
})
