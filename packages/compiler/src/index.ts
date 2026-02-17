/**
 * @diamondjs/compiler
 *
 * DiamondJS Template Compiler
 * Compiles Aurelia-like templates to explicit DiamondCore runtime calls
 *
 * @example
 * import { DiamondCompiler } from '@diamondjs/compiler'
 *
 * const compiler = new DiamondCompiler()
 * const result = compiler.compile('<input value.bind="name">')
 * console.log(result.code)
 * // Output:
 * // // [Diamond] Compiler-generated instance template method
 * // createTemplate() {
 * //   // [Diamond] Two-way binding: value ↔ this.name
 * //   DiamondCore.bind(input0, 'value', () => this.name, (v) => this.name = v);
 * //   return input0;
 * // }
 */

// Main compiler
export { DiamondCompiler, CompileError } from './compiler'

// Parser (for advanced usage)
export { TemplateParser } from './parser'

// Generator (for advanced usage)
export { CodeGenerator } from './generator'

// Types
export type {
  SourceLocation,
  BindingType,
  BindingInfo,
  InterpolationInfo,
  ElementInfo,
  TextInfo,
  NodeInfo,
  CompilerOptions,
  CompileResult,
} from './types'

export { isElementInfo, isTextInfo } from './types'
