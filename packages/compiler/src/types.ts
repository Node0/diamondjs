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
 * Binding types supported by DiamondJS
 */
export type BindingType =
  | 'bind'      // Two-way binding (default)
  | 'unsafe-bind' // Two-way binding to unsafe DOM sinks (explicit opt-in)
  | 'one-time'  // One-time binding (no updates)
  | 'to-view'   // One-way to view
  | 'from-view' // One-way from view
  | 'two-way'   // Explicit two-way
  | 'trigger'   // Event handler
  | 'delegate'  // Event delegation
  | 'capture'   // Capture phase event

/**
 * Extracted binding information
 */
export interface BindingInfo {
  type: BindingType
  property: string      // Element property (value, textContent, etc.)
  expression: string    // Bound expression (name, user.email, etc.)
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
}
