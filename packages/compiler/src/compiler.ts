/**
 * DiamondCompiler - Main compiler class
 *
 * Compiles DiamondJS HTML templates to JavaScript code
 * that creates DOM and sets up bindings via instance methods.
 * All compiled output uses 'this' to reference the component instance.
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { TemplateParser } from './parser'
import { CodeGenerator } from './generator'
import type {
  CompilerOptions,
  CompileResult,
  ConverterObligation,
  Diagnostic,
} from './types'

/**
 * DiamondCompiler - The main template compiler
 *
 * @example
 * const compiler = new DiamondCompiler()
 * const result = compiler.compile('<input value.bind="name">', {
 *   filePath: 'my-component.html'
 * })
 * console.log(result.code)
 */
export class DiamondCompiler {
  private parser: TemplateParser

  constructor() {
    this.parser = new TemplateParser()
  }

  /**
   * Compile an HTML template to JavaScript
   *
   * @param template - HTML template string
   * @param options - Compiler options
   * @returns Compilation result with code and optional source map
   */
  compile(template: string, options: CompilerOptions = {}): CompileResult {
    // Parse the template
    const nodes = this.parser.parse(template)

    // Generate code
    const generator = new CodeGenerator(options)
    const result = generator.generate(nodes)

    // Merge parser diagnostics (retired/unknown commands) ahead of codegen ones
    // (gate stink). Enforcement happens downstream: the transformer throws on
    // 'error', the stink-check tool gates 'warn' and baselines 'declared'.
    result.diagnostics = [
      ...this.parser.diagnostics,
      ...(result.diagnostics ?? []),
    ]
    return result
  }

  /**
   * Compile a template and inject into a component class
   *
   * @param template - HTML template string
   * @param componentSource - Component TypeScript/JavaScript source
   * @param options - Compiler options
   * @returns Modified component source with injected createTemplate method
   */
  compileAndInject(
    template: string,
    componentSource: string,
    options: CompilerOptions = {}
  ): CompileResult {
    // Compile the template
    const compiled = this.compile(template, options)
    const diagnostics: Diagnostic[] = [...(compiled.diagnostics ?? [])]

    // §5.6: verify each converter obligation by following its import. This is the
    // inject path — componentSource carries the converter's import statement, which
    // the standalone template (compile()) never sees. The compiler follows that
    // import relative to options.filePath and reads the module for `static parse`.
    for (const ob of compiled.converterObligations ?? []) {
      const diag = this.verifyConverterParse(
        ob,
        componentSource,
        options.filePath
      )
      if (diag) diagnostics.push(diag)
    }

    // Find the class to inject into
    const className = options.className || this.detectClassName(componentSource)
    if (!className) {
      throw new CompileError(
        'Could not detect component class name. ' +
          'Specify className in options or ensure file has a class declaration.',
        { line: 1, column: 0 }
      )
    }

    // Inject the createTemplate method
    const injectedSource = this.injectMethod(
      componentSource,
      className,
      compiled.code
    )

    // Add DiamondCore import if needed
    const finalSource = this.ensureImport(injectedSource)

    return { code: finalSource, map: compiled.map, diagnostics }
  }

  /**
   * Verify a converter exposes `static parse` (DDR §5.6) by following its import.
   *
   * Uses a regex scan of `componentSource` for the import (not a full TS parse —
   * the string-based compiler's accepted ceiling), resolves the module path
   * relative to `filePath`, and reads it. Returns:
   *   - error  ('converter-missing-parse') when the module has no `static parse`
   *   - info   ('converter-unresolved')    when the import can't be followed
   *            (bare/package specifier, re-export, missing file) → verify manually
   *   - null   when `static parse` is present
   */
  private verifyConverterParse(
    ob: ConverterObligation,
    componentSource: string,
    filePath?: string
  ): Diagnostic | null {
    const unresolved = (detail: string): Diagnostic => ({
      severity: 'info',
      code: 'converter-unresolved',
      message:
        `Could not follow the import for converter '${ob.name}' (used on a ` +
        `${ob.direction} binding): ${detail}. Verify it exports a static parse method manually.`,
      location: ob.location,
      property: ob.name,
    })

    const importRe = new RegExp(
      `import[^;]*\\b${ob.name}\\b[^;]*from\\s+['"]([^'"]+)['"]`
    )
    const m = componentSource.match(importRe)
    if (!m) return unresolved('no import statement found')
    if (!filePath) return unresolved('no source file path to resolve against')

    const spec = m[1]
    if (!spec.startsWith('.')) {
      return unresolved(`'${spec}' is a package specifier, not a relative path`)
    }

    const baseDir = dirname(filePath)
    const candidates = [
      resolve(baseDir, spec),
      resolve(baseDir, `${spec}.ts`),
      resolve(baseDir, `${spec}.js`),
      resolve(baseDir, spec, 'index.ts'),
      resolve(baseDir, spec, 'index.js'),
    ]

    let source: string | null = null
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      try {
        source = readFileSync(candidate, 'utf-8')
        break
      } catch {
        // directory or unreadable — keep trying
      }
    }
    if (source === null) return unresolved(`could not read module '${spec}'`)

    if (!/static\s+parse\b/.test(source)) {
      return {
        severity: 'error',
        code: 'converter-missing-parse',
        message:
          `Converter '${ob.name}' is used on a ${ob.direction} binding but its ` +
          `module ('${spec}') has no static parse method. ${ob.direction} bindings ` +
          `require parse to validate inbound values (DDR §5.6).`,
        location: ob.location,
        property: ob.name,
      }
    }
    return null
  }

  /**
   * Detect the component class name from source
   */
  private detectClassName(source: string): string | null {
    // Match: export class ClassName or class ClassName extends Component
    const classMatch = source.match(
      /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?/
    )
    return classMatch ? classMatch[1] : null
  }

  /**
   * Inject the createTemplate method into the class
   */
  private injectMethod(
    source: string,
    className: string,
    methodCode: string
  ): string {
    // Find the class and its closing brace
    // This is a simplified approach - a full implementation would use AST
    // Match class opening, body content (non-greedy), and closing brace
    const classPattern = new RegExp(
      `(class\\s+${className}[^{]*\\{)([\\s\\S]*?)(\\})`,
      'm'
    )

    const match = source.match(classPattern)
    if (!match) {
      throw new CompileError(
        `Could not find class "${className}" in component file`,
        { line: 1, column: 0 }
      )
    }

    const [, classStart, classBody] = match
    const insertIndex = match.index! + classStart.length + classBody.length

    // Inject the method before the closing brace
    const indentedMethod = methodCode
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n')

    // Add newlines for proper formatting
    const needsLeadingNewline = classBody.length > 0 && !classBody.endsWith('\n')
    const prefix = needsLeadingNewline ? '\n' : (classBody.length === 0 ? '\n' : '')

    return (
      source.slice(0, insertIndex) +
      prefix +
      indentedMethod +
      '\n' +
      source.slice(insertIndex)
    )
  }

  /**
   * Ensure DiamondCore is imported
   */
  private ensureImport(source: string): string {
    // Check if DiamondCore is already imported
    if (/import\s*\{[^}]*DiamondCore[^}]*\}\s*from/.test(source)) {
      return source
    }

    // Check if there's an existing diamond import to extend
    const diamondImportMatch = source.match(
      /import\s*\{([^}]*)\}\s*from\s*['"]@diamondjs\/runtime['"]/
    )

    if (diamondImportMatch) {
      // Add DiamondCore to existing import
      const existingImports = diamondImportMatch[1]
      const newImports = existingImports.includes('DiamondCore')
        ? existingImports
        : `${existingImports.trim()}, DiamondCore`

      return source.replace(
        diamondImportMatch[0],
        `import { ${newImports} } from '@diamondjs/runtime'`
      )
    }

    // Add new import at the top (after any existing imports)
    const lastImportMatch = source.match(/^(import\s+[\s\S]*?from\s+['"][^'"]+['"];?\n)/m)
    if (lastImportMatch) {
      const insertPos = lastImportMatch.index! + lastImportMatch[0].length
      return (
        source.slice(0, insertPos) +
        "import { DiamondCore } from '@diamondjs/runtime';\n" +
        source.slice(insertPos)
      )
    }

    // No imports - add at the very top
    return "import { DiamondCore } from '@diamondjs/runtime';\n\n" + source
  }
}

/**
 * Compile error with location information
 */
export class CompileError extends Error {
  constructor(
    message: string,
    public location: { line: number; column: number }
  ) {
    super(`${message} at line ${location.line}, column ${location.column}`)
    this.name = 'CompileError'
  }
}
