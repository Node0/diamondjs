/**
 * Utility functions for the DiamondJS Parcel transformer
 */

import { DiamondCompiler, type CompileResult } from '@diamondjs/compiler'

/**
 * Check if HTML content is a DiamondJS template
 * Templates contain binding syntax like .bind, .trigger, .delegate, etc.
 */
export function isDiamondTemplate(code: string): boolean {
  // Check for binding syntax: property.command="expression"
  const bindingPattern =
    /\.\s*(bind|unsafe-bind|one-time|to-view|from-view|two-way|trigger|delegate|capture)\s*=/
  // Check for interpolation syntax: ${...}
  const interpolationPattern = /\$\{[^}]+\}/

  return bindingPattern.test(code) || interpolationPattern.test(code)
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
