/**
 * Pipe parsing + lowering (DDR §5.3–5.4).
 *
 * A template expression may end in one or more `| transform` segments. The pipe
 * is a Unix pipe: `data | t1 | t2` lowers to `t2(t1(data))` (function composition).
 *
 * Segment kind is decided by capitalization (reconciles §5.3 vs §5.4):
 *   - PascalCase head  → converter CLASS → directional `.format` / `.parse`
 *   - camelCase head   → plain transform FUNCTION → direct call
 * Args in parens thread as extra arguments to both legs.
 *
 * Heads are bare imports and are emitted VERBATIM (never `this.`-prefixed). Only
 * the data leaf and the args are prefixed by the caller's `prefix` callback.
 */

import type { TextPart } from './types'

export interface PipeSegment {
  /** Transform/converter name — emitted verbatim (it is an imported symbol) */
  head: string
  /** PascalCase head → converter class (.format/.parse); else plain function */
  isConverter: boolean
  /** Raw argument expressions (each prefixed by the caller before emission) */
  args: string[]
  /** True when the segment text didn't parse as `name` or `name(args)` */
  malformed: boolean
}

export interface ParsedPipe {
  /** The data expression (leftmost), prefixed by the caller */
  data: string
  /** Transforms left-to-right (empty when there is no pipe) */
  segments: PipeSegment[]
}

/**
 * Split `src` at top-level occurrences of `delim`, respecting string literals and
 * bracket nesting. For `|`, a `||` (logical OR) is NOT a split point.
 */
export function splitTopLevel(src: string, delim: '|' | ','): string[] {
  const parts: string[] = []
  let buf = ''
  let depth = 0
  let quote: string | null = null

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (quote) {
      buf += c
      if (c === '\\') {
        buf += src[++i] ?? '' // keep the escaped char
        continue
      }
      if (c === quote) quote = null
      continue
    }

    if (c === "'" || c === '"' || c === '`') {
      quote = c
      buf += c
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++
      buf += c
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--
      buf += c
      continue
    }

    if (depth === 0 && c === delim) {
      if (delim === '|' && (src[i + 1] === '|' || src[i - 1] === '|')) {
        buf += c // part of `||` (logical OR) — not a pipe boundary
        continue
      }
      parts.push(buf)
      buf = ''
      continue
    }

    buf += c
  }

  parts.push(buf)
  return parts
}

/** True when the expression contains at least one top-level pipe. */
export function hasPipe(expr: string): boolean {
  return splitTopLevel(expr, '|').length > 1
}

export interface InterpolationSpan {
  /** Expression text between `${` and its matching `}` */
  expression: string
  /** Offset of the `$` in the input */
  start: number
  /** Offset one past the closing `}` (input end when unterminated) */
  end: number
  /** True when the `${` was never closed before end of input */
  unterminated?: boolean
}

export interface InterpolationScan {
  /** Real interpolations, in source order. */
  spans: InterpolationSpan[]
  /**
   * The static text around them, escapes resolved: statics[i] precedes
   * spans[i], and one more entry follows the last span.
   */
  statics: string[]
  /** Offset of each backslash that turned a `${` into literal text. */
  escapes: number[]
}

/**
 * Scan template text for `${...}` interpolations — the one scanner for text
 * and attribute values (#29). Three things are syntax, and nothing else is:
 *
 *  - the `${` opener;
 *  - its closing `}`, found with brace-depth + string-literal awareness (a `}`
 *    inside a nested brace pair or a string literal — `${x | Conv('}')}` —
 *    does not terminate the span);
 *  - a run of backslashes directly before a `${`, read by the JS rule: pairs
 *    collapse to one backslash each, and an odd one left over makes the `${`
 *    literal text. A backslash anywhere else is ordinary text.
 */
export function scanInterpolations(source: string): InterpolationScan {
  const spans: InterpolationSpan[] = []
  const statics: string[] = []
  const escapes: number[] = []
  let text = '' // the static chunk being built
  let from = 0 // start of the source not yet copied into `text`
  let i = 0

  while (i < source.length) {
    if (source[i] !== '$' || source[i + 1] !== '{') {
      i++
      continue
    }

    let run = i
    while (run > from && source[run - 1] === '\\') run--
    const slashes = i - run
    text += source.slice(from, run) + '\\'.repeat(slashes >> 1)
    if (slashes % 2 === 1) {
      escapes.push(i - 1)
      text += '${'
      i += 2
      from = i
      continue
    }

    const start = i
    const close = findInterpolationClose(source, i + 2)
    statics.push(text)
    text = ''
    if (close < 0) {
      i = source.length
      spans.push({ expression: source.slice(start + 2), start, end: i, unterminated: true })
    } else {
      i = close + 1
      spans.push({ expression: source.slice(start + 2, close), start, end: i })
    }
    from = i
  }

  statics.push(text + source.slice(from))
  return { spans, statics, escapes }
}

/**
 * Offset of the `}` that closes an interpolation whose expression starts at
 * `from`, or -1 when it is never closed. Brace-depth + string-literal aware.
 */
function findInterpolationClose(source: string, from: number): number {
  let depth = 1
  let quote: string | null = null

  for (let i = from; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i++ // skip the escaped char
      else if (c === quote) quote = null
    } else if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * Lay a scan out as ordered text parts. `decode` turns a raw piece into its
 * text (the parser entity-decodes; already-decoded content passes through).
 * An unterminated span — the parser reports it — stays literal text, so
 * codegen never crashes on it.
 */
export function interpolationParts(
  scan: InterpolationScan,
  decode: (piece: string) => string = (piece) => piece
): TextPart[] {
  const parts: TextPart[] = []
  const pushText = (value: string): void => {
    if (value) parts.push({ kind: 'text', value })
  }
  scan.spans.forEach((span, k) => {
    pushText(decode(scan.statics[k]))
    if (span.unterminated) pushText('${' + decode(span.expression))
    else parts.push({ kind: 'expression', expression: decode(span.expression).trim() })
  })
  pushText(decode(scan.statics[scan.spans.length]))
  return parts
}

/**
 * Parse `data | seg1 | seg2(args)` into a structured pipe.
 * Returns `segments: []` (no transforms) when there is no pipe.
 */
export function parsePipe(expr: string): ParsedPipe {
  const parts = splitTopLevel(expr, '|').map((p) => p.trim())
  const data = parts[0]
  const segments: PipeSegment[] = []

  for (let k = 1; k < parts.length; k++) {
    const seg = parts[k]
    const m = seg.match(/^([A-Za-z_$][\w$]*)\s*(?:\(([\s\S]*)\))?\s*$/)
    if (!m) {
      segments.push({ head: seg, isConverter: false, args: [], malformed: true })
      continue
    }
    const head = m[1]
    const argStr = m[2]
    const args =
      argStr !== undefined && argStr.trim() !== ''
        ? splitTopLevel(argStr, ',').map((a) => a.trim())
        : []
    segments.push({
      head,
      isConverter: /^[A-Z]/.test(head),
      args,
      malformed: false,
    })
  }

  return { data, segments }
}

/**
 * Lower the FORMAT (outbound / display) leg: left-to-right composition.
 * `prefix` is applied to the data leaf and each arg; heads stay verbatim.
 */
export function lowerFormat(
  parsed: ParsedPipe,
  prefix: (expr: string) => string
): string {
  let acc = prefix(parsed.data)
  for (const seg of parsed.segments) {
    const args = seg.args.map(prefix)
    const tail = args.length ? `, ${args.join(', ')}` : ''
    acc = seg.isConverter
      ? `${seg.head}.format(${acc}${tail})`
      : `${seg.head}(${acc}${tail})`
  }
  return acc
}

/**
 * Build the argument tail (`, a, b`) for a single inbound segment's parse/direct
 * call. `prefix` is applied to each arg.
 */
export function lowerArgs(
  seg: PipeSegment,
  prefix: (expr: string) => string
): string {
  const args = seg.args.map(prefix)
  return args.length ? `, ${args.join(', ')}` : ''
}
