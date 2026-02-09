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
    /\.\s*(bind|one-time|to-view|from-view|two-way|trigger|delegate|capture)\s*=/
  // Check for interpolation syntax: ${...}
  const interpolationPattern = /\$\{[^}]+\}/

  return bindingPattern.test(code) || interpolationPattern.test(code)
}

/**
 * Compile a DiamondJS template to JavaScript module code
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

  // Convert 'static createTemplate()' to 'function createTemplate()'
  // for standalone module export (the compiler outputs class method syntax)
  const functionCode = result.code.replace(
    /^static createTemplate\(\)/,
    'function createTemplate()'
  )

  // Wrap in a module that exports the createTemplate function
  const outputCode = `import { DiamondCore } from '@diamondjs/runtime';

// Compiled from: ${filePath}
export ${functionCode}
`

  return { outputCode, result }
}
