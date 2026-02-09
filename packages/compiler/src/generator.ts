/**
 * CodeGenerator - Generates JavaScript code from parsed templates
 *
 * Generates a static createTemplate() method that creates DOM
 * and sets up DiamondCore bindings.
 */

import type {
  NodeInfo,
  ElementInfo,
  TextInfo,
  BindingInfo,
  CompilerOptions,
  CompileResult,
  SourceLocation,
} from './types'
import { isElementInfo, isTextInfo } from './types'

interface SourceMapping {
  generated: { line: number; column: number }
  original: { line: number; column: number }
  source: string
}

/**
 * CodeGenerator - Generates JavaScript from parsed template AST
 */
export class CodeGenerator {
  private output: string[] = []
  private indent = 0
  private varCounter = 0
  private currentLine = 1
  private mappings: SourceMapping[] = []
  private options: CompilerOptions

  constructor(options: CompilerOptions = {}) {
    this.options = {
      sourceMap: true,
      ...options,
    }
  }

  /**
   * Generate code for a parsed template
   */
  generate(nodes: NodeInfo[]): CompileResult {
    this.reset()

    // Generate the createTemplate method
    this.emitLine('static createTemplate() {')
    this.indent++
    this.emitLine('return (vm) => {')
    this.indent++

    // Generate code for root nodes
    const rootVars = this.generateNodes(nodes)

    // Create container if multiple root nodes
    let rootVar: string
    if (rootVars.length === 0) {
      this.emitLine("const root = document.createComment('empty');")
      rootVar = 'root'
    } else if (rootVars.length === 1) {
      rootVar = rootVars[0]
    } else {
      this.emitLine('const root = document.createDocumentFragment();')
      for (const v of rootVars) {
        this.emitLine(`root.appendChild(${v});`)
      }
      rootVar = 'root'
    }

    // Return the root element
    this.emitLine(`return ${rootVar};`)

    this.indent--
    this.emitLine('};')
    this.indent--
    this.emitLine('}')

    const code = this.output.join('\n')
    const result: CompileResult = { code }

    if (this.options.sourceMap && this.options.filePath) {
      result.map = this.generateSourceMap()
    }

    return result
  }

  /**
   * Generate code for a list of nodes
   */
  private generateNodes(nodes: NodeInfo[]): string[] {
    const vars: string[] = []

    for (const node of nodes) {
      if (isElementInfo(node)) {
        vars.push(this.generateElement(node))
      } else if (isTextInfo(node)) {
        const textVar = this.generateText(node)
        if (textVar) {
          vars.push(textVar)
        }
      }
    }

    return vars
  }

  /**
   * Generate code for an element
   */
  private generateElement(element: ElementInfo): string {
    const varName = this.nextVar(element.tagName)

    // Create element
    this.emitLine(
      `const ${varName} = document.createElement('${element.tagName}');`,
      element.location
    )

    // Set static attributes
    for (const [name, value] of element.staticAttrs) {
      if (name === 'class') {
        this.emitLine(`${varName}.className = '${this.escapeString(value)}';`)
      } else {
        this.emitLine(
          `${varName}.setAttribute('${name}', '${this.escapeString(value)}');`
        )
      }
    }

    // Generate bindings
    for (const binding of element.bindings) {
      this.generateBinding(varName, binding)
    }

    // Generate event handlers
    for (const event of element.events) {
      this.generateEvent(varName, event)
    }

    // Generate children
    const childVars = this.generateNodes(element.children)
    for (const childVar of childVars) {
      this.emitLine(`${varName}.appendChild(${childVar});`)
    }

    return varName
  }

  /**
   * Generate code for a text node
   */
  private generateText(text: TextInfo): string | null {
    const varName = this.nextVar('text')

    if (text.interpolations.length === 0) {
      // Static text
      const content = text.content.trim()
      if (!content) return null

      this.emitLine(
        `const ${varName} = document.createTextNode('${this.escapeString(content)}');`,
        text.location
      )
    } else {
      // Text with interpolations - create element and bind
      this.emitLine(
        `const ${varName} = document.createTextNode('');`,
        text.location
      )

      // Build template string for interpolation
      const templateExpr = this.buildInterpolationExpr(text.content)
      this.emitLine(
        `DiamondCore.bind(${varName}, 'textContent', () => ${templateExpr});`,
        text.interpolations[0]?.location
      )
    }

    return varName
  }

  /**
   * Generate code for a property binding
   */
  private generateBinding(varName: string, binding: BindingInfo): void {
    const expr = this.prefixExpression(binding.expression)

    switch (binding.type) {
      case 'one-time':
        // One-time: just set the value directly
        this.emitLine(
          `${varName}.${binding.property} = ${expr};`,
          binding.location
        )
        break

      case 'to-view':
        // One-way to view
        this.emitLine(
          `DiamondCore.bind(${varName}, '${binding.property}', () => ${expr});`,
          binding.location
        )
        break

      case 'from-view':
        // One-way from view (input to state)
        this.emitLine(
          `DiamondCore.bind(${varName}, '${binding.property}', () => ${expr}, (v) => ${expr} = v);`,
          binding.location
        )
        break

      case 'bind':
      case 'two-way':
      default:
        // Two-way binding
        this.emitLine(
          `DiamondCore.bind(${varName}, '${binding.property}', () => ${expr}, (v) => ${expr} = v);`,
          binding.location
        )
        break
    }
  }

  /**
   * Generate code for an event handler
   */
  private generateEvent(varName: string, event: BindingInfo): void {
    const handler = this.buildEventHandler(event.expression)

    switch (event.type) {
      case 'delegate':
        // Event delegation (not fully implemented for Phase 0)
        this.emitLine(
          `DiamondCore.on(${varName}, '${event.property}', ${handler});`,
          event.location
        )
        break

      case 'capture':
        this.emitLine(
          `DiamondCore.on(${varName}, '${event.property}', ${handler}, true);`,
          event.location
        )
        break

      case 'trigger':
      default:
        this.emitLine(
          `DiamondCore.on(${varName}, '${event.property}', ${handler});`,
          event.location
        )
        break
    }
  }

  /**
   * Build event handler expression
   */
  private buildEventHandler(expression: string): string {
    // Handle method calls like save() or handleClick($event)
    const methodMatch = expression.match(/^(\w+(?:\.\w+)*)\((.*)\)$/)

    if (methodMatch) {
      const [, method, args] = methodMatch
      const prefixedMethod = this.prefixExpression(method)
      const prefixedArgs = args
        .split(',')
        .map((arg) => {
          const trimmed = arg.trim()
          if (trimmed === '$event') return 'e'
          if (!trimmed) return ''
          return this.prefixExpression(trimmed)
        })
        .filter(Boolean)
        .join(', ')

      return `(e) => ${prefixedMethod}(${prefixedArgs})`
    }

    // Simple expression
    return `() => ${this.prefixExpression(expression)}`
  }

  /**
   * Build interpolation template expression
   */
  private buildInterpolationExpr(content: string): string {
    // Replace ${expr} with ${vm.expr}
    const escaped = content
      .replace(/`/g, '\\`')
      .replace(/\$\{([^}]+)\}/g, (_match, expr) => {
        return '${' + this.prefixExpression(expr.trim()) + '}'
      })
    return '`' + escaped + '`'
  }

  /**
   * Prefix an expression with vm.
   */
  private prefixExpression(expr: string): string {
    // Handle property paths like user.name
    // Don't prefix if it's a literal, keyword, or already prefixed
    if (
      /^['"`]/.test(expr) || // String literal
      /^\d/.test(expr) || // Number literal
      /^(true|false|null|undefined)$/.test(expr) || // Keywords
      /^vm\./.test(expr) // Already prefixed
    ) {
      return expr
    }

    return `vm.${expr}`
  }

  /**
   * Emit a line of code
   */
  private emitLine(code: string, location?: SourceLocation | null): void {
    const indentStr = '  '.repeat(this.indent)
    this.output.push(indentStr + code)

    // Track source mapping
    if (location && this.options.sourceMap && this.options.filePath) {
      this.mappings.push({
        generated: { line: this.currentLine, column: this.indent * 2 },
        original: { line: location.line, column: location.column },
        source: this.options.filePath,
      })
    }

    this.currentLine++
  }

  /**
   * Generate next variable name
   */
  private nextVar(hint: string): string {
    return `${hint}${this.varCounter++}`
  }

  /**
   * Escape string for JavaScript
   */
  private escapeString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
  }

  /**
   * Reset generator state
   */
  private reset(): void {
    this.output = []
    this.indent = 0
    this.varCounter = 0
    this.currentLine = 1
    this.mappings = []
  }

  /**
   * Generate source map JSON
   */
  private generateSourceMap(): string {
    // Simplified source map - just names and sources
    // A full implementation would use VLQ encoding
    const map = {
      version: 3,
      file: this.options.filePath?.replace('.html', '.js'),
      sources: [this.options.filePath],
      names: [],
      mappings: '', // Simplified - no actual mappings for Phase 0
    }

    return JSON.stringify(map)
  }
}
