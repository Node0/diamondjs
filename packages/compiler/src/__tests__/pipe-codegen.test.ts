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
      "el_span_0.textContent = CurrencyConverter.format(this.amount, 'USD')"
    )
  })

  it('does not split a logical || in an interpolation', () => {
    expect(code(`<span>\${name || 'Anon' | upper}</span>`)).toContain(
      "upper(this.name || 'Anon')"
    )
  })

  it("survives a '}' inside pipe args (brace-depth scanner, not regex)", () => {
    expect(code(`<span>\${x | Conv('}')}</span>`)).toContain(
      "Conv.format(this.x, '}')"
    )
  })

  it("survives a nested object literal inside an interpolation", () => {
    expect(code('<span>${ cfg.debug }</span>')).toContain('this.cfg.debug')
    expect(code('<span>${a} } ${b}</span>')).toContain('${this.a} } ${this.b}')
  })

  it('emits a diagnostic for an unterminated interpolation', () => {
    const r = compile('<span>${a.b</span>')
    expect(
      r.diagnostics?.some((d) => d.code === 'unterminated-interpolation')
    ).toBe(true)
  })
})

describe('pipe lowering — inbound (parse / ParseResult)', () => {
  it('two-way converter: format getter + validated parse setter + obligation', () => {
    const r = compile(`<input value.two-way="amount | CurrencyConverter('USD')">`)
    expect(r.code).toContain("() => CurrencyConverter.format(this.amount, 'USD')")
    // Block-body setter is emitted multi-line so the `if (r.valid)` security
    // gate sits on its own, visually prominent line.
    expect(r.code).toContain("const r = CurrencyConverter.parse(v, 'USD');")
    expect(r.code).toContain('if (r.valid) this.amount = r.value;')
    expect(r.converterObligations).toEqual([
      expect.objectContaining({ name: 'CurrencyConverter', needs: 'parse', direction: 'two-way' }),
    ])
  })

  it('from-view converter: validated parse (undefined getter) + obligation', () => {
    const r = compile(`<input value.from-view="amount | CurrencyConverter('USD')">`)
    expect(r.code).toContain("DiamondCore.bind(el_input_0, 'value',")
    expect(r.code).toContain('undefined,')
    expect(r.code).toContain("const r = CurrencyConverter.parse(v, 'USD');")
    expect(r.code).toContain('if (r.valid) this.amount = r.value;')
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

  it('rejects a mixed chain — one plain function anywhere poisons a two-way chain', () => {
    // v2.1: 'pipe-two-way-multi' is RETIRED — a chain is legal iff every
    // segment is a converter. The mixed case is noninvertible.
    const r = compile(`<input value.two-way="amount | round | CurrencyConverter('USD')">`)
    expect(r.diagnostics?.some((d) => d.code === 'pipe-two-way-noninvertible')).toBe(true)
    expect(r.diagnostics?.some((d) => d.code === 'pipe-two-way-multi')).toBe(false)
  })

  it('rejects a multi-segment from-view pipe (from-view stays single-transform)', () => {
    const r = compile('<input value.from-view="x | a | b">')
    expect(r.diagnostics?.some((d) => d.code === 'pipe-fromview-multi')).toBe(true)
  })
})

describe('multi-segment two-way chain inversion (v2.1, working_notes §3.5 / Amendment A2)', () => {
  it('composes format left-to-right and parse right-to-left, fail-fast', () => {
    const r = compile(
      `<input value.two-way="amount | CentsConverter | CurrencyConverter('USD')">`
    )
    // Outbound: format composed left-to-right
    expect(r.code).toContain(
      "() => CurrencyConverter.format(CentsConverter.format(this.amount), 'USD')"
    )
    // Inbound: parse composed right-to-left (r1 then r0), each step gated
    expect(r.code).toContain("const r1 = CurrencyConverter.parse(v, 'USD');")
    expect(r.code).toContain('if (!r1.valid) return;')
    expect(r.code).toContain('const r0 = CentsConverter.parse(r1.value);')
    expect(r.code).toContain('if (r0.valid) this.amount = r0.value;')
    expect(r.diagnostics ?? []).toHaveLength(0)
  })

  it('emits one parse obligation PER segment (§5.6 covers the whole chain)', () => {
    const r = compile(
      `<input value.two-way="amount | CentsConverter | CurrencyConverter('USD')">`
    )
    expect(r.converterObligations).toHaveLength(2)
    expect(r.converterObligations?.map((o) => o.name).sort()).toEqual([
      'CentsConverter',
      'CurrencyConverter',
    ])
  })

  it('a 3-segment chain keeps reverse numbering (r2 → r1 → r0)', () => {
    const r = compile('<input value.two-way="x | A | B | C">')
    const code = r.code
    expect(code).toContain('const r2 = C.parse(v);')
    expect(code).toContain('const r1 = B.parse(r2.value);')
    expect(code).toContain('const r0 = A.parse(r1.value);')
    expect(code.indexOf('const r2')).toBeLessThan(code.indexOf('const r1'))
    expect(code.indexOf('const r1')).toBeLessThan(code.indexOf('const r0'))
  })
})

describe('error-into (v2.1, §5.7 rendering surface / Amendment A2)', () => {
  it('single-segment: writes error on invalid, clears to null on valid', () => {
    const r = compile(
      `<input value.two-way="amount | CurrencyConverter('USD')" value.error-into="amountError">`
    )
    expect(r.code).toContain('this.amountError = r.valid ? null : r.error;')
    expect(r.code).toContain('if (r.valid) this.amount = r.value;')
    expect(r.diagnostics ?? []).toHaveLength(0)
  })

  it('chain: first failing step wins; cleared on full success', () => {
    const r = compile(
      `<input value.two-way="amount | CentsConverter | CurrencyConverter('USD')" value.error-into="amountError">`
    )
    expect(r.code).toContain('if (!r1.valid) { this.amountError = r1.error; return; }')
    expect(r.code).toContain('this.amountError = r0.valid ? null : r0.error;')
  })

  it('works on from-view converters too', () => {
    const r = compile(
      `<input value.from-view="amount | CurrencyConverter('USD')" value.error-into="amountError">`
    )
    expect(r.code).toContain('this.amountError = r.valid ? null : r.error;')
  })

  it('composes with update-on (both companion attributes on one binding)', () => {
    const r = compile(
      `<input value.two-way="amount | CurrencyConverter('USD')" value.update-on="blur" value.error-into="amountError">`
    )
    expect(r.code).toContain('this.amountError = r.valid ? null : r.error;')
    expect(r.code).toContain(`'blur'`)
  })

  const errorIntoDiagnostics: Array<[string, string]> = [
    ['<input error-into="e" value.two-way="a | Conv">', 'bare-error-into'],
    ['<input value.two-way="a | Conv" value.error-into="not a path!">', 'bad-error-into'],
    ['<input value.error-into="e">', 'error-into-no-binding'],
    ['<span textContent.to-view="a | Conv" textContent.error-into="e"></span>', 'error-into-not-inbound'],
    ['<input value.two-way="a" value.error-into="e">', 'error-into-no-converter'],
    ['<input value.from-view="p | normalize" value.error-into="e">', 'error-into-no-converter'],
  ]

  for (const [template, code] of errorIntoDiagnostics) {
    it(`rejects: ${code}`, () => {
      const r = compile(template)
      expect(
        r.diagnostics?.some((d) => d.code === code),
        `expected ${code}; got ${r.diagnostics?.map((d) => d.code).join(',')}`
      ).toBe(true)
    })
  }
})

describe('non-pipe bindings are unchanged', () => {
  it('two-way without a pipe', () => {
    expect(code('<input value.two-way="name">')).toContain(
      "DiamondCore.bind(el_input_0, 'value', () => this.name, (v) => this.name = v)"
    )
  })

  it('from-view without a pipe stays one-way', () => {
    expect(code('<input value.from-view="q">')).toContain(
      "DiamondCore.bind(el_input_0, 'value', undefined, (v) => this.q = v)"
    )
  })
})
