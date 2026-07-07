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

/**
 * Scan `${...}` interpolations with brace-depth + string-literal awareness
 * (same quote/escape discipline as splitTopLevel). Unlike the old regex, a `}`
 * inside a nested brace pair or a string literal — `${x | Conv('}')}` — does
 * not terminate the span.
 */
export function scanInterpolations(content: string): InterpolationSpan[] {
  const spans: InterpolationSpan[] = []
  let i = 0

  while (i < content.length) {
    if (content[i] !== '$' || content[i + 1] !== '{') {
      i++
      continue
    }

    const start = i
    i += 2
    const exprStart = i
    let depth = 1
    let quote: string | null = null

    while (i < content.length && depth > 0) {
      const c = content[i]
      if (quote) {
        if (c === '\\') {
          i += 2 // skip the escaped char
          continue
        }
        if (c === quote) quote = null
        i++
        continue
      }
      if (c === "'" || c === '"' || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      i++
    }

    if (depth === 0) {
      spans.push({ expression: content.slice(exprStart, i - 1), start, end: i })
    } else {
      spans.push({
        expression: content.slice(exprStart),
        start,
        end: content.length,
        unterminated: true,
      })
    }
  }

  return spans
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
