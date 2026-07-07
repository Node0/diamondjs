/**
 * Dev-channel warning in the primafacie line format.
 *
 * Deliberately NOT a dependency on @diamondjs/primafacie — the runtime stays
 * lean and tree-shakeable; only the line FORMAT is shared so framework dev
 * warnings read uniformly next to app logs. Full transports (file, WebSocket)
 * live in the primafacie package.
 */
export function devWarn(source: string, message: string): void {
  console.warn(
    `WARNING   : ${new Date().toISOString()} - ${source.padEnd(40)} - ((( ${message} )))`
  )
}
