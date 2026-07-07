/**
 * Compiler Types
 *
 * Type definitions for the DiamondJS template compiler
 */

/**
 * Source location in the original template
 */
export interface SourceLocation {
  line: number
  column: number
  offset: number
}

/**
 * Binding types supported by DiamondJS (v2.0 command surface)
 */
export type BindingType =
  | 'set'       // Static one-shot assignment (v2.0: was .one-time)
  | 'bind'      // Two-way binding (default)
  | 'to-view'   // One-way to view
  | 'from-view' // One-way from view
  | 'two-way'   // Explicit two-way
  | 'calls'     // Event handler (v2.0: was .trigger)
  | 'capture'   // Capture phase event
  | 'spread'    // Attribute spread ...attrs.bind / ...attrs.rawBind (v2.1, DDR §7.1)

/**
 * Outbound sink-writing operations — those that write model→DOM and are subject
 * to the compile-time security gate (DDR §3.3 row 1).
 *
 * NOT included: `from-view` (inbound, DOM→model — writes the model, not the sink;
 * its risk is the runtime inbound smell check, §3.3 row 3), event ops
 * (calls/capture — addEventListener, no sink), and structural directives.
 */
export type SinkOp = 'set' | 'bind' | 'to-view' | 'two-way'

/**
 * Severity of a compiler diagnostic.
 * - error:    broken source (retired/unknown command) — transformer throws
 * - warn:     stink:warn — non-allowlisted sink written without raw (hard-gated by tooling)
 * - declared: stink:declared — intentional raw (baselined, reviewed via diff)
 * - info:     advisory (e.g. redundant raw on a safe sink)
 */
export type DiagnosticSeverity = 'error' | 'warn' | 'declared' | 'info'

/**
 * A compiler diagnostic. Carried on CompileResult.diagnostics and consumed by
 * the Parcel transformer (throws on error) and the stink-check tool (gates warn,
 * baselines declared).
 */
export interface Diagnostic {
  severity: DiagnosticSeverity
  code: string // e.g. 'stink:warn', 'stink:declared', 'retired-command'
  message: string
  location: SourceLocation | null
  property?: string
  op?: string
  raw?: boolean
  expression?: string
}

/**
 * Extracted binding information
 */
export interface BindingInfo {
  type: BindingType
  property: string      // Element property (value, textContent, etc.)
  expression: string    // Bound expression (name, user.email, etc.)
  raw: boolean          // v2.0: raw escape hatch (rawSet / rawBind.*) bypasses the allowlist
  location: SourceLocation | null
  updateOn?: string     // v2.0 §4.3: DOM event that samples the model (value.update-on="blur")
}

/**
 * Extracted interpolation information
 */
export interface InterpolationInfo {
  expression: string
  location: SourceLocation | null
}

/**
 * Structural directive on an element (DDR §6.2 if/else-if, §6.3 repeat.for).
 * At most one per element.
 */
export type StructuralType = 'if' | 'else-if' | 'repeat'

export interface StructuralInfo {
  type: StructuralType
  /** Condition (if/else-if) or the raw "item of items" text (repeat) */
  expression: string
  location: SourceLocation | null
  /** repeat only: the loop variable name */
  itemName?: string
  /** repeat only: the iterable expression */
  itemsExpression?: string
}

/**
 * One <case if="..."> arm of a <switch> (v2.1, Amendment A1 backlog).
 *
 * `kind` records the compile-time classification of the `if` value:
 *  - 'equality':   a single bare word or literal — matches when the switch
 *                  value strictly equals `literal` (bare word ⇒ string).
 *  - 'expression': anything with operators/spaces/dots — a boolean expression
 *                  evaluated against component state (cannot see the on-value).
 */
export interface SwitchCaseInfo {
  /** Raw if="..." text */
  match: string
  kind: 'equality' | 'expression'
  /** equality only: the decoded compile-time value */
  literal?: string | number | boolean | null
  children: NodeInfo[]
  location: SourceLocation | null
}

/**
 * A <switch on="..."> construct. The container element is fully erased at
 * compile time — the scope boundary it provides is exactly what bare `else`
 * lacked (A1): <default> needs no positional pairing, its parent IS its scope.
 */
export interface SwitchInfo {
  onExpression: string
  cases: SwitchCaseInfo[]
  /** <default> body, or null when absent */
  defaultChildren: NodeInfo[] | null
  location: SourceLocation | null
}

/**
 * Element information extracted from AST
 */
export interface ElementInfo {
  tagName: string
  bindings: BindingInfo[]
  events: BindingInfo[]
  interpolations: InterpolationInfo[]
  staticAttrs: Map<string, string>
  children: NodeInfo[]
  location: SourceLocation | null
  /** Structural directive (if/else-if/repeat), if present */
  structural?: StructuralInfo
  /** <switch> construct (v2.1) — set only when tagName === 'switch' */
  switchInfo?: SwitchInfo
}

/**
 * Text node information
 */
export interface TextInfo {
  content: string
  interpolations: InterpolationInfo[]
  location: SourceLocation | null
}

/**
 * Union of all node types
 */
export type NodeInfo = ElementInfo | TextInfo

/**
 * Check if a node is an element
 */
export function isElementInfo(node: NodeInfo): node is ElementInfo {
  return 'tagName' in node
}

/**
 * Check if a node is a text node
 */
export function isTextInfo(node: NodeInfo): node is TextInfo {
  return 'content' in node
}

/**
 * Compiler options
 */
export interface CompilerOptions {
  /** Source file path for source maps */
  filePath?: string
  /** Generate source maps */
  sourceMap?: boolean
  /** Component class name */
  className?: string
}

/**
 * A converter the compiler determined MUST expose a `parse` static method,
 * because it appears on an inbound binding leg (from-view / two-way). The
 * compiler knows direction but not the module's exports — a downstream resolver
 * (transformer / CI tool) follows the import to verify (DDR §5.5/§5.6).
 */
export interface ConverterObligation {
  /** Converter class name (PascalCase) */
  name: string
  /** The method that must exist */
  needs: 'parse'
  /** The inbound leg that created the obligation */
  direction: 'from-view' | 'two-way'
  location: SourceLocation | null
}

/**
 * Compilation result
 */
export interface CompileResult {
  /** Generated JavaScript code */
  code: string
  /** Source map (if enabled) */
  map?: string
  /** Diagnostics emitted during parse + codegen (errors, security stink, info) */
  diagnostics?: Diagnostic[]
  /** Converters that must expose `parse` (verified downstream by import resolution) */
  converterObligations?: ConverterObligation[]
  /** Distinct named pipe transform/converter heads referenced by the template.
   *  They must be in lexical scope where createTemplate runs — i.e. the component
   *  context (compileAndInject), not a standalone .diamond.html module. */
  pipeTransforms?: string[]
}
