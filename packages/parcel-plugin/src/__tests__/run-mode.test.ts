/**
 * v2.2 Phase 2 — run_mode / __DIAMOND_DEV__.
 *
 * app/config/config.json → app.settings.run_mode, resolved against the
 * Parcel project root, once per build. Fail-closed: absent file or absent
 * key → prod. Malformed JSON (or an invalid run_mode value) → build error,
 * never a silent prod default.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readRunMode, resetRunModeCache, compileTemplate } from '../utils'

function projectWith(configJson: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'diamond-runmode-'))
  if (configJson !== null) {
    mkdirSync(join(root, 'app', 'config'), { recursive: true })
    writeFileSync(join(root, 'app', 'config', 'config.json'), configJson)
  }
  return root
}

describe('readRunMode', () => {
  beforeEach(() => resetRunModeCache())

  it('returns dev when run_mode is "dev"', () => {
    const root = projectWith(
      JSON.stringify({ app: { settings: { run_mode: 'dev' } } })
    )
    try {
      expect(readRunMode(root)).toBe('dev')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns prod when run_mode is "prod"', () => {
    const root = projectWith(
      JSON.stringify({ app: { settings: { run_mode: 'prod' } } })
    )
    try {
      expect(readRunMode(root)).toBe('prod')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('defaults to prod when the file is absent (fail-closed)', () => {
    const root = projectWith(null)
    try {
      expect(readRunMode(root)).toBe('prod')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('defaults to prod when the key is absent (fail-closed)', () => {
    const root = projectWith(JSON.stringify({ app: { settings: {} } }))
    try {
      expect(readRunMode(root)).toBe('prod')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws a build error on malformed JSON — never a silent prod default', () => {
    const root = projectWith('{ this is not json')
    try {
      expect(() => readRunMode(root)).toThrow(/not valid JSON/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws a build error on an invalid run_mode value', () => {
    const root = projectWith(
      JSON.stringify({ app: { settings: { run_mode: 'dve' } } })
    )
    try {
      expect(() => readRunMode(root)).toThrow(/expected "dev" or "prod"/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('caches per project root (once per build)', () => {
    const root = projectWith(
      JSON.stringify({ app: { settings: { run_mode: 'dev' } } })
    )
    try {
      expect(readRunMode(root)).toBe('dev')
      // Flip the file on disk — the cached read must win until rebuild.
      writeFileSync(
        join(root, 'app', 'config', 'config.json'),
        JSON.stringify({ app: { settings: { run_mode: 'prod' } } })
      )
      expect(readRunMode(root)).toBe('dev')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('__DIAMOND_DEV__ injection', () => {
  it('injects true for dev builds', () => {
    const { outputCode } = compileTemplate(
      '<div>${message}</div>',
      'x.diamond.html',
      false,
      'dev'
    )
    expect(outputCode).toContain('const __DIAMOND_DEV__ = true;')
    expect(outputCode).toContain('globalThis.__DIAMOND_DEV__ = __DIAMOND_DEV__;')
  })

  it('injects false for prod builds', () => {
    const { outputCode } = compileTemplate(
      '<div>${message}</div>',
      'x.diamond.html',
      false,
      'prod'
    )
    expect(outputCode).toContain('const __DIAMOND_DEV__ = false;')
  })

  it('injects nothing when no run mode is provided (library callers)', () => {
    const { outputCode } = compileTemplate(
      '<div>${message}</div>',
      'x.diamond.html',
      false
    )
    expect(outputCode).not.toContain('__DIAMOND_DEV__')
  })
})
