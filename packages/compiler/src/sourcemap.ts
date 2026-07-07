/**
 * Source Map V3 `mappings` serialization — hand-rolled base64 VLQ.
 *
 * Deliberately dependency-free (~70 LOC) rather than pulling a native/wasm
 * source-map package into the compiler's runtime deps. Line-level granularity:
 * each emitted line that carries a template location gets one 4-field segment
 * [generatedColumn, sourceIndex, originalLine, originalColumn].
 *
 * Known offset caveat (documented, deferred): the map is relative to the bare
 * createTemplate() snippet the generator emits. compileAndInject() re-indents
 * and inserts at an arbitrary line, and the Parcel module wrapper prepends
 * header lines — consumers must line-shift (the plugin's asset.setMap wiring
 * is deferred plugin work).
 */

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Encode one signed integer as a base64 VLQ (sign bit in the LSB). */
export function encodeVLQ(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1
  let out = ''
  do {
    let digit = vlq & 0b11111
    vlq >>>= 5
    if (vlq > 0) digit |= 0b100000 // continuation bit
    out += BASE64[digit]
  } while (vlq > 0)
  return out
}

export interface SerializableMapping {
  /** 1-based generated position (line), 0-based column */
  generated: { line: number; column: number }
  /** 1-based original position (parse5 convention) — converted to 0-based here */
  original: { line: number; column: number }
}

/**
 * Serialize mappings (single source, no names) into the V3 `mappings` string:
 * `;`-separated generated lines, `,`-separated segments, per-field deltas.
 */
export function serializeMappings(
  mappings: SerializableMapping[],
  sourceIndex = 0
): string {
  const sorted = [...mappings].sort(
    (a, b) =>
      a.generated.line - b.generated.line ||
      a.generated.column - b.generated.column
  )

  let out = ''
  let genLine = 1
  let prevGenCol = 0
  let prevSrc = 0
  let prevOrigLine = 0
  let prevOrigCol = 0
  let firstOnLine = true

  for (const m of sorted) {
    while (genLine < m.generated.line) {
      out += ';'
      genLine++
      prevGenCol = 0
      firstOnLine = true
    }
    if (!firstOnLine) out += ','
    firstOnLine = false

    const origLine = Math.max(0, m.original.line - 1)
    const origCol = Math.max(0, m.original.column - 1)
    out +=
      encodeVLQ(m.generated.column - prevGenCol) +
      encodeVLQ(sourceIndex - prevSrc) +
      encodeVLQ(origLine - prevOrigLine) +
      encodeVLQ(origCol - prevOrigCol)

    prevGenCol = m.generated.column
    prevSrc = sourceIndex
    prevOrigLine = origLine
    prevOrigCol = origCol
  }

  return out
}
