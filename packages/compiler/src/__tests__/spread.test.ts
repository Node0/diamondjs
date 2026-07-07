/**
 * Attribute spread tests (v2.1, DDR §7.1) — parsing, emission, stink audit.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'
import { TemplateParser } from '../parser'
import { isElementInfo } from '../types'

describe('attribute spread — parsing', () => {
  const parser = new TemplateParser()

  it('parses ...attrs.bind as a spread binding', () => {
    const nodes = parser.parse('<input ...attrs.bind="myGuts">')
    const el = nodes[0]
    if (isElementInfo(el)) {
      expect(el.bindings).toHaveLength(1)
      expect(el.bindings[0]).toMatchObject({
        type: 'spread',
        property: '...attrs',
        expression: 'myGuts',
        raw: false,
      })
    }
  })

  it('parses ...attrs.rawBind (parse5-lowercased) as a raw spread', () => {
    const nodes = parser.parse('<input ...attrs.rawBind="ownedKeys">')
    const el = nodes[0]
    if (isElementInfo(el)) {
      expect(el.bindings[0]).toMatchObject({ type: 'spread', raw: true })
    }
  })

  it('rejects unknown spread forms', () => {
    for (const bad of [
      '<input ...attrs.set="x">',
      '<input ...attrs.two-way="x">',
      '<input ...foo.bind="x">',
      '<input ...attrs="x">',
    ]) {
      parser.parse(bad)
      expect(
        parser.diagnostics.some((d) => d.code === 'bad-spread'),
        `expected bad-spread for ${bad}`
      ).toBe(true)
    }
  })
})

describe('attribute spread — codegen', () => {
  const compiler = new DiamondCompiler()
  const compile = (t: string) => compiler.compile(t, { sourceMap: false })

  it('emits a runtime-gated DiamondCore.spread call (no compile-time stink)', () => {
    const r = compile('<input ...attrs.bind="myGuts">')
    expect(r.code).toContain('DiamondCore.spread(el_input_0, () => this.myGuts);')
    expect(r.code).toContain('gate FIRST')
    expect(r.diagnostics ?? []).toHaveLength(0)
  })

  it('emits the raw variant with true arg + heavy stink:declared audit', () => {
    const r = compile('<input ...attrs.rawBind="ownedKeys">')
    expect(r.code).toContain('DiamondCore.spread(el_input_0, () => this.ownedKeys, true);')
    expect(r.code).toContain('raw sink — explicit opt-in')
    const declared = (r.diagnostics ?? []).filter((d) => d.code === 'stink:declared')
    expect(declared).toHaveLength(1)
    expect(declared[0]).toMatchObject({ property: '...attrs', op: 'spread' })
  })

  it('emits spread in source order relative to sibling bindings (last write wins)', () => {
    const r = compile(
      `<input placeholder.set="'first'" ...attrs.bind="overrides" value.to-view="v">`
    )
    const placeholderAt = r.code.indexOf('.placeholder =')
    const spreadAt = r.code.indexOf('DiamondCore.spread(')
    const valueAt = r.code.indexOf("DiamondCore.bind(el_input_0, 'value'")
    expect(placeholderAt).toBeGreaterThan(-1)
    expect(spreadAt).toBeGreaterThan(placeholderAt)
    expect(valueAt).toBeGreaterThan(spreadAt)
  })
})
