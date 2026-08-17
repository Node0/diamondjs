/**
 * Utility functions for the DiamondJS Parcel transformer
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { DiamondCompiler, type CompileResult } from '@diamondjs/compiler'

export type RunMode = 'dev' | 'prod'

/** run_mode cache — read once per build (per project root). Dev/prod is a
 *  build-time property; flipping requires a rebuild (v2.2 Phase 2). */
const runModeCache = new Map<string, RunMode>()

/**
 * Read `app.settings.run_mode` from `<projectRoot>/app/config/config.json`
 * (v2.2 Phase 2). Fail-closed defaults: absent file or absent key → 'prod'.
 * Malformed JSON that exists but cannot parse — and a present run_mode with a
 * value outside 'dev' | 'prod' — is a BUILD ERROR, never a silent prod default.
 */
export function readRunMode(projectRoot: string): RunMode {
  const cached = runModeCache.get(projectRoot)
  if (cached) return cached

  const configPath = join(projectRoot, 'app', 'config', 'config.json')
  let mode: RunMode = 'prod'
  if (existsSync(configPath)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (e) {
      throw new Error(
        `[Diamond] ${configPath} exists but is not valid JSON — refusing to ` +
          `silently default to prod. Fix or remove the file. (${(e as Error).message})`
      )
    }
    const value = (parsed as { app?: { settings?: { run_mode?: unknown } } })
      ?.app?.settings?.run_mode
    if (value === undefined) {
      mode = 'prod' // absent key — fail-closed default
    } else if (value === 'dev' || value === 'prod') {
      mode = value
    } else {
      throw new Error(
        `[Diamond] ${configPath}: app.settings.run_mode is ${JSON.stringify(value)}; ` +
          `expected "dev" or "prod". Refusing to silently default to prod.`
      )
    }
  }
  runModeCache.set(projectRoot, mode)
  return mode
}

/** Test seam: clear the once-per-build run_mode cache. */
export function resetRunModeCache(): void {
  runModeCache.clear()
}

/**
 * Check if HTML content is a DiamondJS template.
 *
 * Detects the v2.0 command surface AND the retired v1.5.1 tokens — retired
 * tokens must still be detected so the file is compiled and routes to the
 * "renamed to ..." diagnostic, rather than being silently served as raw HTML.
 * Runs on the raw source (pre-parse5), so it is case-insensitive to catch the
 * source-only camelCase of rawSet/rawBind.
 */
export function isDiamondTemplate(code: string): boolean {
  // Binding syntax: property.command[.qualifier]="expression"
  const bindingPattern =
    /\.\s*(set|rawset|bind|rawbind|to-view|from-view|two-way|calls|capture|one-time|trigger|delegate)\s*=/i
  // Interpolation syntax: ${...}
  const interpolationPattern = /\$\{[^}]+\}/
  // v2.1 structural-only templates: <switch> and repeat.for= are unambiguous
  // Diamond tokens (a bare if= is NOT used — false-positive risk on non-Diamond
  // HTML; an if-only template with zero bindings/interpolations stays undetected,
  // documented in Amendment A2).
  const structuralPattern = /<switch[\s>]|repeat\.for\s*=/i

  return (
    bindingPattern.test(code) ||
    interpolationPattern.test(code) ||
    structuralPattern.test(code)
  )
}

/**
 * Compile a DiamondJS template to JavaScript module code
 *
 * v1.5.1: The compiler now emits instance createTemplate() methods
 * with 'this' references and [Diamond] hint comments.
 */
export function compileTemplate(
  code: string,
  filePath: string,
  sourceMap: boolean = true,
  runMode?: RunMode
): { outputCode: string; result: CompileResult } {
  const compiler = new DiamondCompiler()

  // Compile the template
  const result = compiler.compile(code, {
    filePath,
    sourceMap,
  })

  // Standalone .diamond.html → module path: named pipe transforms would be
  // undefined symbols here UNLESS the template declares their provenance with
  // <!-- @import { X } from './module' --> directives (v2.1, §3.6). Only
  // UNCOVERED heads fail closed (DDR §5.5 — provenance is the import graph).
  const covered = new Set(
    (result.templateImports ?? []).flatMap((ti) => ti.names)
  )
  const uncovered = (result.pipeTransforms ?? []).filter(
    (head) => !covered.has(head)
  )
  if (uncovered.length > 0) {
    result.diagnostics = [
      ...(result.diagnostics ?? []),
      {
        severity: 'error',
        code: 'pipe-transform-standalone',
        message:
          `Named pipe transform(s) [${uncovered.join(', ')}] require the ` +
          `component context — a standalone .diamond.html module cannot import them. ` +
          `Define the template on the component (so its imports are in scope), ` +
          `declare provenance with <!-- @import { ${uncovered[0]} } from './module' -->, or inline the value.`,
        location: null,
      },
    ]
  }

  // Render real import lines from the directives; Parcel resolves the relative
  // specs against this asset (the .diamond.html file) — the author's mental model.
  const importLines = (result.templateImports ?? [])
    .map((ti) => `import { ${ti.names.join(', ')} } from '${ti.spec}';`)
    .join('\n')

  // §5.6 in standalone mode: verify converter obligations against the imports
  // the directives synthesize (the inject path never had this gap).
  if (importLines && result.converterObligations?.length) {
    result.diagnostics = [
      ...(result.diagnostics ?? []),
      ...compiler.verifyObligations(result, importLines, filePath),
    ]
  }

  // The compiler emits an instance method with a [Diamond] hint comment:
  //   // [Diamond] Compiler-generated instance template method
  //   createTemplate() { ... }
  // Convert to a standalone exported function for module usage.
  // Strip the hint line and place it before the export keyword.
  const hintLine = '// [Diamond] Compiler-generated instance template method'
  const strippedCode = result.code.replace(hintLine + '\n', '')
  const functionCode = strippedCode.replace(
    /^createTemplate\(\)/m,
    'function createTemplate()'
  )

  // v2.2 Phase 2: inject the compile-time constant. True iff run_mode is
  // "dev"; also mirrored onto globalThis so the runtime (router startup
  // table, §3.7) can read the build's mode.
  const devConstLines =
    runMode !== undefined
      ? `// [Diamond] run_mode: ${runMode} (build-time property; flip requires rebuild)
const __DIAMOND_DEV__ = ${runMode === 'dev'};
globalThis.__DIAMOND_DEV__ = __DIAMOND_DEV__;
`
      : ''

  // Wrap in a module that exports the createTemplate function
  const outputCode = `import { DiamondCore } from '@diamondjs/runtime';
${importLines ? importLines + '\n' : ''}${devConstLines}
// [Diamond] Compiled from: ${filePath}
${hintLine}
export ${functionCode}
`

  return { outputCode, result }
}
