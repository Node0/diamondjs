/**
 * Template compilation tests for Counter.diamond.html
 *
 * Verifies the .diamond.html template compiles correctly
 * using the DiamondJS compiler with v1.5.1 output patterns.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { DiamondCompiler } from '@diamondjs/compiler'

const templatePath = resolve(__dirname, '../src/Counter.diamond.html')
const templateSource = readFileSync(templatePath, 'utf-8')

describe('Counter.diamond.html compilation', () => {
  const compiler = new DiamondCompiler()
  const result = compiler.compile(templateSource, {
    filePath: 'Counter.diamond.html',
    sourceMap: true,
  })

  it('compiles without errors', () => {
    expect(result.code).toBeDefined()
    expect(result.code.length).toBeGreaterThan(0)
  })

  it('produces an instance createTemplate() method (not static)', () => {
    expect(result.code).toContain('createTemplate()')
    expect(result.code).not.toContain('static createTemplate')
  })

  it('uses this. prefix for property references (v1.5.1)', () => {
    expect(result.code).toContain('this.count')
    expect(result.code).toContain('this.decrement()')
    expect(result.code).toContain('this.increment()')
    expect(result.code).not.toContain('vm.')
  })

  it('emits [Diamond] hint comments', () => {
    expect(result.code).toContain('// [Diamond]')
  })

  it('includes hint for the template method', () => {
    expect(result.code).toContain(
      '// [Diamond] Compiler-generated instance template method'
    )
  })

  it('includes hints for event bindings', () => {
    // Should have hints for click.trigger on both buttons
    expect(result.code).toMatch(/\/\/ \[Diamond\].*click/)
  })

  it('includes hint for text interpolation', () => {
    expect(result.code).toMatch(/\/\/ \[Diamond\].*interpolation/i)
  })

  it('creates the correct DOM structure', () => {
    expect(result.code).toContain("document.createElement('div')")
    expect(result.code).toContain("document.createElement('button')")
    expect(result.code).toContain("document.createElement('span')")
  })

  it('sets the counter class name', () => {
    expect(result.code).toContain("className = 'counter'")
  })

  it('generates source map', () => {
    expect(result.map).toBeDefined()
  })

  it('binds decrement and increment as event handlers', () => {
    expect(result.code).toContain("DiamondCore.on(")
    expect(result.code).toContain('this.decrement()')
    expect(result.code).toContain('this.increment()')
  })

  it('binds count as text interpolation', () => {
    expect(result.code).toContain('DiamondCore.bind(')
    expect(result.code).toContain('this.count')
  })
})
