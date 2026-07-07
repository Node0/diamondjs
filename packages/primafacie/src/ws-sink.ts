/**
 * wsSink — browser transport forwarding log records to a server log stream
 * over WebSocket (the netpad `/_data_stream/app_logging_data` pattern).
 *
 * Connection is lazy and self-healing: records logged while disconnected are
 * dropped after one reconnect attempt (logging must never queue unboundedly
 * or take the app down).
 */

import type { LogRecord, LogSink } from './primafacie'

export interface WsLogMessage {
  type: 'browser_log'
  logType: LogRecord['logType']
  message: string
  timestamp: string
  functionName: string
  url: string
  userAgent: string
}

export function wsSink(url: string): LogSink {
  let socket: WebSocket | null = null

  const connect = (): void => {
    try {
      socket = new WebSocket(url)
      socket.onclose = () => {
        socket = null
      }
      socket.onerror = () => {
        socket = null
      }
    } catch {
      socket = null
    }
  }

  return (record: LogRecord): void => {
    if (typeof WebSocket === 'undefined') return
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (!socket) connect()
      return // drop this record; the next one rides the fresh connection
    }
    const message: WsLogMessage = {
      type: 'browser_log',
      logType: record.logType,
      message: record.message,
      timestamp: record.timestamp,
      functionName: record.functionName,
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    }
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // Fail silently — never recurse into Print from a sink.
    }
  }
}
