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

/**
 * Sink-writing binding operations — the ops subject to the security gate.
 * Event ops (calls/capture) are NOT sinks; structural directives have no sink.
 */
export type SinkOp = 'set' | 'bind' | 'to-view' | 'from-view' | 'two-way'

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
}

/**
 * Extracted interpolation information
 */
export interface InterpolationInfo {
  expression: string
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
 * Compilation result
 */
export interface CompileResult {
  /** Generated JavaScript code */
  code: string
  /** Source map (if enabled) */
  map?: string
  /** Diagnostics emitted during parse + codegen (errors, security stink, info) */
  diagnostics?: Diagnostic[]
}
