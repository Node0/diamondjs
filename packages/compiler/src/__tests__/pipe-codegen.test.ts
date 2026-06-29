/**
 * Pipe codegen + §5.6 enforcement (DDR §5.3–5.7) via the full compiler.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'

const compiler = new DiamondCompiler()
const compile = (t: string) => compiler.compile(t, { sourceMap: false })
const code = (t: string) => compile(t).code

describe('pipe lowering — outbound (display)', () => {
  it('composes camelCase transforms as direct calls in interpolation (§5.3)', () => {
    expect(code('<span>${value | parseRaw | clamp(0,100) | formatPercent}</span>')).toContain(
      'formatPercent(clamp(parseRaw(this.value), 0, 100))'
    )
  })

  it('lowers a converter to .format in interpolation (§5.4)', () => {
    expect(code('<span>${amount | CurrencyConverter("USD")}</span>')).toContain(
      'CurrencyConverter.format(this.amount, "USD")'
    )
  })

  it('lowers to-view through .format', () => {
    expect(code(`<span textContent.to-view="amount | CurrencyConverter('USD')"></span>`)).toContain(
      "() => CurrencyConverter.format(this.amount, 'USD')"
    )
  })

  it('lowers set (one-shot) through the format chain', () => {
    expect(code(`<span textContent.set="amount | CurrencyConverter('USD')"></span>`)).toContain(
      "span0.textContent = CurrencyConverter.format(this.amount, 'USD')"
    )
  })

  it('does not split a logical || in an interpolation', () => {
    expect(code(`<span>\${name || 'Anon' | upper}</span>`)).toContain(
      "upper(this.name || 'Anon')"
    )
  })
})

describe('pipe lowering — inbound (parse / ParseResult)', () => {
  it('two-way converter: format getter + validated parse setter + obligation', () => {
    const r = compile(`<input value.two-way="amount | CurrencyConverter('USD')">`)
    expect(r.code).toContain("() => CurrencyConverter.format(this.amount, 'USD')")
    expect(r.code).toContain(
      "(v) => { const r = CurrencyConverter.parse(v, 'USD'); if (r.valid) this.amount = r.value; }"
    )
    expect(r.converterObligations).toEqual([
      expect.objectContaining({ name: 'CurrencyConverter', needs: 'parse', direction: 'two-way' }),
    ])
  })

  it('from-view converter: validated parse (undefined getter) + obligation', () => {
    const r = compile(`<input value.from-view="amount | CurrencyConverter('USD')">`)
    expect(r.code).toContain(
      "DiamondCore.bind(input0, 'value', undefined, (v) => { const r = CurrencyConverter.parse(v, 'USD'); if (r.valid) this.amount = r.value; })"
    )
    expect(r.converterObligations?.[0]).toMatchObject({
      name: 'CurrencyConverter',
      direction: 'from-view',
    })
  })

  it('from-view plain function: direct, unvalidated call', () => {
    expect(code('<input value.from-view="phone | normalizePhone">')).toContain(
      '(v) => this.phone = normalizePhone(v)'
    )
  })
})

describe('two-way enforcement (closes the §5.1 hole)', () => {
  it('rejects a plain (non-invertible) function on a two-way leg — severity error, not warn', () => {
    const r = compile('<input value.two-way="amount | formatPercent">')
    const d = r.diagnostics?.find((x) => x.code === 'pipe-two-way-noninvertible')
    expect(d).toBeDefined()
    expect(d?.severity).toBe('error') // hard error → build fails (transformer throws)
    // no obligation emitted for a rejected binding
    expect(r.converterObligations).toHaveLength(0)
  })

  it('rejects a multi-segment two-way pipe', () => {
    const r = compile(`<input value.two-way="amount | round | CurrencyConverter('USD')">`)
    expect(r.diagnostics?.some((d) => d.code === 'pipe-two-way-multi')).toBe(true)
  })

  it('rejects a multi-segment from-view pipe', () => {
    const r = compile('<input value.from-view="x | a | b">')
    expect(r.diagnostics?.some((d) => d.code === 'pipe-fromview-multi')).toBe(true)
  })
})

describe('non-pipe bindings are unchanged', () => {
  it('two-way without a pipe', () => {
    expect(code('<input value.two-way="name">')).toContain(
      "DiamondCore.bind(input0, 'value', () => this.name, (v) => this.name = v)"
    )
  })

  it('from-view without a pipe stays one-way', () => {
    expect(code('<input value.from-view="q">')).toContain(
      "DiamondCore.bind(input0, 'value', undefined, (v) => this.q = v)"
    )
  })
})
