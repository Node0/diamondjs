/**
 * @diamondjs/primafacie
 *
 * The primafacie logging paradigm: `Print(logType, message)` — typed,
 * symbol-tagged, caller-aware lines with pluggable transports.
 *
 * @example
 * import { Print, addSink, wsSink } from '@diamondjs/primafacie'
 *
 * Print('STARTING', 'boot sequence')
 * addSink(wsSink('wss://host/_data_stream/app_logging_data'))
 *
 * // Node-only file transport:
 * // import { fileSink } from '@diamondjs/primafacie/node'
 */

export {
  Print,
  addSink,
  configure,
  LOG_TYPE_SYMBOLS,
  type LogType,
  type LogRecord,
  type LogSink,
} from './primafacie'

export { wsSink, type WsLogMessage } from './ws-sink'
