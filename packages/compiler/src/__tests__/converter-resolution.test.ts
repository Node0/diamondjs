/**
 * §5.6 converter parse resolution in compileAndInject — follows the import
 * (regex scan) relative to options.filePath and reads the module for `static parse`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DiamondCompiler } from '../compiler'

describe('§5.6 converter resolution (compileAndInject)', () => {
  const compiler = new DiamondCompiler()
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'diamond-conv-'))
    writeFileSync(
      join(dir, 'currency.ts'),
      'export class CurrencyConverter { static format(v,c){return ""} static parse(r,c){return {valid:true,value:0,raw:r,error:null}} }'
    )
    writeFileSync(
      join(dir, 'bad.ts'),
      'export class BadConverter { static format(v){return ""} }'
    )
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const inject = (template: string, source: string) =>
    compiler.compileAndInject(template, source, {
      filePath: join(dir, 'MyComp.html'),
    })

  it('passes when the converter exposes static parse', () => {
    const r = inject(
      `<input value.two-way="amount | CurrencyConverter('USD')">`,
      `import { CurrencyConverter } from './currency'\nexport class MyComp {}`
    )
    expect(r.diagnostics?.some((d) => d.severity === 'error')).toBeFalsy()
  })

  it('errors when the converter is missing static parse (§5.6 hard error)', () => {
    const r = inject(
      `<input value.two-way="amount | BadConverter()">`,
      `import { BadConverter } from './bad'\nexport class MyComp {}`
    )
    expect(r.diagnostics?.some((d) => d.code === 'converter-missing-parse')).toBe(
      true
    )
  })

  it('emits a soft info when the import is a package specifier (unfollowable)', () => {
    const r = inject(
      `<input value.two-way="amount | CurrencyConverter('USD')">`,
      `import { CurrencyConverter } from '@scope/currency'\nexport class MyComp {}`
    )
    const d = r.diagnostics?.find((x) => x.code === 'converter-unresolved')
    expect(d?.severity).toBe('info')
  })

  it('emits a soft info when no import statement is present', () => {
    const r = inject(
      `<input value.from-view="amount | Ghost()">`,
      `export class MyComp {}`
    )
    expect(r.diagnostics?.some((d) => d.code === 'converter-unresolved')).toBe(
      true
    )
  })

  it('exposes pipeTransforms (named heads) on a standalone compile', () => {
    const r = compiler.compile('<span>${v | formatPercent}</span>', {})
    expect(r.pipeTransforms).toContain('formatPercent')
  })
})
