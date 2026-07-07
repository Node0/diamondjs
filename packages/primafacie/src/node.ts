/**
 * @diamondjs/primafacie/node — Node-only transports.
 *
 * Separate entry point so the browser bundle never touches fs/path.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { LogRecord, LogSink, LogType } from './primafacie'

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

/**
 * fileSink — append records to access.log / error.log / debug.log under
 * `logsDir` (created if missing), routed by log type exactly as the original
 * paradigm did.
 */
export function fileSink(logsDir: string): LogSink {
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
  }
  const paths = {
    access: join(logsDir, 'access.log'),
    error: join(logsDir, 'error.log'),
    debug: join(logsDir, 'debug.log'),
  }
  return (record: LogRecord): void => {
    try {
      appendFileSync(paths[FILE_FOR_TYPE[record.logType] ?? 'debug'], record.plain + '\n')
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Failed to write to log file: ${(e as Error).message}`)
    }
  }
}
