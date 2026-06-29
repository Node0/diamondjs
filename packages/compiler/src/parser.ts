/**
 * TemplateParser - parse5 wrapper for HTML template parsing
 *
 * Parses HTML templates and extracts binding information
 * with source location tracking for source maps.
 */

import { parseFragment, DefaultTreeAdapterMap } from 'parse5'
import type {
  SourceLocation,
  BindingInfo,
  BindingType,
  Diagnostic,
  InterpolationInfo,
  ElementInfo,
  TextInfo,
  NodeInfo,
} from './types'

type Element = DefaultTreeAdapterMap['element']
type TextNode = DefaultTreeAdapterMap['textNode']
type Node = DefaultTreeAdapterMap['node']
type DocumentFragment = DefaultTreeAdapterMap['documentFragment']

/**
 * Map lowercase attribute names to camelCase DOM property names.
 * HTML attributes are case-insensitive and parse5 normalizes to lowercase, so
 * every property segment arrives lowercased and must be canonicalized here.
 *
 * INVARIANT: every multi-case entry of SAFE_SINKS must appear here (else a safe
 * sink arrives non-canonical and fails closed as a false stink:warn). Enforced
 * by security.test.ts.
 */
export const PROPERTY_NAME_MAP: Record<string, string> = {
  textcontent: 'textContent',
  innerhtml: 'innerHTML',
  innertext: 'innerText',
  classname: 'className',
  htmlfor: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  rowspan: 'rowSpan',
  colspan: 'colSpan',
  usemap: 'useMap',
  frameborder: 'frameBorder',
  contenteditable: 'contentEditable',
  // Safe-sink canonicalizations (keep in sync with SAFE_SINKS)
  scrolltop: 'scrollTop',
  scrollleft: 'scrollLeft',
  valueasnumber: 'valueAsNumber',
  valueasdate: 'valueAsDate',
  selectedindex: 'selectedIndex',
  inputmode: 'inputMode',
  // Add more as needed
}

/**
 * Binding command surface (v2.0). Keyed by the lowercased command segment(s)
 * joined with '.', since parse5 lowercases all attribute names — the camelCase
 * legibility of `rawSet`/`rawBind` is a source-only affordance.
 *
 * Two-segment: `property.command`. Three-segment: `property.rawBind.direction`.
 * `raw` is represented as a boolean flag, never a flattened `rawTo-view` token.
 */
const COMMAND_MAP: Record<string, { type: BindingType; raw: boolean }> = {
  set: { type: 'set', raw: false },
  rawset: { type: 'set', raw: true },
  bind: { type: 'bind', raw: false },
  rawbind: { type: 'bind', raw: true },
  'to-view': { type: 'to-view', raw: false },
  'from-view': { type: 'from-view', raw: false },
  'two-way': { type: 'two-way', raw: false },
  'bind.to-view': { type: 'to-view', raw: false },
  'bind.from-view': { type: 'from-view', raw: false },
  'bind.two-way': { type: 'two-way', raw: false },
  'rawbind.to-view': { type: 'to-view', raw: true },
  'rawbind.from-view': { type: 'from-view', raw: true },
  'rawbind.two-way': { type: 'two-way', raw: true },
  calls: { type: 'calls', raw: false },
  capture: { type: 'capture', raw: false },
}

/** Retired v1.5.1 commands → the v2.0 replacement guidance (DDR §4.1/§6.4/§6.5). */
const RETIRED_COMMANDS: Record<string, string> = {
  'one-time': "renamed to '.set' (or '.rawSet' for unescaped writes)",
  trigger: "renamed to '.calls'",
  delegate: "removed; attach a per-node '.calls' handler instead",
}

/**
 * TemplateParser - Parses HTML templates and extracts binding information
 */
export class TemplateParser {
  /** Diagnostics (retired/unknown commands) collected during the most recent parse() */
  diagnostics: Diagnostic[] = []

  /**
   * Parse an HTML template string
   *
   * @param html - Template HTML string
   * @returns Parsed node information
   */
  parse(html: string): NodeInfo[] {
    this.diagnostics = []
    const fragment = parseFragment(html, {
      sourceCodeLocationInfo: true,
    }) as DocumentFragment

    return this.processChildren(fragment.childNodes)
  }

  /**
   * Process child nodes recursively
   */
  private processChildren(nodes: Node[]): NodeInfo[] {
    const result: NodeInfo[] = []

    for (const node of nodes) {
      if (this.isElement(node)) {
        result.push(this.processElement(node))
      } else if (this.isTextNode(node)) {
        const textInfo = this.processTextNode(node)
        if (textInfo) {
          result.push(textInfo)
        }
      }
    }

    return result
  }

  /**
   * Process an element node
   */
  private processElement(element: Element): ElementInfo {
    const bindings: BindingInfo[] = []
    const events: BindingInfo[] = []
    const staticAttrs = new Map<string, string>()

    // Process attributes
    for (const attr of element.attrs) {
      // A dotted attribute name (`property.command[.qualifier]`) is a binding;
      // everything else is a static attribute. parse5 lowercases attr names.
      const segments = attr.name.split('.')
      if (segments.length < 2) {
        staticAttrs.set(attr.name, attr.value)
        continue
      }

      const [rawProperty, ...commandSegs] = segments
      const location = this.getAttrLocation(element, attr.name)
      const parsed = this.parseCommand(commandSegs, attr.name, location)

      if (!parsed) {
        // Retired or unknown command — diagnostic already recorded; drop the attr
        // so no bogus binding ships. (The transformer throws on error-severity.)
        continue
      }

      // Map lowercase property to canonical camelCase DOM property name
      const property = PROPERTY_NAME_MAP[rawProperty] || rawProperty
      const binding: BindingInfo = {
        type: parsed.type,
        property,
        expression: attr.value,
        raw: parsed.raw,
        location,
      }

      if (this.isEventBinding(parsed.type)) {
        events.push(binding)
      } else {
        bindings.push(binding)
      }
    }

    // Process children
    const children = this.processChildren(element.childNodes)

    return {
      tagName: element.tagName,
      bindings,
      events,
      interpolations: [],
      staticAttrs,
      children,
      location: this.getElementLocation(element),
    }
  }

  /**
   * Process a text node, extracting interpolations
   */
  private processTextNode(node: TextNode): TextInfo | null {
    const content = node.value
    
    // Skip whitespace-only nodes
    if (!content.trim()) {
      return null
    }

    const interpolations = this.extractInterpolations(content, node)

    return {
      content,
      interpolations,
      location: this.getTextLocation(node),
    }
  }

  /**
   * Extract ${...} interpolations from text
   */
  private extractInterpolations(
    content: string,
    node: TextNode
  ): InterpolationInfo[] {
    const interpolations: InterpolationInfo[] = []
    const regex = /\$\{([^}]+)\}/g
    let match

    while ((match = regex.exec(content)) !== null) {
      interpolations.push({
        expression: match[1].trim(),
        location: this.getTextLocation(node), // Simplified - same as text node
      })
    }

    return interpolations
  }

  /**
   * Parse command segment(s) into a binding type + raw flag.
   *
   * Returns null (and records an error diagnostic) for retired or unknown
   * commands — there is no silent fallback (a fail-open default would be a hole
   * in a security release).
   */
  private parseCommand(
    commandSegs: string[],
    attrName: string,
    location: SourceLocation | null
  ): { type: BindingType; raw: boolean } | null {
    const key = commandSegs.join('.')

    const known = COMMAND_MAP[key]
    if (known) return known

    // Retired v1.5.1 command → actionable error
    const retired = RETIRED_COMMANDS[key]
    if (retired) {
      this.diagnostics.push({
        severity: 'error',
        code: 'retired-command',
        message: `Binding command '.${key}' was ${retired}. (in '${attrName}')`,
        location,
      })
      return null
    }

    // Unknown command — replaces the old silent `|| 'bind'` fallback
    this.diagnostics.push({
      severity: 'error',
      code: 'unknown-command',
      message: `Unknown binding command '.${key}' in '${attrName}'.`,
      location,
    })
    return null
  }

  /**
   * Check if binding type is an event binding
   */
  private isEventBinding(type: BindingType): boolean {
    return type === 'calls' || type === 'capture'
  }

  /**
   * Get source location for an attribute
   */
  private getAttrLocation(
    element: Element,
    attrName: string
  ): SourceLocation | null {
    const loc = element.sourceCodeLocation?.attrs?.[attrName]
    if (!loc) return null

    return {
      line: loc.startLine,
      column: loc.startCol,
      offset: loc.startOffset,
    }
  }

  /**
   * Get source location for an element
   */
  private getElementLocation(element: Element): SourceLocation | null {
    const loc = element.sourceCodeLocation
    if (!loc) return null

    return {
      line: loc.startLine,
      column: loc.startCol,
      offset: loc.startOffset,
    }
  }

  /**
   * Get source location for a text node
   */
  private getTextLocation(node: TextNode): SourceLocation | null {
    const loc = node.sourceCodeLocation
    if (!loc) return null

    return {
      line: loc.startLine,
      column: loc.startCol,
      offset: loc.startOffset,
    }
  }

  /**
   * Type guard for element nodes
   */
  private isElement(node: Node): node is Element {
    return 'tagName' in node
  }

  /**
   * Type guard for text nodes
   */
  private isTextNode(node: Node): node is TextNode {
    return node.nodeName === '#text'
  }
}
