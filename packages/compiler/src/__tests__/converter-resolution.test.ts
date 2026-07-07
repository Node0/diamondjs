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
    // Re-export fixtures (v2.1 §3.8)
    writeFileSync(
      join(dir, 'barrel.ts'),
      "export { CurrencyConverter } from './currency'\nexport { BadConverter } from './bad'"
    )
    writeFileSync(join(dir, 'star.ts'), "export * from './currency'")
    writeFileSync(
      join(dir, 'aliased.ts'),
      "export { CurrencyConverter as MoneyConverter } from './currency'"
    )
    writeFileSync(join(dir, 'deep3.ts'), "export { CurrencyConverter } from './deep2'")
    writeFileSync(join(dir, 'deep2.ts'), "export { CurrencyConverter } from './deep1'")
    writeFileSync(join(dir, 'deep1.ts'), "export { CurrencyConverter } from './barrel'")
    writeFileSync(join(dir, 'cycleA.ts'), "export { CycleConverter } from './cycleB'")
    writeFileSync(join(dir, 'cycleB.ts'), "export { CycleConverter } from './cycleA'")
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

  describe('re-export following (v2.1, §3.8)', () => {
    it('follows a named barrel re-export to the real module', () => {
      const r = inject(
        `<input value.two-way="amount | CurrencyConverter('USD')">`,
        `import { CurrencyConverter } from './barrel'\nexport class MyComp {}`
      )
      expect(r.diagnostics?.some((d) => d.severity === 'error')).toBeFalsy()
      expect(r.diagnostics?.some((d) => d.code === 'converter-unresolved')).toBe(false)
    })

    it('HARDENS a barrel-resolved missing parse to converter-missing-parse', () => {
      // Previously soft ('verify manually'); the walker now reaches bad.ts
      const r = inject(
        `<input value.two-way="amount | BadConverter()">`,
        `import { BadConverter } from './barrel'\nexport class MyComp {}`
      )
      expect(r.diagnostics?.some((d) => d.code === 'converter-missing-parse')).toBe(true)
    })

    it('follows export * from barrels', () => {
      const r = inject(
        `<input value.two-way="amount | CurrencyConverter('USD')">`,
        `import { CurrencyConverter } from './star'\nexport class MyComp {}`
      )
      expect(r.diagnostics?.some((d) => d.severity === 'error')).toBeFalsy()
      expect(r.diagnostics?.some((d) => d.code === 'converter-unresolved')).toBe(false)
    })

    it('follows an alias under the ORIGINAL name', () => {
      const r = inject(
        `<input value.two-way="amount | MoneyConverter('USD')">`,
        `import { MoneyConverter } from './aliased'\nexport class MyComp {}`
      )
      expect(r.diagnostics?.some((d) => d.severity === 'error')).toBeFalsy()
    })

    it('soft-infos a chain deeper than 3 hops', () => {
      const r = inject(
        `<input value.two-way="amount | CurrencyConverter('USD')">`,
        `import { CurrencyConverter } from './deep3'\nexport class MyComp {}`
      )
      const d = r.diagnostics?.find((x) => x.code === 'converter-unresolved')
      expect(d?.severity).toBe('info')
      expect(d?.message).toContain('deeper than 3')
    })

    it('soft-infos a circular re-export chain', () => {
      const r = inject(
        `<input value.two-way="amount | CycleConverter()">`,
        `import { CycleConverter } from './cycleA'\nexport class MyComp {}`
      )
      const d = r.diagnostics?.find((x) => x.code === 'converter-unresolved')
      expect(d?.severity).toBe('info')
      expect(d?.message).toContain('circular')
    })
  })
})
