/**
 * Binding/handler timing (DDR §4.3): value.update-on + `&` removal.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'
import { TemplateParser } from '../parser'
import { isElementInfo } from '../types'

const compiler = new DiamondCompiler()
const code = (t: string) => compiler.compile(t, { sourceMap: false }).code
const diags = (t: string) => compiler.compile(t, { sourceMap: false }).diagnostics ?? []

describe('value.update-on (binding-update timing)', () => {
  it('emits the event arg for a two-way binding', () => {
    expect(code(`<input value.two-way="amount" value.update-on="blur">`)).toContain(
      "DiamondCore.bind(el_input_0, 'value', () => this.amount, (v) => this.amount = v, 'blur')"
    )
  })

  it('emits the event arg for a from-view binding', () => {
    expect(code(`<input value.from-view="q" value.update-on="change">`)).toContain(
      "DiamondCore.bind(el_input_0, 'value', undefined, (v) => this.q = v, 'change')"
    )
  })

  it('attaches updateOn to the matching binding (parser)', () => {
    const nodes = new TemplateParser().parse(
      `<input value.two-way="amount" value.update-on="blur">`
    )
    if (isElementInfo(nodes[0])) {
      expect(nodes[0].bindings[0].updateOn).toBe('blur')
    }
  })

  it('rejects bare update-on (ambiguous)', () => {
    expect(
      diags(`<input value.two-way="a" update-on="blur">`).some(
        (d) => d.code === 'bare-update-on'
      )
    ).toBe(true)
  })

  it('rejects update-on on a to-view binding (no inbound leg)', () => {
    expect(
      diags(
        `<span textContent.to-view="x" textContent.update-on="blur"></span>`
      ).some((d) => d.code === 'update-on-not-inbound')
    ).toBe(true)
  })

  it('rejects update-on with no matching binding', () => {
    expect(
      diags(`<input value.update-on="blur">`).some(
        (d) => d.code === 'update-on-no-binding'
      )
    ).toBe(true)
  })
})

describe('& binding behaviors removed', () => {
  it('errors (severity error) on a lone & in a binding expression', () => {
    const d = diags(`<input value.bind="search & debounce:500">`).find(
      (x) => x.code === 'ampersand-removed'
    )
    expect(d?.severity).toBe('error')
  })

  it('errors on & in an interpolation', () => {
    expect(
      diags('<span>${msg & uppercase}</span>').some(
        (d) => d.code === 'ampersand-removed'
      )
    ).toBe(true)
  })

  it('intentionally flags a bitwise lone & too — no computation in a declarative template (§2.8)', () => {
    // Not a false positive: bitwise belongs in a view-model getter. Hard error,
    // and the message redirects to a getter.
    const d = diags('<span textContent.to-view="a & b"></span>').find(
      (x) => x.code === 'ampersand-removed'
    )
    expect(d?.severity).toBe('error')
    expect(d?.message).toContain('view-model getter')
  })

  it('does NOT flag logical && in a binding', () => {
    expect(
      diags('<span textContent.to-view="a && b"></span>').some(
        (d) => d.code === 'ampersand-removed'
      )
    ).toBe(false)
  })

  it('does NOT flag logical || in an interpolation', () => {
    expect(
      diags('<span>${a || b}</span>').some((d) => d.code === 'ampersand-removed')
    ).toBe(false)
  })
})
