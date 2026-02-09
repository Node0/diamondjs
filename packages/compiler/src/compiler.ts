/**
 * DiamondCompiler - Main compiler class
 *
 * Compiles DiamondJS HTML templates to JavaScript code
 * that creates DOM and sets up bindings.
 */

import { TemplateParser } from './parser'
import { CodeGenerator } from './generator'
import type { CompilerOptions, CompileResult } from './types'

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
    return generator.generate(nodes)
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
    const { code: templateCode, map } = this.compile(template, options)

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
      templateCode
    )

    // Add DiamondCore import if needed
    const finalSource = this.ensureImport(injectedSource)

    return { code: finalSource, map }
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
