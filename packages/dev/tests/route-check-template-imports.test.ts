/**
 * Issue #10 — route-check must load route maps whose page components import
 * compiled templates (`import * as T from './page.diamond.html'`) and styles.
 *
 * Before the fix the bin loaded the routes module through tsx, which has no
 * loader for `.html`: ERR_UNKNOWN_FILE_EXTENSION under an ESM consumer
 * ("type": "module"), a SyntaxError on the raw HTML under a CommonJS one. The
 * bin now installs inert template/style stubs on BOTH loader paths before
 * importing. These tests spawn the real bin (from source, via tsx) against
 * one fixture per package type.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const bin = resolve(here, '../src/bin/route-check.ts')
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')

function runRouteCheck(fixture: string): { status: number; output: string } {
  const cwd = resolve(here, 'fixtures/template-imports', fixture)
  expect(existsSync(resolve(cwd, 'routes.ts'))).toBe(true)
  try {
    const output = execFileSync(process.execPath, [tsxCli, bin, 'routes.ts'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })
    return { status: 0, output }
  } catch (e) {
    const err = e as { status: number; stdout?: string; stderr?: string }
    return { status: err.status, output: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

describe('route-check loads page components that import *.diamond.html + *.css', () => {
  it('passes for an ESM consumer ("type": "module" — loader-hook path)', () => {
    const { status, output } = runRouteCheck('esm')
    expect(output, output).not.toContain('ERR_UNKNOWN_FILE_EXTENSION')
    expect(output, output).toContain('route-check passed')
    expect(status).toBe(0)
  })

  it('passes for a CommonJS consumer (no "type" field — require() path)', () => {
    const { status, output } = runRouteCheck('cjs')
    expect(output, output).not.toContain('SyntaxError')
    expect(output, output).toContain('route-check passed')
    expect(status).toBe(0)
  })
})
