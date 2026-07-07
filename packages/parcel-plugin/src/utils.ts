/**
 * Utility functions for the DiamondJS Parcel transformer
 */

import { DiamondCompiler, type CompileResult } from '@diamondjs/compiler'

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
  sourceMap: boolean = true
): { outputCode: string; result: CompileResult } {
  const compiler = new DiamondCompiler()

  // Compile the template
  const result = compiler.compile(code, {
    filePath,
    sourceMap,
  })

  // Standalone .diamond.html → module path: named pipe transforms (converters or
  // plain functions) would be undefined symbols here — they live in the component's
  // import scope, not this generated module. Fail closed with a clear error rather
  // than ship a runtime ReferenceError (DDR §5.5 — provenance is the import graph).
  if (result.pipeTransforms && result.pipeTransforms.length > 0) {
    result.diagnostics = [
      ...(result.diagnostics ?? []),
      {
        severity: 'error',
        code: 'pipe-transform-standalone',
        message:
          `Named pipe transform(s) [${result.pipeTransforms.join(', ')}] require the ` +
          `component context — a standalone .diamond.html module cannot import them. ` +
          `Define the template on the component (so its imports are in scope), or inline the value.`,
        location: null,
      },
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

  // Wrap in a module that exports the createTemplate function
  const outputCode = `import { DiamondCore } from '@diamondjs/runtime';

// [Diamond] Compiled from: ${filePath}
${hintLine}
export ${functionCode}
`

  return { outputCode, result }
}
