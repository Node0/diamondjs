/**
 * Parcel Transformer Tests
 *
 * Note: Full integration tests with Parcel are done in the examples.
 * These tests verify the template detection logic and basic compilation.
 */

import { describe, it, expect } from 'vitest'
import { isDiamondTemplate, compileTemplate } from '../utils'

describe('isDiamondTemplate', () => {
  it('detects .bind syntax', () => {
    expect(isDiamondTemplate('<input value.bind="name">')).toBe(true)
  })

  it('detects .one-time syntax', () => {
    expect(isDiamondTemplate('<span textContent.one-time="title"></span>')).toBe(
      true
    )
  })

  it('detects .to-view syntax', () => {
    expect(isDiamondTemplate('<span textContent.to-view="message"></span>')).toBe(
      true
    )
  })

  it('detects .from-view syntax', () => {
    expect(isDiamondTemplate('<input value.from-view="query">')).toBe(true)
  })

  it('detects .two-way syntax', () => {
    expect(isDiamondTemplate('<input value.two-way="name">')).toBe(true)
  })

  it('detects .trigger syntax', () => {
    expect(isDiamondTemplate('<button click.trigger="save()"></button>')).toBe(
      true
    )
  })

  it('detects .delegate syntax', () => {
    expect(
      isDiamondTemplate('<button click.delegate="handleClick()"></button>')
    ).toBe(true)
  })

  it('detects .capture syntax', () => {
    expect(isDiamondTemplate('<div click.capture="onCapture()"></div>')).toBe(
      true
    )
  })

  it('detects interpolation syntax', () => {
    expect(isDiamondTemplate('<div>Hello ${name}!</div>')).toBe(true)
  })

  it('rejects plain HTML', () => {
    expect(isDiamondTemplate('<div class="container">Hello</div>')).toBe(false)
  })

  it('rejects HTML with similar but not matching patterns', () => {
    expect(isDiamondTemplate('<div data-bind="something">Hello</div>')).toBe(
      false
    )
    expect(isDiamondTemplate('<div class="trigger">Click me</div>')).toBe(false)
  })

  it('handles whitespace around binding command', () => {
    expect(isDiamondTemplate('<input value. bind ="name">')).toBe(true)
  })
})

describe('compileTemplate', () => {
  it('compiles a simple template', () => {
    const template = '<input value.bind="name">'
    const { outputCode, result } = compileTemplate(template, 'test.html', true)

    expect(outputCode).toContain("import { DiamondCore } from '@diamondjs/runtime'")
    expect(outputCode).toContain('// [Diamond] Compiled from: test.html')
    expect(outputCode).toContain('export function createTemplate()')
    expect(result.code).toContain("DiamondCore.bind(input0, 'value'")
    expect(result.map).toBeDefined()
  })

  it('uses this. instead of vm. in compiled output', () => {
    const template = '<input value.bind="name">'
    const { outputCode } = compileTemplate(template, 'test.html', true)

    expect(outputCode).toContain('this.name')
    expect(outputCode).not.toContain('vm.name')
  })

  it('includes [Diamond] hint comments', () => {
    const template = '<input value.bind="name">'
    const { outputCode } = compileTemplate(template, 'test.html', true)

    expect(outputCode).toContain('// [Diamond]')
  })

  it('compiles without source maps when disabled', () => {
    const template = '<div></div>'
    const { result } = compileTemplate(template, 'test.html', false)

    expect(result.map).toBeUndefined()
  })

  it('compiles a complete component template', () => {
    const template = `
      <div class="counter">
        <button click.trigger="decrement()">-</button>
        <span>\${count}</span>
        <button click.trigger="increment()">+</button>
      </div>
    `
    const { outputCode } = compileTemplate(template, 'counter.html')

    expect(outputCode).toContain("document.createElement('div')")
    expect(outputCode).toContain("div0.className = 'counter'")
    expect(outputCode).toContain('this.decrement()')
    expect(outputCode).toContain('this.increment()')
    expect(outputCode).toContain('this.count')
  })

  it('generates valid ES module syntax', () => {
    const template = '<input value.bind="name">'
    const { outputCode } = compileTemplate(template, 'component.html')

    // Should have import at the top
    expect(outputCode.startsWith("import { DiamondCore }")).toBe(true)
    // Should export a regular function (not static method)
    expect(outputCode).toContain('export function createTemplate()')
  })

  it('includes file path comment', () => {
    const { outputCode } = compileTemplate('<div></div>', 'my-component.html')

    expect(outputCode).toContain('// [Diamond] Compiled from: my-component.html')
  })
})
