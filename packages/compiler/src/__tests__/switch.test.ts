/**
 * <switch>/<case>/<default> tests (v2.1, Amendment A1 §7.3 / Amendment A2).
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'
import { TemplateParser } from '../parser'
import { isElementInfo } from '../types'

describe('switch — parsing', () => {
  const parser = new TemplateParser()

  it('parses a full switch into SwitchInfo (container erased, cases consumed)', () => {
    const nodes = parser.parse(`
      <switch on="status">
        <case if="loading"><div>Loading…</div></case>
        <case if="ready"><ul><li>ok</li></ul></case>
        <default><div>Unexpected</div></default>
      </switch>
    `)
    const sw = nodes.find((n) => isElementInfo(n) && n.tagName === 'switch')
    expect(sw).toBeDefined()
    if (sw && isElementInfo(sw)) {
      expect(sw.switchInfo?.onExpression).toBe('status')
      expect(sw.switchInfo?.cases).toHaveLength(2)
      expect(sw.switchInfo?.defaultChildren).not.toBeNull()
      expect(sw.children).toHaveLength(0) // cases live in switchInfo, not children
    }
  })

  it('classifies case matches: literals/bare words = equality, operators/dots = expression', () => {
    const nodes = parser.parse(`
      <switch on="status">
        <case if="loading">a</case>
        <case if="'ready'">b</case>
        <case if="3">c</case>
        <case if="true">d</case>
        <case if="progress > 0.5">e</case>
        <case if="user.role">f</case>
      </switch>
    `)
    const sw = nodes.find((n) => isElementInfo(n) && n.tagName === 'switch')
    if (sw && isElementInfo(sw)) {
      const kinds = sw.switchInfo!.cases.map((c) => [c.kind, c.literal])
      expect(kinds).toEqual([
        ['equality', 'loading'], // bare word → STRING equality
        ['equality', 'ready'],
        ['equality', 3],
        ['equality', true],
        ['expression', undefined], // operator
        ['expression', undefined], // dotted path → truthiness, NOT equality
      ])
    }
  })

  const errorCases: Array<[string, string]> = [
    ['<switch><case if="a">x</case></switch>', 'switch-no-on'],
    ['<switch on="s" class="x"><case if="a">x</case></switch>', 'switch-extraneous-attr'],
    ['<switch on="s"><div>x</div></switch>', 'switch-bad-child'],
    ['<switch on="s">loose text<case if="a">x</case></switch>', 'switch-bad-child'],
    ['<switch on="s"><case>x</case></switch>', 'case-no-if'],
    ['<switch on="s"><case if="a" class="y">x</case></switch>', 'switch-extraneous-attr'],
    ['<switch on="s"><default>x</default><default>y</default></switch>', 'switch-multiple-default'],
    ['<switch on="s"><default>x</default><case if="a">y</case></switch>', 'switch-default-not-last'],
    ['<switch on="s"><default class="z">x</default></switch>', 'switch-extraneous-attr'],
    ['<switch on="s"></switch>', 'switch-empty'],
    ['<div><case if="a">x</case></div>', 'case-outside-switch'],
    ['<div><default>x</default></div>', 'default-outside-switch'],
  ]

  for (const [template, code] of errorCases) {
    it(`rejects: ${code}`, () => {
      parser.parse(template)
      expect(
        parser.diagnostics.some((d) => d.code === code),
        `expected ${code} for ${template}; got ${parser.diagnostics.map((d) => d.code).join(',')}`
      ).toBe(true)
    })
  }
})

describe('switch — codegen (Option B runtime lowering)', () => {
  const compiler = new DiamondCompiler()
  const compile = (t: string) => compiler.compile(t, { sourceMap: false })

  it('lowers to DiamondCore.switch with equality matches and a default', () => {
    const r = compile(`
      <switch on="status">
        <case if="loading"><div>Loading…</div></case>
        <case if="ready"><div>Ready</div></case>
        <default><div>Unexpected</div></default>
      </switch>
    `)
    expect(r.code).toContain("document.createComment('switch')")
    expect(r.code).toContain('DiamondCore.switch(switchAnchor_0, () => this.status, [')
    expect(r.code).toContain("{ match: (v) => v === 'loading', make: () => {")
    expect(r.code).toContain("{ match: (v) => v === 'ready', make: () => {")
    expect(r.code).toContain('], () => {')
    expect(r.code).toContain('// [Diamond] Switch: on="status" (2 cases + default)')
    expect(r.code).toContain('// [Diamond] default — renders when no case matches')
    expect(r.diagnostics ?? []).toHaveLength(0)
  })

  it('prefixes expression cases against component state', () => {
    const r = compile(`
      <switch on="progress">
        <case if="progress > 0.5"><div>far</div></case>
      </switch>
    `)
    expect(r.code).toContain('{ match: (v) => this.progress > 0.5, make: () => {')
  })

  it('wraps a multi-root case body in a fragment (erased container semantics)', () => {
    const r = compile(`
      <switch on="s">
        <case if="a"><div>one</div><div>two</div></case>
      </switch>
    `)
    expect(r.code).toContain('document.createDocumentFragment()')
    expect(r.code).toMatch(/caseRoot_\d+\.appendChild\(el_div_\d+\)/)
  })

  it('supports a nested switch inside a case (container walls off scope)', () => {
    const r = compile(`
      <switch on="outer">
        <case if="a">
          <switch on="inner">
            <case if="x"><span>deep</span></case>
            <default><span>inner-default</span></default>
          </switch>
        </case>
      </switch>
    `)
    const count = (r.code.match(/DiamondCore\.switch\(/g) ?? []).length
    expect(count).toBe(2)
    expect(r.diagnostics ?? []).toHaveLength(0)
  })
})

describe('switch — Option A static fast path', () => {
  const compiler = new DiamondCompiler()
  const compile = (t: string) => compiler.compile(t, { sourceMap: false })

  it('emits only the winning branch for a pure-literal on= (zero runtime cost)', () => {
    const r = compile(`
      <switch on="'ready'">
        <case if="loading"><div>Loading…</div></case>
        <case if="ready"><div>Ready</div></case>
      </switch>
    `)
    expect(r.code).toContain('resolved at compile time → case if="ready"')
    expect(r.code).toContain('Ready')
    expect(r.code).not.toContain('DiamondCore.switch(')
    expect(r.code).not.toContain('Loading…')
  })

  it('resolves to the default when no case matches a static on=', () => {
    const r = compile(`
      <switch on="'archived'">
        <case if="loading"><div>Loading…</div></case>
        <default><div>Fallback</div></default>
      </switch>
    `)
    expect(r.code).toContain('resolved at compile time → default')
    expect(r.code).toContain('Fallback')
    expect(r.code).not.toContain('DiamondCore.switch(')
  })

  it('DEAD static switch: warns switch-static-dead and mounts an inspectable comment', () => {
    const r = compile(`
      <switch on="'archived'">
        <case if="loading"><div>Loading…</div></case>
        <case if="ready"><div>Ready</div></case>
      </switch>
    `)
    const dead = (r.diagnostics ?? []).filter((d) => d.code === 'switch-static-dead')
    expect(dead).toHaveLength(1)
    expect(dead[0].severity).toBe('warn') // unused code — NOT a build blocker
    expect(r.code).toContain('dead switch')
    expect(r.code).toMatch(/const deadSwitch_\d+ = document\.createComment\(/)
    expect(r.code).not.toContain('DiamondCore.switch(')
    expect(r.code).not.toContain('Loading…')
  })

  it('falls back to the runtime lowering when any case is an expression', () => {
    const r = compile(`
      <switch on="'ready'">
        <case if="progress > 0.5"><div>far</div></case>
        <case if="ready"><div>Ready</div></case>
      </switch>
    `)
    // An expression case could preempt at runtime — winner undecidable statically
    expect(r.code).toContain('DiamondCore.switch(')
  })

  it('a reactive (identifier) on= is never static', () => {
    const r = compile(`
      <switch on="status">
        <case if="ready"><div>Ready</div></case>
      </switch>
    `)
    expect(r.code).toContain('DiamondCore.switch(')
  })
})
