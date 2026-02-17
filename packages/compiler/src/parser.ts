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
 * Map lowercase attribute names to camelCase DOM property names
 * HTML attributes are case-insensitive and parse5 normalizes to lowercase
 */
const PROPERTY_NAME_MAP: Record<string, string> = {
  textcontent: 'textContent',
  innerhtml: 'innerHTML',
  innertext: 'innerText',
  classname: 'className',
  htmlfor: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  rowspan: 'rowSpan',
  colspan: 'colSpan',
  usemap: 'useMap',
  frameborder: 'frameBorder',
  contenteditable: 'contentEditable',
  // Add more as needed
}

/**
 * TemplateParser - Parses HTML templates and extracts binding information
 */
export class TemplateParser {
  /**
   * Parse an HTML template string
   *
   * @param html - Template HTML string
   * @returns Parsed node information
   */
  parse(html: string): NodeInfo[] {
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
      const bindingMatch = attr.name.match(/^(\w+)\.(\w+(?:-\w+)?)$/)

      if (bindingMatch) {
        const [, rawProperty, command] = bindingMatch
        // Map lowercase property to proper camelCase DOM property name
        const property = PROPERTY_NAME_MAP[rawProperty] || rawProperty
        const bindingType = this.parseBindingCommand(command)
        const location = this.getAttrLocation(element, attr.name)

        const binding: BindingInfo = {
          type: bindingType,
          property,
          expression: attr.value,
          location,
        }

        if (this.isEventBinding(bindingType)) {
          events.push(binding)
        } else {
          bindings.push(binding)
        }
      } else {
        staticAttrs.set(attr.name, attr.value)
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
   * Parse binding command to type
   */
  private parseBindingCommand(command: string): BindingType {
    const commandMap: Record<string, BindingType> = {
      bind: 'bind',
      'unsafe-bind': 'unsafe-bind',
      'one-time': 'one-time',
      'to-view': 'to-view',
      'from-view': 'from-view',
      'two-way': 'two-way',
      trigger: 'trigger',
      delegate: 'delegate',
      capture: 'capture',
    }
    return commandMap[command] || 'bind'
  }

  /**
   * Check if binding type is an event binding
   */
  private isEventBinding(type: BindingType): boolean {
    return type === 'trigger' || type === 'delegate' || type === 'capture'
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
