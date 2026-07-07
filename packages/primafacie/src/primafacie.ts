/**
 * Primafacie — the logging paradigm.
 *
 * One call: `Print(logType, message)`. Every line carries a type, a symbol
 * pair, a timestamp, and the caller's name — so a log stream reads at a glance
 * (prima facie) without grepping for context. Ported from the stargate
 * implementation (reference_files/code_from_projects/logging); the log types,
 * symbols, and line format are preserved verbatim.
 *
 * Console output is built in (ANSI colors in Node, %c styles in the browser).
 * Additional transports attach via `addSink` — see `wsSink` (browser → server
 * log stream) and `@diamondjs/primafacie/node`'s `fileSink`.
 */

export type LogType =
  | 'SUCCESS'
  | 'FAILURE'
  | 'STATE'
  | 'INFO'
  | 'IMPORTANT'
  | 'CRITICAL'
  | 'EXCEPTION'
  | 'WARNING'
  | 'DEBUG'
  | 'ATTEMPT'
  | 'STARTING'
  | 'PROGRESS'
  | 'COMPLETED'
  | 'ERROR'
  | 'TRACE'

export interface LogRecord {
  logType: LogType
  message: string
  /** ISO timestamp */
  timestamp: string
  /** Caller extracted from the stack ('Unknown Caller' when unavailable) */
  functionName: string
  /** The fully formatted plain-text line (what file sinks should append) */
  plain: string
}

/** A transport for log records (file, WebSocket, test spy, ...). */
export type LogSink = (record: LogRecord) => void

const LOG_TYPE_PADDING = 10
const FUNCTION_NAME_PADDING = 40

/** Symbol pairs — preserved verbatim from the original paradigm. */
export const LOG_TYPE_SYMBOLS: Record<LogType, [string, string]> = {
  SUCCESS: ['^^^', '^^^'],
  FAILURE: ['###', '###'],
  STATE: ['~~~', '~~~'],
  INFO: ['---', '---'],
  IMPORTANT: ['===', '==='],
  CRITICAL: ['***', '***'],
  EXCEPTION: ['!!!', '!!!'],
  WARNING: ['(((', ')))'],
  DEBUG: ['[[[', ']]]'],
  ATTEMPT: ['???', '???'],
  STARTING: ['>>>', '>>>'],
  PROGRESS: ['vvv', 'vvv'],
  COMPLETED: ['<<<', '<<<'],
  ERROR: ['###', '###'],
  TRACE: ['...', '...'],
}

// ANSI color codes (Node console). Kept dependency-free — no 'colors' package.
const ANSI: Record<LogType, string> = {
  SUCCESS: '\x1b[32m', // green
  FAILURE: '\x1b[31;1m', // red bold
  STATE: '\x1b[36m', // cyan
  INFO: '\x1b[34m', // blue
  IMPORTANT: '\x1b[35m', // magenta
  CRITICAL: '\x1b[31;1m',
  EXCEPTION: '\x1b[31;1m',
  WARNING: '\x1b[33m', // yellow
  DEBUG: '\x1b[37m', // white
  ATTEMPT: '\x1b[36m',
  STARTING: '\x1b[32m',
  PROGRESS: '\x1b[34m',
  COMPLETED: '\x1b[32m',
  ERROR: '\x1b[31;1m',
  TRACE: '\x1b[90m', // gray
}
const ANSI_RESET = '\x1b[0m'

// Browser %c styles (matching the original browser-logger).
const CSS: Record<LogType, string> = {
  SUCCESS: 'color: green; font-weight: bold',
  FAILURE: 'color: red; font-weight: bold',
  STATE: 'color: cyan',
  INFO: 'color: blue',
  IMPORTANT: 'color: magenta; font-weight: bold',
  CRITICAL: 'color: red; font-weight: bold',
  EXCEPTION: 'color: red; font-weight: bold',
  WARNING: 'color: orange',
  DEBUG: 'color: gray',
  ATTEMPT: 'color: cyan',
  STARTING: 'color: green',
  PROGRESS: 'color: blue',
  COMPLETED: 'color: green',
  ERROR: 'color: red; font-weight: bold',
  TRACE: 'color: lightgray',
}

const CONSOLE_METHOD: Record<LogType, 'log' | 'info' | 'warn' | 'error'> = {
  SUCCESS: 'log',
  FAILURE: 'error',
  STATE: 'info',
  INFO: 'info',
  IMPORTANT: 'warn',
  CRITICAL: 'error',
  EXCEPTION: 'error',
  WARNING: 'warn',
  DEBUG: 'log',
  ATTEMPT: 'log',
  STARTING: 'log',
  PROGRESS: 'log',
  COMPLETED: 'log',
  ERROR: 'error',
  TRACE: 'log',
}

const IS_NODE =
  typeof process !== 'undefined' &&
  !!process.versions?.node &&
  typeof window === 'undefined'

interface PrimafacieConfig {
  /** TRACE lines are dropped unless enabled (env TRACE_LOGGING=true in Node). */
  enableTrace: boolean
  /** DEBUG lines are dropped unless enabled (default on, as in the original). */
  enableDebug: boolean
  /** Console output on/off (sinks still receive records when off). */
  console: boolean
}

const config: PrimafacieConfig = {
  enableTrace:
    (typeof process !== 'undefined' && process.env?.TRACE_LOGGING === 'true') ||
    false,
  enableDebug:
    (typeof process !== 'undefined' &&
      (process.env?.DEBUG_LOGGING === 'true' ||
        process.env?.TRACE_LOGGING === 'true')) ||
    true,
  console: true,
}

/** Adjust gating/console behavior at runtime. */
export function configure(overrides: Partial<PrimafacieConfig>): void {
  Object.assign(config, overrides)
}

const sinks = new Set<LogSink>()

/** Attach a transport. Returns a detach function. */
export function addSink(sink: LogSink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

/** Extract the caller's name from the stack (best-effort, engine-dependent). */
function extractCaller(): string {
  const stack = new Error().stack
  const stackLines = stack?.split('\n') || []
  // 0: 'Error', 1: extractCaller, 2: Print, 3: the caller
  const callerLine = stackLines[3] ? stackLines[3].trim() : 'Unknown Caller Line'

  const methodMatch = callerLine.match(/at (\S+) \(/)
  const constructorMatch = callerLine.match(/at new (\S+) \(/)
  if (constructorMatch) return `${constructorMatch[1]}.constructor`
  if (methodMatch) return methodMatch[1]
  return 'Unknown Caller'
}

/**
 * The paradigm's single entry point.
 *
 *   Print('STARTING', 'compiling 14 templates')
 *   Print('WARNING', `unsafe sink '${prop}' skipped`)
 */
export function Print(logType: LogType, message: string): void {
  const upper = logType.toUpperCase() as LogType

  if (upper === 'TRACE' && !config.enableTrace) return
  if (upper === 'DEBUG' && !config.enableDebug) return

  const functionName = extractCaller()
  const timestamp = new Date().toISOString()
  const [before, after] = LOG_TYPE_SYMBOLS[upper] ?? ['', '']
  const paddedType = upper.padEnd(LOG_TYPE_PADDING)
  const paddedFn = functionName.padEnd(FUNCTION_NAME_PADDING)
  const plain = `${paddedType}: ${timestamp} - ${paddedFn} - ${before} ${message} ${after}`

  if (config.console && upper !== 'TRACE') {
    const method = CONSOLE_METHOD[upper] ?? 'log'
    if (IS_NODE) {
      const color = ANSI[upper] ?? ''
      // eslint-disable-next-line no-console
      console[method](
        `${paddedType}: ${timestamp} - ${paddedFn} - ${color}${before} ${message} ${after}${ANSI_RESET}`
      )
    } else {
      // eslint-disable-next-line no-console
      console[method](`%c${plain}`, CSS[upper] ?? '')
    }
  }

  const record: LogRecord = {
    logType: upper,
    message,
    timestamp,
    functionName,
    plain,
  }
  for (const sink of sinks) {
    try {
      sink(record)
    } catch {
      // A failing transport must never take the app down or recurse into Print.
    }
  }
}
