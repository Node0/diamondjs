/**
 * Structural directive tests (DDR §6.1 with-removed, §6.2 if/else-if + A1, §6.3 repeat.for).
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'
import { TemplateParser } from '../parser'
import { isElementInfo } from '../types'

describe('structural directives — parsing', () => {
  const parser = new TemplateParser()

  it('parses bare if as a structural directive', () => {
    const nodes = parser.parse('<div if="isReady">x</div>')
    const el = nodes[0]
    if (isElementInfo(el)) {
      expect(el.structural?.type).toBe('if')
      expect(el.structural?.expression).toBe('isReady')
    }
  })

  it('parses else-if', () => {
    const nodes = parser.parse('<div else-if="hasError">x</div>')
    const el = nodes[0]
    if (isElementInfo(el)) expect(el.structural?.type).toBe('else-if')
  })

  it('parses repeat.for into itemName + itemsExpression', () => {
    const nodes = parser.parse('<li repeat.for="user of users">x</li>')
    const el = nodes[0]
    if (isElementInfo(el)) {
      expect(el.structural?.type).toBe('repeat')
      expect(el.structural?.itemName).toBe('user')
      expect(el.structural?.itemsExpression).toBe('users')
    }
  })

  it('rejects bare else (Amendment A1)', () => {
    parser.parse('<div else>x</div>')
    expect(parser.diagnostics.some((d) => d.code === 'bare-else-removed')).toBe(
      true
    )
  })

  it('rejects if.bind / if.set (if has no sink)', () => {
    parser.parse('<div if.bind="a">x</div>')
    expect(parser.diagnostics.some((d) => d.code === 'if-no-command')).toBe(true)
    parser.parse('<div if.set="a">x</div>')
    expect(parser.diagnostics.some((d) => d.code === 'if-no-command')).toBe(true)
  })

  it('rejects rawIf', () => {
    parser.parse('<div rawIf="a">x</div>')
    expect(parser.diagnostics.some((d) => d.code === 'raw-if-invalid')).toBe(true)
  })

  it('rejects with / with.bind (DDR §6.1)', () => {
    parser.parse('<div with="user">x</div>')
    expect(parser.diagnostics.some((d) => d.code === 'with-removed')).toBe(true)
    parser.parse('<div with.bind="user">x</div>')
    expect(parser.diagnostics.some((d) => d.code === 'with-removed')).toBe(true)
  })

  it('rejects unknown / malformed repeat', () => {
    parser.parse('<li repeat.each="x of xs">y</li>')
    expect(parser.diagnostics.some((d) => d.code === 'bad-repeat')).toBe(true)
    parser.parse('<li repeat.for="garbage">y</li>')
    expect(parser.diagnostics.some((d) => d.code === 'bad-repeat')).toBe(true)
  })
})

describe('structural directives — codegen', () => {
  const compiler = new DiamondCompiler()
  const compile = (t: string) => compiler.compile(t, { sourceMap: false }).code

  it('lowers if/else-if to a single DiamondCore.if chain', () => {
    const code = compile(
      '<div><span if="a">A</span><span else-if="b">B</span></div>'
    )
    expect(code).toContain('DiamondCore.if(')
    expect(code).toContain("document.createComment('if')")
    expect(code).toContain('{ when: () => this.a, make: () => {')
    expect(code).toContain('{ when: () => this.b, make: () => {')
    expect(code).toContain('// [Diamond] Conditional: if="a" (+1 else-if)')
  })

  it('prefixes operator conditions correctly (token-aware)', () => {
    const code = compile('<div if="!isLoading && count > 0">x</div>')
    expect(code).toContain('() => !this.isLoading && this.count > 0')
  })

  it('does not prefix string literals in conditions', () => {
    const code = compile(`<div if="status === 'ready'">x</div>`)
    expect(code).toContain(`() => this.status === 'ready'`)
  })

  it('lowers repeat.for to DiamondCore.repeat with the loop var unprefixed', () => {
    const code = compile('<ul><li repeat.for="user of users">${user.name}</li></ul>')
    expect(code).toContain('DiamondCore.repeat(')
    expect(code).toContain('() => this.users')
    expect(code).toContain('(user) => {')
    expect(code).toContain('`${user.name}`')
  })

  it('keeps the loop variable in scope for event args', () => {
    const code = compile(
      '<ul><li repeat.for="u of items" click.calls="pick(u)">x</li></ul>'
    )
    expect(code).toContain('(e) => this.pick(u)')
  })

  it('handles nested repeat + if with independent scopes', () => {
    const code = compile(
      '<ul><li repeat.for="row of rows"><span if="row.active">${row.label}</span></li></ul>'
    )
    expect(code).toContain('() => this.rows')
    expect(code).toContain('(row) => {')
    expect(code).toContain('() => row.active')
    expect(code).toContain('`${row.label}`')
  })

  it('reports an orphan else-if', () => {
    const result = compiler.compile('<div><span else-if="a">x</span></div>', {
      sourceMap: false,
    })
    expect(result.diagnostics?.some((d) => d.code === 'orphan-else-if')).toBe(
      true
    )
  })

  it('if has no security gate (no stink for a conditional)', () => {
    const result = compiler.compile('<div if="userControlled">x</div>', {
      sourceMap: false,
    })
    expect(
      result.diagnostics?.some((d) => d.code?.startsWith('stink'))
    ).toBeFalsy()
  })
})
