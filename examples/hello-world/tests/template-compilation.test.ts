/**
 * Compilation test for Tasks.diamond.html — verifies the v2.0 compiler lowers
 * set / rawSet / if / else-if / repeat.for / .calls / two-way / interpolation.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { DiamondCompiler } from '@diamondjs/compiler'

const source = readFileSync(
  resolve(__dirname, '../src/Tasks.diamond.html'),
  'utf-8'
)

describe('Tasks.diamond.html compilation', () => {
  const r = new DiamondCompiler().compile(source, {
    filePath: 'Tasks.diamond.html',
    sourceMap: false,
  })

  it('has no error-severity diagnostics', () => {
    expect(r.diagnostics?.some((d) => d.severity === 'error')).toBeFalsy()
  })

  it('emits an instance createTemplate using this (no vm)', () => {
    expect(r.code).toContain('createTemplate()')
    expect(r.code).not.toContain('vm.')
  })

  it('lowers set to a direct one-shot write', () => {
    expect(r.code).toMatch(/\.textContent = this\.title/)
  })

  it('lowers rawSet and records it as stink:declared (audited escape hatch)', () => {
    expect(r.code).toMatch(/\.innerHTML = this\.bannerHtml/)
    expect(r.diagnostics?.some((d) => d.code === 'stink:declared')).toBe(true)
  })

  it('lowers if/else-if to a single DiamondCore.if chain', () => {
    expect(r.code).toContain('DiamondCore.if(')
    expect(r.code).toContain('() => this.tasks.length === 0')
    expect(r.code).toContain('() => this.tasks.length > 0')
  })

  it('lowers repeat.for with the loop variable unprefixed', () => {
    expect(r.code).toContain('DiamondCore.repeat(')
    expect(r.code).toContain('() => this.tasks')
    expect(r.code).toContain('(task) => {')
    expect(r.code).toContain('`${task.title}`')
  })

  it('lowers .calls events with this. and the loop var', () => {
    expect(r.code).toContain('this.add()')
    expect(r.code).toContain('this.remove(task)')
  })

  it('lowers the two-way value binding', () => {
    expect(r.code).toMatch(/DiamondCore\.bind\(el_input_\d+, 'value', \(\) => this\.draft/)
  })
})
