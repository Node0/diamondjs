/**
 * @diamondjs/primafacie/node — Node-only transports.
 *
 * Separate entry point so the browser bundle never touches fs/path.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { LogRecord, LogSink, LogType } from './primafacie'
import type { WsLogMessage } from './ws-sink'

export * from './primafacie'

/** The original paradigm's three-file routing. */
const FILE_FOR_TYPE: Record<LogType, 'access' | 'error' | 'debug'> = {
  INFO: 'access',
  WARNING: 'access',
  STATE: 'access',
  STARTING: 'access',
  PROGRESS: 'access',
  COMPLETED: 'access',
  SUCCESS: 'access',
  ERROR: 'error',
  EXCEPTION: 'error',
  FAILURE: 'error',
  CRITICAL: 'error',
  DEBUG: 'debug',
  TRACE: 'debug',
  ATTEMPT: 'debug',
  IMPORTANT: 'debug',
}

export interface FileSinkOptions {
  /**
   * Roll log files by date-in-filename (access-YYYY-MM-DD.log). Rolling is a
   * per-append string compare — no rotation daemon, no timers. Default off
   * (plain access.log / error.log / debug.log, the original behavior).
   */
  datestamped?: boolean
  /** Injectable clock (tests); defaults to the wall clock. */
  now?: () => Date
}

/**
 * fileSink — append records to access / error / debug log files under
 * `logsDir` (created if missing), routed by log type exactly as the original
 * paradigm did. With `datestamped: true` the filenames carry the current
 * date (v2.2) and roll when it changes.
 */
export function fileSink(logsDir: string, options: FileSinkOptions = {}): LogSink {
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }
  const { datestamped = false, now = () => new Date() } = options

  const pathsFor = (stamp: string): Record<'access' | 'error' | 'debug', string> => {
    const suffix = stamp ? `-${stamp}` : ''
    return {
      access: join(logsDir, `access${suffix}.log`),
      error: join(logsDir, `error${suffix}.log`),
      debug: join(logsDir, `debug${suffix}.log`),
    }
  }

  let currentStamp = datestamped ? now().toISOString().slice(0, 10) : ''
  let paths = pathsFor(currentStamp)

  return (record: LogRecord): void => {
    try {
      if (datestamped) {
        const stamp = now().toISOString().slice(0, 10)
        if (stamp !== currentStamp) {
          currentStamp = stamp
          paths = pathsFor(stamp)
        }
      }
      appendFileSync(paths[FILE_FOR_TYPE[record.logType] ?? 'debug'], record.plain + '\n')
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Failed to write to log file: ${(e as Error).message}`)
    }
  }
}

/**
 * wsReceiver — the server half of the browser→server log stream (v2.2).
 * Framework-agnostic: wire it to whatever WebSocket server you run —
 *   `ws.on('message', (data) => receiver(JSON.parse(String(data))))`.
 *
 * SILENT by design: no server console echo (the browser already printed the
 * line); the message flows straight to the given sink, with `plain` appended
 * verbatim — the file line is byte-identical to the browser line.
 */
export function wsReceiver(sink: LogSink): (msg: WsLogMessage) => void {
  return (msg: WsLogMessage): void => {
    if (!msg || msg.type !== 'browser_log') return
    const record: LogRecord = {
      logType: msg.logType,
      message: msg.message,
      timestamp: msg.timestamp,
      functionName: msg.functionName,
      plain: msg.plain,
    }
    try {
      sink(record)
    } catch {
      // A failing transport must never take the server down.
    }
  }
}
