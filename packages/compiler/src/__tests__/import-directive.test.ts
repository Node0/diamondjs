/**
 * <!-- @import --> provenance directive tests (v2.1, working_notes §3.6 /
 * Amendment A2 grammar).
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'

const compiler = new DiamondCompiler()
const compile = (t: string) => compiler.compile(t, { sourceMap: false })

describe('@import provenance directive', () => {
  it('parses named imports into templateImports', () => {
    const r = compile(`
      <!-- @import { CurrencyConverter, formatPercent } from './converters' -->
      <span>\${amount | CurrencyConverter('USD')}</span>
      <span>\${ratio | formatPercent}</span>
    `)
    expect(r.templateImports).toEqual([
      expect.objectContaining({
        names: ['CurrencyConverter', 'formatPercent'],
        spec: './converters',
      }),
    ])
    expect(r.diagnostics ?? []).toHaveLength(0)
  })

  it('allows multiple directives', () => {
    const r = compile(`
      <!-- @import { A } from './a' -->
      <!-- @import { B } from './b' -->
      <span>\${x | A | B}</span>
    `)
    expect(r.templateImports).toHaveLength(2)
  })

  it('rejects aliasing (v1 grammar: named imports only)', () => {
    const r = compile(`
      <!-- @import { Currency as Money } from './c' -->
      <span>\${x | Money}</span>
    `)
    expect(r.diagnostics?.some((d) => d.code === 'bad-import-directive')).toBe(true)
  })

  it('rejects malformed @import-shaped comments loudly (no silent no-op)', () => {
    const r = compile(`
      <!-- @import Money from './c' -->
      <span>\${x | Money}</span>
    `)
    expect(r.diagnostics?.some((d) => d.code === 'bad-import-directive')).toBe(true)
  })

  it('errors on a duplicate name across directives', () => {
    const r = compile(`
      <!-- @import { Conv } from './a' -->
      <!-- @import { Conv } from './b' -->
      <span>\${x | Conv}</span>
    `)
    expect(
      r.diagnostics?.some((d) => d.code === 'import-directive-duplicate')
    ).toBe(true)
  })

  it('flags an unused import name as info', () => {
    const r = compile(`
      <!-- @import { GhostConverter } from './ghost' -->
      <span>\${plain}</span>
    `)
    const d = r.diagnostics?.find((x) => x.code === 'import-directive-unused')
    expect(d?.severity).toBe('info')
  })
})
