/**
 * CodeGenerator - Generates JavaScript code from parsed templates
 *
 * Generates an instance createTemplate() method that creates DOM
 * and sets up DiamondCore bindings. Uses 'this' to reference the
 * component instance — no 'vm' parameter.
 */

import type {
  NodeInfo,
  ElementInfo,
  TextInfo,
  BindingInfo,
  CompilerOptions,
  CompileResult,
  ConverterObligation,
  Diagnostic,
  SinkOp,
  SourceLocation,
} from './types'
import { isElementInfo, isTextInfo } from './types'
import { gateSink } from './security'
import { parsePipe, lowerFormat, lowerArgs, type ParsedPipe } from './pipe'

interface SourceMapping {
  generated: { line: number; column: number }
  original: { line: number; column: number }
  source: string
}

/**
 * Identifiers left un-prefixed by prefixExpression (they are not component
 * properties). Loop variables are added per-scope on top of this.
 */
const EXPR_KEYWORDS = new Set([
  'this',
  'true',
  'false',
  'null',
  'undefined',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'void',
  'NaN',
  'Infinity',
])

/**
 * CodeGenerator - Generates JavaScript from parsed template AST
 */
export class CodeGenerator {
  private output: string[] = []
  private indent = 0
  private varCounter = 0
  private currentLine = 1
  private mappings: SourceMapping[] = []
  private diagnostics: Diagnostic[] = []
  private converterObligations: ConverterObligation[] = []
  private pipeHeads = new Set<string>()
  private scopeVars = new Set<string>()
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

    // [Diamond] hint: instance template method
    this.emitLine('// [Diamond] Compiler-generated instance template method')
    this.emitLine('createTemplate() {')
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
    this.emitLine('}')

    const code = this.output.join('\n')
    const result: CompileResult = {
      code,
      diagnostics: this.diagnostics,
      converterObligations: this.converterObligations,
      pipeTransforms: [...this.pipeHeads],
    }

    if (this.options.sourceMap && this.options.filePath) {
      result.map = this.generateSourceMap()
    }

    return result
  }

  /**
   * Generate code for a list of nodes.
   *
   * Structural directives are handled here (where siblings are visible): an `if`
   * collects its consecutive `else-if` siblings into one DiamondCore.if() chain;
   * `repeat` lowers to DiamondCore.repeat(). A plain element/text is generated
   * normally. (generateElement ignores an element's own .structural, so it is
   * reused to build the branch/item body.)
   */
  private generateNodes(nodes: NodeInfo[]): string[] {
    const vars: string[] = []
    let i = 0

    while (i < nodes.length) {
      const node = nodes[i]

      if (isElementInfo(node) && node.structural) {
        const kind = node.structural.type

        if (kind === 'if') {
          // Collect this if + consecutive else-if siblings (skip whitespace text)
          const branches: ElementInfo[] = [node]
          let j = i + 1
          while (j < nodes.length) {
            const n = nodes[j]
            if (isTextInfo(n) && !n.content.trim()) {
              j++
              continue
            }
            if (isElementInfo(n) && n.structural?.type === 'else-if') {
              branches.push(n)
              j++
              continue
            }
            break
          }
          vars.push(this.generateConditional(branches))
          i = j
          continue
        }

        if (kind === 'else-if') {
          this.diagnostics.push({
            severity: 'error',
            code: 'orphan-else-if',
            message: `'else-if' must immediately follow an 'if' or 'else-if' sibling.`,
            location: node.structural.location,
          })
          i++
          continue
        }

        if (kind === 'repeat') {
          vars.push(this.generateRepeat(node))
          i++
          continue
        }
      }

      if (isElementInfo(node)) {
        vars.push(this.generateElement(node))
      } else if (isTextInfo(node)) {
        const textVar = this.generateText(node)
        if (textVar) vars.push(textVar)
      }
      i++
    }

    return vars
  }

  /**
   * Generate a reactive conditional (if / else-if chain) → DiamondCore.if().
   * No sink, no raw, always reactive (DDR §6.2). Each branch is a factory that
   * builds its element body; first truthy condition wins.
   */
  private generateConditional(branches: ElementInfo[]): string {
    const anchor = this.nextVar('ifAnchor')
    const first = branches[0].structural!
    this.emitLine(
      `const ${anchor} = document.createComment('if');`,
      first.location
    )
    this.emitLine(
      `// [Diamond] Conditional: if="${first.expression}"` +
        (branches.length > 1 ? ` (+${branches.length - 1} else-if)` : '')
    )
    this.emitLine(`DiamondCore.if(${anchor}, [`)
    this.indent++
    for (const br of branches) {
      const cond = this.prefixExpression(br.structural!.expression)
      this.emitLine(`{ when: () => ${cond}, make: () => {`)
      this.indent++
      const elVar = this.generateElement(br)
      this.emitLine(`return ${elVar};`)
      this.indent--
      this.emitLine(`} },`)
    }
    this.indent--
    this.emitLine(`]);`)
    return anchor
  }

  /**
   * Generate a reactive keyed list (repeat.for) → DiamondCore.repeat().
   * The loop variable is added to the scope so body expressions reference the
   * closure parameter (not `this`). DDR §6.3.
   */
  private generateRepeat(element: ElementInfo): string {
    const s = element.structural!
    const anchor = this.nextVar('repeatAnchor')
    this.emitLine(
      `const ${anchor} = document.createComment('repeat');`,
      s.location
    )
    this.emitLine(
      `// [Diamond] Repeat: repeat.for="${s.itemName} of ${s.itemsExpression}"`
    )
    const itemsExpr = this.prefixExpression(s.itemsExpression!)
    this.emitLine(`DiamondCore.repeat(${anchor}, () => ${itemsExpr}, (${s.itemName}) => {`)
    this.indent++
    const itemName = s.itemName!
    const hadVar = this.scopeVars.has(itemName)
    this.scopeVars.add(itemName)
    const elVar = this.generateElement(element)
    this.emitLine(`return ${elVar};`)
    if (!hadVar) this.scopeVars.delete(itemName)
    this.indent--
    this.emitLine(`});`)
    return anchor
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
      // Echo the source expression in the hint (parity with every other hint type)
      const interpSrc = text.content.replace(/\s+/g, ' ').trim()
      this.emitLine(`// [Diamond] Text interpolation: ${interpSrc}`)
      this.emitLine(
        `DiamondCore.bind(${varName}, 'textContent', () => ${templateExpr});`,
        text.interpolations[0]?.location
      )
    }

    return varName
  }

  /**
   * Generate code for a property binding.
   *
   * This is the single sink-write choke point: every dynamic property write
   * passes through the security gate here (DDR §3.3 row 1), which closes the
   * v1.5.1 one-time bypass (a naked `el.prop = value` that never entered bind()).
   */
  private generateBinding(varName: string, binding: BindingInfo): void {
    // Gate OUTBOUND sink writes (model → DOM). from-view is inbound (DOM → model):
    // it never writes the sink, so it is not outbound-gated — its risk is the
    // runtime inbound smell check (DDR §3.3 row 3). Its `raw` flag is preserved
    // as the inbound-escape hatch.
    if (binding.type !== 'from-view') {
      const diag = gateSink(
        binding.property,
        binding.type as SinkOp,
        binding.raw,
        binding.expression,
        binding.location
      )
      if (diag) this.diagnostics.push(diag)
    }

    // Parse the pipe once (segments is empty when there is no `|`).
    const parsed = parsePipe(binding.expression)
    for (const seg of parsed.segments) {
      if (!seg.malformed) this.pipeHeads.add(seg.head)
      if (seg.malformed) {
        this.diagnostics.push({
          severity: 'error',
          code: 'malformed-pipe',
          message: `Malformed pipe segment in "${binding.expression}".`,
          location: binding.location,
        })
      }
    }
    const dataExpr = this.prefixExpression(parsed.data)
    const rawTag = binding.raw ? 'RAW ' : ''

    // Raw OUTBOUND writes are unescaped and developer-owned. Name the security
    // contract explicitly so a cold-reading model cannot mistake an audited
    // opt-in for an accidental dangerous-sink write. (from-view raw is inbound —
    // a different contract — so it is excluded here.)
    if (binding.raw && binding.type !== 'from-view') {
      this.emitLine(
        `// [Diamond] raw sink — explicit opt-in (developer-owned, unescaped); audited in stink-baseline.json, no runtime XSS protection here`
      )
    }

    switch (binding.type) {
      case 'set': {
        // Static one-shot assignment — direct property write (v2.0: was .one-time)
        const outbound = this.lowerOutboundParsed(parsed)
        this.emitLine(
          `// [Diamond] ${rawTag}Set (static one-shot): ${binding.property} = ${binding.expression}`
        )
        this.emitLine(`${varName}.${binding.property} = ${outbound};`, binding.location)
        break
      }

      case 'to-view': {
        const outbound = this.lowerOutboundParsed(parsed)
        this.emitLine(
          `// [Diamond] ${rawTag}One-way binding: ${binding.property} ← ${binding.expression}`
        )
        this.emitLine(
          `DiamondCore.bind(${varName}, '${binding.property}', () => ${outbound});`,
          binding.location
        )
        break
      }

      case 'from-view': {
        // One-way DOM → model. NO getter (undefined) so the model can NEVER push
        // back into the sink — a from-view flow must not silently behave two-way.
        const setter = this.buildFromViewSetter(parsed, dataExpr, binding.location)
        const evt = this.updateOnArg(binding)
        this.emitLine(
          `// [Diamond] ${rawTag}From-view binding (one-way DOM → ${binding.expression}): ${binding.property}` +
            (binding.updateOn ? ` [update-on: ${binding.updateOn}]` : '')
        )
        this.emitLine(
          `DiamondCore.bind(${varName}, '${binding.property}', undefined, ${setter}${evt});`,
          binding.location
        )
        break
      }

      case 'bind':
      case 'two-way':
      default: {
        const { getter, setter } = this.buildTwoWay(
          parsed,
          dataExpr,
          binding.location
        )
        const evt = this.updateOnArg(binding)
        this.emitLine(
          `// [Diamond] ${rawTag}Two-way binding: ${binding.property} ↔ ${binding.expression}` +
            (binding.updateOn ? ` [update-on: ${binding.updateOn}]` : '')
        )
        this.emitLine(
          `DiamondCore.bind(${varName}, '${binding.property}', ${getter}, ${setter}${evt});`,
          binding.location
        )
        break
      }
    }
  }

  /**
   * The trailing `, '<event>'` arg for DiamondCore.bind when value.update-on is
   * set (§4.3) — overrides the default input/change sampling event. Empty otherwise.
   */
  private updateOnArg(binding: BindingInfo): string {
    return binding.updateOn ? `, '${this.escapeString(binding.updateOn)}'` : ''
  }

  /**
   * Lower the outbound (display) leg of a parsed pipe to a FORMAT chain, or the
   * plain prefixed data when there is no pipe. (DDR §5.3 — left-to-right.)
   */
  private lowerOutboundParsed(parsed: ParsedPipe): string {
    if (parsed.segments.length === 0) return this.prefixExpression(parsed.data)
    return lowerFormat(parsed, (e) => this.prefixExpression(e))
  }

  /** Same as lowerOutboundParsed but from a raw expression string (interpolation). */
  private lowerOutbound(expression: string): string {
    const parsed = parsePipe(expression)
    for (const seg of parsed.segments) {
      if (!seg.malformed) this.pipeHeads.add(seg.head)
      if (seg.malformed) {
        this.diagnostics.push({
          severity: 'error',
          code: 'malformed-pipe',
          message: `Malformed pipe segment in "${expression}".`,
          location: null,
        })
      }
    }
    return this.lowerOutboundParsed(parsed)
  }

  /**
   * Build the from-view inbound setter. At most one transform:
   *   - converter (PascalCase) → validated parse → ParseResult (write only if valid)
   *   - plain function (camelCase) → direct call (unvalidated)
   *   - none → passthrough
   * "Keep raw on invalid" is free: from-view has no getter, so not writing the
   * model leaves the user's typed text in the DOM (DDR §5.7).
   */
  private buildFromViewSetter(
    parsed: ParsedPipe,
    dataExpr: string,
    location: SourceLocation | null
  ): string {
    const segs = parsed.segments
    if (segs.length === 0) return `(v) => ${dataExpr} = v`

    if (segs.length > 1) {
      this.diagnostics.push({
        severity: 'error',
        code: 'pipe-fromview-multi',
        message: `A from-view binding allows at most one transform on the inbound leg (got ${segs.length}).`,
        location,
      })
      return `(v) => ${dataExpr} = v`
    }

    const seg = segs[0]
    const tail = lowerArgs(seg, (e) => this.prefixExpression(e))
    if (seg.isConverter) {
      this.converterObligations.push({
        name: seg.head,
        needs: 'parse',
        direction: 'from-view',
        location,
      })
      return `(v) => { const r = ${seg.head}.parse(v${tail}); if (r.valid) ${dataExpr} = r.value; }`
    }
    // plain function on inbound: direct call (no validation)
    return `(v) => ${dataExpr} = ${seg.head}(v${tail})`
  }

  /**
   * Build the two-way getter (FORMAT, model→DOM) + setter (PARSE, DOM→model).
   * A two-way leg permits at most ONE converter class with parse; a plain
   * function (non-invertible) or a multi-segment pipe is a compile error — this
   * closes the §5.1 corruption hole the capitalization convention would open.
   */
  private buildTwoWay(
    parsed: ParsedPipe,
    dataExpr: string,
    location: SourceLocation | null
  ): { getter: string; setter: string } {
    const segs = parsed.segments
    const passthrough = {
      getter: `() => ${dataExpr}`,
      setter: `(v) => ${dataExpr} = v`,
    }
    if (segs.length === 0) return passthrough

    if (segs.length > 1) {
      this.diagnostics.push({
        severity: 'error',
        code: 'pipe-two-way-multi',
        message: `A two-way binding allows at most one converter (got ${segs.length}); split into to-view + from-view, or use a view-model getter.`,
        location,
      })
      return passthrough
    }

    const seg = segs[0]
    if (!seg.isConverter) {
      this.diagnostics.push({
        severity: 'error',
        code: 'pipe-two-way-noninvertible',
        message: `A two-way binding requires a converter class with a parse method; '${seg.head}' is a plain (non-invertible) function. Use to-view for display, from-view for input, or a converter class.`,
        location,
      })
      return passthrough
    }

    const tail = lowerArgs(seg, (e) => this.prefixExpression(e))
    this.converterObligations.push({
      name: seg.head,
      needs: 'parse',
      direction: 'two-way',
      location,
    })
    return {
      getter: `() => ${seg.head}.format(${dataExpr}${tail})`,
      setter: `(v) => { const r = ${seg.head}.parse(v${tail}); if (r.valid) ${dataExpr} = r.value; }`,
    }
  }

  /**
   * Generate code for an event handler
   */
  private generateEvent(varName: string, event: BindingInfo): void {
    const handler = this.buildEventHandler(event.expression)

    switch (event.type) {
      case 'capture':
        // [Diamond] hint — capture-phase listener (DDR §6.6)
        this.emitLine(
          `// [Diamond] Capture event: ${event.property} → this.${event.expression}`
        )
        this.emitLine(
          `DiamondCore.on(${varName}, '${event.property}', ${handler}, true);`,
          event.location
        )
        break

      case 'calls':
      default:
        // [Diamond] hint — bubble-phase listener (DDR §6.5: .calls)
        this.emitLine(
          `// [Diamond] Event binding: ${event.property} → this.${event.expression}`
        )
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
    // Replace ${expr} with the lowered (pipe-aware) outbound expression.
    const escaped = content
      .replace(/`/g, '\\`')
      .replace(/\$\{([^}]+)\}/g, (_match, expr) => {
        return '${' + this.lowerOutbound(expr.trim()) + '}'
      })
    return '`' + escaped + '`'
  }

  /**
   * Prefix identifier roots in an expression with `this.`.
   *
   * Token-aware so it works for conditions with operators (`!a && !b`,
   * `nodes.length > 0`, `status === 'loading'`), not just bare paths. Leaves
   * untouched: string/template literals, numeric literals, property-access
   * tails (the part after a `.`), keywords, and in-scope loop variables.
   */
  private prefixExpression(expr: string): string {
    return expr.replace(
      // group 1: string/template literal | group 2: optional leading dot | group 3: identifier
      /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\.?)([A-Za-z_$][\w$]*)/g,
      (match, str: string, dot: string, id: string) => {
        if (str) return str // string/template literal — leave verbatim
        if (dot) return match // property-access tail (.name) — leave
        if (EXPR_KEYWORDS.has(id)) return match
        if (this.scopeVars.has(id)) return match // loop variable in scope
        return `this.${id}`
      }
    )
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
    this.diagnostics = []
    this.converterObligations = []
    this.pipeHeads.clear()
    this.scopeVars.clear()
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
