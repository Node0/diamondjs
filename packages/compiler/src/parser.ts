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
  StructuralInfo,
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
    let structural: StructuralInfo | undefined

    // Process attributes
    for (const attr of element.attrs) {
      // parse5 lowercases attr names. A dotted name (`property.command[.qualifier]`)
      // is a binding; structural directives (if/else-if/repeat.for) and removed
      // forms (else/with/rawIf) are recognized first; everything else is static.
      const name = attr.name
      const segments = name.split('.')
      const location = this.getAttrLocation(element, name)

      // --- Structural directives + removed-form rejections (DDR §6.1–6.3, A1) ---
      const struct = this.tryStructural(name, segments, attr.value, location)
      if (struct !== null) {
        if (struct.structural) {
          if (structural) {
            this.diagnostics.push({
              severity: 'error',
              code: 'multiple-structural',
              message: `Element has multiple structural directives ('${structural.type}' and '${struct.structural.type}'); nest them on separate elements instead.`,
              location,
            })
          } else {
            structural = struct.structural
          }
        }
        continue // handled (set structural or recorded a rejection diagnostic)
      }

      if (segments.length < 2) {
        staticAttrs.set(name, attr.value)
        continue
      }

      const [rawProperty, ...commandSegs] = segments
      const parsed = this.parseCommand(commandSegs, name, location)

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
      structural,
    }
  }

  /**
   * Recognize structural directives and removed-form misuse.
   *
   * Returns null when the attribute is NOT structural-related (caller proceeds
   * to binding/static handling). Returns an object when handled: `.structural`
   * is set for a valid directive, or absent when a rejection diagnostic was
   * recorded (bare else, with, rawIf, if.bind, etc. — DDR §6.1/§6.2 + A1).
   */
  private tryStructural(
    name: string,
    segments: string[],
    value: string,
    location: SourceLocation | null
  ): { structural?: StructuralInfo } | null {
    const head = segments[0]

    // repeat.for="item of items" (DDR §6.3)
    if (head === 'repeat') {
      if (segments.length === 2 && segments[1] === 'for') {
        const m = value.match(/^\s*(\w+)\s+of\s+(.+?)\s*$/)
        if (!m) {
          this.diagnostics.push({
            severity: 'error',
            code: 'bad-repeat',
            message: `repeat.for expects "item of items"; got "${value}".`,
            location,
          })
          return {}
        }
        return {
          structural: {
            type: 'repeat',
            expression: value,
            itemName: m[1],
            itemsExpression: m[2],
            location,
          },
        }
      }
      this.diagnostics.push({
        severity: 'error',
        code: 'bad-repeat',
        message: `Unknown repeat command '.${segments.slice(1).join('.')}'; the only looping construct is 'repeat.for'.`,
        location,
      })
      return {}
    }

    // if (bare) + rejections of if.bind / if.set / etc. (DDR §6.2)
    if (head === 'if') {
      if (segments.length === 1) {
        return { structural: { type: 'if', expression: value, location } }
      }
      this.diagnostics.push({
        severity: 'error',
        code: 'if-no-command',
        message: `'if' takes no binding command (got '.${segments.slice(1).join('.')}'). 'if' has no sink — use bare if="..."; there is no if.bind, if.set, or rawIf.`,
        location,
      })
      return {}
    }

    // else-if (bare) — A1
    if (head === 'else-if') {
      if (segments.length === 1) {
        return { structural: { type: 'else-if', expression: value, location } }
      }
      this.diagnostics.push({
        severity: 'error',
        code: 'elseif-no-command',
        message: `'else-if' takes no binding command; use bare else-if="<condition>".`,
        location,
      })
      return {}
    }

    // bare else — removed (Amendment A1)
    if (name === 'else') {
      this.diagnostics.push({
        severity: 'error',
        code: 'bare-else-removed',
        message: `Bare 'else' is not valid in DiamondJS 2.0+. Use else-if="!<condition>", or <switch>/<case>/<default> (v2.1) for exhaustive cases.`,
        location,
      })
      return {}
    }

    // rawIf — 'if' has no sink, so no raw variant (A1)
    if (name === 'rawif') {
      this.diagnostics.push({
        severity: 'error',
        code: 'raw-if-invalid',
        message: `'rawIf' is not valid: 'if' has no sink, so there is no raw variant. Use bare if="...".`,
        location,
      })
      return {}
    }

    // with / with.bind — removed entirely (DDR §6.1)
    if (head === 'with') {
      this.diagnostics.push({
        severity: 'error',
        code: 'with-removed',
        message: `'with' was removed in DiamondJS 2.0 (DDR §6.1) — it rebinds scope invisibly. Use a view-model getter instead (e.g. get themeColor() { return this.user.profile.settings.theme.color }).`,
        location,
      })
      return {}
    }

    return null // not structural-related
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
