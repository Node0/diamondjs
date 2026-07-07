/**
 * Pipe parser/lowerer tests (DDR §5.3–5.4) — adversarial grammar coverage.
 */
import { describe, it, expect } from 'vitest'
import {
  splitTopLevel,
  hasPipe,
  parsePipe,
  lowerFormat,
  scanInterpolations,
} from '../pipe'

// A stand-in prefixer that mimics the generator (this.-prefix bare identifiers,
// leave string/number literals). Good enough to assert composition shape.
const prefix = (e: string): string =>
  e.replace(
    /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\.?)([A-Za-z_$][\w$]*)/g,
    (m, str, dot, id) => (str || dot ? m : `this.${id}`)
  )

describe('splitTopLevel', () => {
  it('splits simple pipes', () => {
    expect(splitTopLevel('a | b | c', '|')).toEqual(['a ', ' b ', ' c'])
  })

  it('does NOT split logical OR ||', () => {
    expect(splitTopLevel('a || b | f', '|')).toEqual(['a || b ', ' f'])
  })

  it('ignores | inside string literals', () => {
    expect(splitTopLevel("x | Conv('a|b')", '|')).toEqual(["x ", " Conv('a|b')"])
  })

  it('does not split at | inside nested parens (args)', () => {
    expect(splitTopLevel('x | clamp(0, max | y)', '|')).toEqual([
      'x ',
      ' clamp(0, max | y)',
    ])
  })

  it('splits args on top-level commas only', () => {
    expect(splitTopLevel("'USD', f(a, b), 'x'", ',')).toEqual([
      "'USD'",
      ' f(a, b)',
      " 'x'",
    ])
  })

  it('treats a lone | as a pipe (no bitwise-or)', () => {
    expect(hasPipe('a | b')).toBe(true)
    expect(hasPipe('a || b')).toBe(false)
    expect(hasPipe('plain.expr')).toBe(false)
  })
})

describe('parsePipe', () => {
  it('separates data from transforms', () => {
    const p = parsePipe("amount | CurrencyConverter('USD')")
    expect(p.data).toBe('amount')
    expect(p.segments).toHaveLength(1)
    expect(p.segments[0].head).toBe('CurrencyConverter')
    expect(p.segments[0].isConverter).toBe(true)
    expect(p.segments[0].args).toEqual(["'USD'"])
  })

  it('classifies camelCase heads as plain functions', () => {
    const p = parsePipe('value | parseRaw | clamp(0, 100) | formatPercent')
    expect(p.segments.map((s) => s.head)).toEqual([
      'parseRaw',
      'clamp',
      'formatPercent',
    ])
    expect(p.segments.every((s) => !s.isConverter)).toBe(true)
    expect(p.segments[1].args).toEqual(['0', '100'])
  })

  it('flags a malformed segment', () => {
    const p = parsePipe('a | ')
    expect(p.segments[0].malformed).toBe(true)
  })
})

describe('scanInterpolations', () => {
  it('scans simple interpolations with spans', () => {
    const spans = scanInterpolations('Hello ${name}!')
    expect(spans).toEqual([{ expression: 'name', start: 6, end: 13 }])
  })

  it("does not terminate on a '}' inside a string literal (pipe args)", () => {
    const spans = scanInterpolations("${x | Conv('}')}")
    expect(spans).toHaveLength(1)
    expect(spans[0].expression).toBe("x | Conv('}')")
    expect(spans[0].unterminated).toBeUndefined()
  })

  it("does not terminate on a '}' inside nested braces", () => {
    const spans = scanInterpolations('${ {a:1}.a } end')
    expect(spans[0].expression).toBe(' {a:1}.a ')
  })

  it("handles a static '}' between two interpolations", () => {
    const spans = scanInterpolations('${a} } ${b}')
    expect(spans.map((s) => s.expression)).toEqual(['a', 'b'])
  })

  it('flags an unterminated interpolation', () => {
    const spans = scanInterpolations('text ${a.b')
    expect(spans[0].unterminated).toBe(true)
    expect(spans[0].expression).toBe('a.b')
  })
})

describe('lowerFormat', () => {
  it('composes camelCase transforms as direct calls (§5.3)', () => {
    const p = parsePipe('value | parseRaw | clamp(0, 100) | formatPercent')
    expect(lowerFormat(p, prefix)).toBe(
      'formatPercent(clamp(parseRaw(this.value), 0, 100))'
    )
  })

  it('lowers a PascalCase converter to .format with threaded args (§5.4)', () => {
    const p = parsePipe("amount | CurrencyConverter('USD')")
    expect(lowerFormat(p, prefix)).toBe(
      "CurrencyConverter.format(this.amount, 'USD')"
    )
  })

  it('prefixes args that reference component state, head stays verbatim', () => {
    const p = parsePipe('amount | CurrencyConverter(locale)')
    expect(lowerFormat(p, prefix)).toBe(
      'CurrencyConverter.format(this.amount, this.locale)'
    )
  })
})
