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
  SwitchInfo,
} from './types'
import { isElementInfo, isTextInfo } from './types'
import { gateSink } from './security'
import {
  parsePipe,
  lowerFormat,
  lowerArgs,
  scanInterpolations,
  type ParsedPipe,
} from './pipe'
import { serializeMappings } from './sourcemap'

interface SourceMapping {
  generated: { line: number; column: number }
  original: { line: number; column: number }
  source: string
}

/**
 * A setter whose body is a statement block (converter parse + validity gate).
 * Kept structured so emitBindCall can place each statement on its own line.
 */
interface BlockSetter {
  body: string[]
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
        i = this.generateStructural(node, nodes, i, vars)
        continue
      }

      if (isElementInfo(node) && node.switchInfo) {
        const switchVar = this.generateSwitch(node.switchInfo)
        if (switchVar) vars.push(switchVar)
        i++
        continue
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
   * Dispatch one structural construct at nodes[i]; returns the next index.
   */
  private generateStructural(
    node: ElementInfo,
    nodes: NodeInfo[],
    i: number,
    vars: string[]
  ): number {
    const kind = node.structural!.type

    if (kind === 'if') {
      const { branches, next } = this.collectIfChain(nodes, i)
      vars.push(this.generateConditional(branches))
      return next
    }

    if (kind === 'else-if') {
      this.diagnostics.push({
        severity: 'error',
        code: 'orphan-else-if',
        message: `'else-if' must immediately follow an 'if' or 'else-if' sibling.`,
        location: node.structural!.location,
      })
      return i + 1
    }

    // repeat
    vars.push(this.generateRepeat(node))
    return i + 1
  }

  /**
   * Collect nodes[i] (an `if`) plus its consecutive `else-if` siblings into one
   * branch chain, skipping whitespace-only text nodes between them.
   */
  private collectIfChain(
    nodes: NodeInfo[],
    i: number
  ): { branches: ElementInfo[]; next: number } {
    const branches: ElementInfo[] = [nodes[i] as ElementInfo]
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

    return { branches, next: j }
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
   * Generate a <switch>/<case>/<default> construct (v2.1, Amendment A1 §7.3).
   *
   * Lowering is Option B (thin DiamondCore.switch runtime) with an Option A
   * fast path: when on= is a pure literal and every case is equality-kind, the
   * winner is decidable at compile time and only its DOM code is emitted (no
   * anchor, no runtime call). A statically-dead switch (no winner, no default)
   * emits a DOM comment carrying the dead source + a switch-static-dead
   * warning ("unused code") — per the ratified Amendment A2 decision.
   *
   * Returns the var to append (anchor / static body / dead-switch comment),
   * or null when a static default-less switch resolves to nothing... which
   * cannot happen (dead switches emit the comment node), kept for type safety.
   */
  private generateSwitch(info: SwitchInfo): string | null {
    const staticVar = this.tryStaticSwitch(info)
    if (staticVar !== null) return staticVar

    const anchor = this.nextVar('switchAnchor')
    this.emitLine(
      `const ${anchor} = document.createComment('switch');`,
      info.location
    )
    this.emitLine(
      `// [Diamond] Switch: on="${info.onExpression}" (${info.cases.length} case${
        info.cases.length === 1 ? '' : 's'
      }${info.defaultChildren ? ' + default' : ''})`
    )
    const onGetter = `() => ${this.prefixExpression(info.onExpression)}`
    this.emitLine(`DiamondCore.switch(${anchor}, ${onGetter}, [`)
    this.indent++
    for (const c of info.cases) {
      const cond =
        c.kind === 'equality'
          ? `v === ${this.literalJs(c.literal)}`
          : this.prefixExpression(c.match)
      this.emitLine(
        `// [Diamond] case if="${c.match}" → ${
          c.kind === 'equality' ? cond : `${cond} (boolean expression)`
        }`
      )
      this.emitLine(`{ match: (v) => ${cond}, make: () => {`)
      this.indent++
      const bodyVars = this.generateNodes(c.children)
      const root = this.combineRoots(bodyVars, 'caseRoot')
      this.emitLine(`return ${root};`)
      this.indent--
      this.emitLine(`} },`)
    }
    this.indent--
    if (info.defaultChildren) {
      this.emitLine(`], () => {`)
      this.indent++
      this.emitLine(`// [Diamond] default — renders when no case matches`)
      const defVars = this.generateNodes(info.defaultChildren)
      const defRoot = this.combineRoots(defVars, 'defaultRoot')
      this.emitLine(`return ${defRoot};`)
      this.indent--
      this.emitLine(`});`)
    } else {
      this.emitLine(`]);`)
    }
    return anchor
  }

  /**
   * Option A static fast path. Applicable iff on= is a pure literal AND every
   * case is equality-kind (an expression case could preempt at runtime, making
   * the winner undecidable at compile time). Returns the emitted var, or null
   * when the switch must lower to the runtime construct.
   */
  private tryStaticSwitch(info: SwitchInfo): string | null {
    const onLiteral = this.parseStaticLiteral(info.onExpression)
    if (onLiteral === undefined) return null
    if (info.cases.some((c) => c.kind !== 'equality')) return null

    const winner = info.cases.find((c) => c.literal === onLiteral.value)
    if (winner) {
      this.emitLine(
        `// [Diamond] Switch on=${JSON.stringify(info.onExpression)} resolved at compile time → case if="${winner.match}" (zero runtime cost)`
      )
      return this.combineRoots(this.generateNodes(winner.children), 'caseRoot')
    }
    if (info.defaultChildren) {
      this.emitLine(
        `// [Diamond] Switch on=${JSON.stringify(info.onExpression)} resolved at compile time → default (no case matched)`
      )
      return this.combineRoots(this.generateNodes(info.defaultChildren), 'defaultRoot')
    }

    // Statically dead: no case matches and there is no default. Ratified
    // behavior (Amendment A2): warn as unused code + mount an inspectable DOM
    // comment carrying the dead source — never silently drop, never hard-fail.
    this.diagnostics.push({
      severity: 'warn',
      code: 'switch-static-dead',
      message:
        `Dead <switch>: on=${JSON.stringify(info.onExpression)} matches no case ` +
        `(${info.cases.map((c) => `'${c.match}'`).join(', ')}) and there is no <default> — unused code.`,
      location: info.location,
    })
    const deadVar = this.nextVar('deadSwitch')
    const summary = `[Diamond] dead switch: on=${info.onExpression} | cases: ${info.cases
      .map((c) => c.match)
      .join(', ')} — matched none, no default`
    // DOM comments cannot contain '--'
    const commentSafe = this.escapeString(summary.replace(/--/g, '—'))
    this.emitLine(
      `// [Diamond] DEAD switch (switch-static-dead): unused code, emitted as an inspectable comment node`
    )
    this.emitLine(
      `const ${deadVar} = document.createComment(' ${commentSafe} ');`,
      info.location
    )
    return deadVar
  }

  /**
   * Parse a pure-literal expression (quoted string / number / true / false /
   * null). Returns { value } or undefined when the expression is not static
   * (a bare identifier is reactive component state, never static).
   */
  private parseStaticLiteral(
    expr: string
  ): { value: string | number | boolean | null } | undefined {
    const t = expr.trim()
    if (/^'[^']*'$/.test(t) || /^"[^"]*"$/.test(t)) {
      return { value: t.slice(1, -1) }
    }
    if (/^-?\d+(\.\d+)?$/.test(t)) return { value: Number(t) }
    if (t === 'true') return { value: true }
    if (t === 'false') return { value: false }
    if (t === 'null') return { value: null }
    return undefined
  }

  /** Emit a JS literal for an equality-case value. */
  private literalJs(literal: string | number | boolean | null | undefined): string {
    return typeof literal === 'string' ? `'${this.escapeString(literal)}'` : String(literal)
  }

  /**
   * Combine N generated root vars into one node var: zero → empty comment,
   * one → itself, many → DocumentFragment. This is where the erased-wrapper
   * semantics of <switch>/<case>/<default> live: a case body with multiple
   * roots mounts as a fragment, no container element ships.
   */
  private combineRoots(vars: string[], hint: string): string {
    if (vars.length === 1) return vars[0]
    const v = this.nextVar(hint)
    if (vars.length === 0) {
      this.emitLine(`const ${v} = document.createComment('empty');`)
      return v
    }
    this.emitLine(`const ${v} = document.createDocumentFragment();`)
    for (const child of vars) this.emitLine(`${v}.appendChild(${child});`)
    return v
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
    const varName = this.nextVar(`el_${element.tagName}`)

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
    // Attribute spread short-circuits BEFORE the gate: the compiler cannot see
    // the object's keys, so per-key gating defers to DiamondCore.spread at
    // runtime (against the same allowlist). gateSink would mis-classify it.
    if (binding.type === 'spread') {
      this.generateSpread(varName, binding)
      return
    }

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

    // Dashed names (data-*/aria-*) are attributes, not JS properties: only the
    // outbound ops apply (set/to-view). There is no DOM property to sample for
    // an inbound leg, so bind/two-way/from-view are authoring errors.
    if (
      binding.property.includes('-') &&
      (binding.type === 'bind' ||
        binding.type === 'two-way' ||
        binding.type === 'from-view')
    ) {
      this.diagnostics.push({
        severity: 'error',
        code: 'attr-binding-outbound-only',
        message:
          `'${binding.property}' is an attribute (dashed name): use '.set' or '.to-view'. ` +
          `There is no DOM property to sample for '${binding.type}'.`,
        location: binding.location,
      })
      return
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

    // error-into needs a ParseResult to read — i.e. at least one converter on
    // the binding (only codegen knows segment kinds; parser can't check this).
    if (binding.errorInto && !parsed.segments.some((s) => s.isConverter)) {
      this.diagnostics.push({
        severity: 'error',
        code: 'error-into-no-converter',
        message: `'${binding.property}.error-into' needs a converter on the binding (a ParseResult to read); "${binding.expression}" has none.`,
        location: binding.location,
      })
      binding.errorInto = undefined
    }

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
        if (binding.property.includes('-')) {
          // Attribute (data-*/aria-*): no JS property exists — write the attribute
          this.emitLine(
            `${varName}.setAttribute('${binding.property}', ${outbound});`,
            binding.location
          )
        } else {
          this.emitLine(`${varName}.${binding.property} = ${outbound};`, binding.location)
        }
        break
      }

      case 'to-view': {
        const outbound = this.lowerOutboundParsed(parsed)
        this.emitLine(
          `// [Diamond] ${rawTag}One-way binding: ${binding.property} ← ${binding.expression}`
        )
        this.emitBindCall(
          varName,
          binding.property,
          `() => ${outbound}`,
          null,
          '',
          binding.location
        )
        break
      }

      case 'from-view': {
        // One-way DOM → model. NO getter (undefined) so the model can NEVER push
        // back into the sink — a from-view flow must not silently behave two-way.
        const setter = this.buildFromViewSetter(
          parsed,
          dataExpr,
          binding.location,
          binding.errorInto
        )
        const evt = this.updateOnArg(binding)
        this.emitLine(
          `// [Diamond] ${rawTag}From-view binding (one-way DOM → ${binding.expression}): ${binding.property}` +
            (binding.updateOn ? ` [update-on: ${binding.updateOn}]` : '')
        )
        this.emitBindCall(
          varName,
          binding.property,
          'undefined',
          setter,
          evt,
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
          binding.location,
          binding.errorInto
        )
        const evt = this.updateOnArg(binding)
        this.emitLine(
          `// [Diamond] ${rawTag}Two-way binding: ${binding.property} ↔ ${binding.expression}` +
            (binding.updateOn ? ` [update-on: ${binding.updateOn}]` : '')
        )
        this.emitBindCall(
          varName,
          binding.property,
          getter,
          setter,
          evt,
          binding.location
        )
        break
      }
    }
  }

  /**
   * Emit a DiamondCore.bind(...) call.
   *
   * Multi-line whenever the setter has a block body — the security-load-bearing
   * `if (r.valid)` gate must sit on its own line, visually prominent, not buried
   * at the end of a ~140-char line — or when the composed single line would
   * exceed 100 chars. Concise passthroughs stay single-line.
   */
  private emitBindCall(
    varName: string,
    property: string,
    getter: string,
    setter: string | BlockSetter | null,
    evt: string, // '' or `, '<event>'`
    location?: SourceLocation | null
  ): void {
    const isBlock = typeof setter === 'object' && setter !== null

    if (!isBlock) {
      const args = [`'${property}'`, getter]
      if (setter) args.push(setter as string)
      const line = `DiamondCore.bind(${varName}, ${args.join(', ')}${evt});`
      if (this.indent * 2 + line.length <= 100) {
        this.emitLine(line, location)
        return
      }
    }

    this.emitLine(`DiamondCore.bind(${varName}, '${property}',`, location)
    this.indent++
    if (setter === null) {
      this.emitLine(`${getter}${evt ? ',' : ''}`)
    } else if (typeof setter === 'string') {
      this.emitLine(`${getter},`)
      this.emitLine(`${setter}${evt ? ',' : ''}`)
    } else {
      this.emitLine(`${getter},`)
      this.emitLine(`(v) => {`)
      this.indent++
      for (const stmt of setter.body) this.emitLine(stmt)
      this.indent--
      this.emitLine(`}${evt ? ',' : ''}`)
    }
    if (evt) this.emitLine(evt.slice(2)) // the event name, own line (strip ', ')
    this.indent--
    this.emitLine(`);`)
  }

  /**
   * Attribute spread (v2.1, DDR §7.1). The compiler cannot see the object's
   * keys, so resolution defers to DiamondCore.spread — which gates each key
   * against the SAME allowlist at runtime (gate FIRST, branch SECOND; unknown
   * keys fail closed). The raw variant bypasses the runtime gate entirely:
   * developer-owned, audited via a heavy stink:declared.
   */
  private generateSpread(varName: string, binding: BindingInfo): void {
    const getter = `() => ${this.prefixExpression(binding.expression)}`

    if (binding.raw) {
      this.diagnostics.push({
        severity: 'declared',
        code: 'stink:declared',
        message: `raw ...attrs via spread${binding.expression ? `: ${binding.expression}` : ''}`,
        location: binding.location,
        property: '...attrs',
        op: 'spread',
        raw: true,
        expression: binding.expression,
      })
      this.emitLine(
        `// [Diamond] raw sink — explicit opt-in (developer-owned, unescaped); audited in stink-baseline.json, no runtime XSS protection here`
      )
      this.emitLine(
        `// [Diamond] RAW attribute spread: ...attrs.rawBind="${binding.expression}" — allowlist bypassed; developer owns every key (incl. innerHTML/on*)`
      )
      this.emitLine(`DiamondCore.spread(${varName}, ${getter}, true);`, binding.location)
      return
    }

    this.emitLine(
      `// [Diamond] Attribute spread: ...attrs.bind="${binding.expression}" — runtime-gated: gate FIRST (non-allowlisted keys skipped), branch SECOND`
    )
    this.emitLine(`DiamondCore.spread(${varName}, ${getter});`, binding.location)
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
    location: SourceLocation | null,
    errorInto?: string
  ): string | BlockSetter {
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
      const body = [`const r = ${seg.head}.parse(v${tail});`]
      if (errorInto) {
        body.push(`${this.prefixExpression(errorInto)} = r.valid ? null : r.error;`)
      }
      body.push(`if (r.valid) ${dataExpr} = r.value;`)
      return { body }
    }
    // plain function on inbound: direct call (no validation)
    return `(v) => ${dataExpr} = ${seg.head}(v${tail})`
  }

  /**
   * Build the two-way getter (FORMAT, model→DOM) + setter (PARSE, DOM→model).
   *
   * v2.1 (working_notes §3.5, recorded in Amendment A2): a two-way leg may be a
   * CHAIN — legal iff EVERY segment is a converter class with parse. The getter
   * composes format left-to-right; the setter composes parse right-to-left,
   * checking each step's ParseResult and failing fast — the model stays
   * untouched (and the user's raw text preserved) unless every step is valid.
   * One plain (camelCase) function anywhere poisons the chain: hard error,
   * closing the §5.1 corruption hole.
   *
   * `errorInto` (when set) receives the FIRST failing step's error, and is
   * cleared to null on full success (§5.7 / error-into grammar).
   */
  private buildTwoWay(
    parsed: ParsedPipe,
    dataExpr: string,
    location: SourceLocation | null,
    errorInto?: string
  ): { getter: string; setter: string | BlockSetter } {
    const segs = parsed.segments
    const passthrough = {
      getter: `() => ${dataExpr}`,
      setter: `(v) => ${dataExpr} = v`,
    }
    if (segs.length === 0) return passthrough

    const bad = segs.find((s) => !s.isConverter)
    if (bad) {
      this.diagnostics.push({
        severity: 'error',
        code: 'pipe-two-way-noninvertible',
        message: `A two-way binding requires every pipe segment to be an invertible converter class with a parse method; '${bad.head}' is a plain (non-invertible) function. Use to-view for display, from-view for input, or converter classes throughout the chain.`,
        location,
      })
      return passthrough
    }

    for (const seg of segs) {
      this.converterObligations.push({
        name: seg.head,
        needs: 'parse',
        direction: 'two-way',
        location,
      })
    }

    const getter = `() => ${lowerFormat(parsed, (e) => this.prefixExpression(e))}`
    const errTarget = errorInto ? this.prefixExpression(errorInto) : null
    const body: string[] = []

    if (segs.length === 1) {
      // Single converter — the common case keeps the canonical `r` shape.
      const tail = lowerArgs(segs[0], (e) => this.prefixExpression(e))
      body.push(`const r = ${segs[0].head}.parse(v${tail});`)
      if (errTarget) body.push(`${errTarget} = r.valid ? null : r.error;`)
      body.push(`if (r.valid) ${dataExpr} = r.value;`)
      return { getter, setter: { body } }
    }

    // Chain: parse right-to-left (rN … r0 — numbered by segment index so the
    // reverse order is visually self-evident), fail-fast at each step.
    let prev = 'v'
    for (let i = segs.length - 1; i >= 1; i--) {
      const tail = lowerArgs(segs[i], (e) => this.prefixExpression(e))
      body.push(`const r${i} = ${segs[i].head}.parse(${prev}${tail});`)
      body.push(
        errTarget
          ? `if (!r${i}.valid) { ${errTarget} = r${i}.error; return; }`
          : `if (!r${i}.valid) return;`
      )
      prev = `r${i}.value`
    }
    const tail0 = lowerArgs(segs[0], (e) => this.prefixExpression(e))
    body.push(`const r0 = ${segs[0].head}.parse(${prev}${tail0});`)
    if (errTarget) body.push(`${errTarget} = r0.valid ? null : r0.error;`)
    body.push(`if (r0.valid) ${dataExpr} = r0.value;`)
    return { getter, setter: { body } }
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
    // Rebuild via the brace-depth scanner (same spans the parser saw): static
    // chunks are escaped, each ${expr} becomes the lowered (pipe-aware)
    // outbound expression. An unterminated span (parser already errored) is
    // emitted as escaped literal text so codegen never crashes on it.
    const escapeStatic = (s: string) =>
      s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

    let result = ''
    let last = 0
    for (const span of scanInterpolations(content)) {
      result += escapeStatic(content.slice(last, span.start))
      if (span.unterminated) {
        result += escapeStatic(content.slice(span.start, span.end))
      } else {
        result += '${' + this.lowerOutbound(span.expression.trim()) + '}'
      }
      last = span.end
    }
    result += escapeStatic(content.slice(last))
    return '`' + result + '`'
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
   * Generate next variable name. The `_` separator keeps the tag segment and
   * the counter visually distinct (`el_h2_1`, not `h21` — which reads to an
   * HTML-trained model as a 21-level heading tag).
   */
  private nextVar(hint: string): string {
    return `${hint}_${this.varCounter++}`
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
   * Generate source map JSON (real VLQ mappings as of v2.1 — the Phase-0
   * `mappings: ''` stub is closed; see sourcemap.ts for the offset caveat).
   */
  private generateSourceMap(): string {
    const map = {
      version: 3,
      file: this.options.filePath?.replace('.html', '.js'),
      sources: [this.options.filePath],
      names: [],
      mappings: serializeMappings(this.mappings),
    }

    return JSON.stringify(map)
  }
}
