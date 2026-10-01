/**
 * Raw template source (#29).
 *
 * Interpolation syntax is recognized only where the source literally contains
 * it — an entity-encoded `$`, `{`, `}` or backslash is never syntax, exactly
 * as an encoded `<` is never a tag. So the parser scans the RAW span of a
 * text node or attribute value, and only then decodes each piece.
 *
 * Decoding is not reimplemented here: a piece is handed back to parse5 in the
 * same context (the parent element for text, an attribute value for
 * attributes), so entities, legacy entities without `;`, CRLF normalization
 * and RCDATA / raw-text elements all behave exactly as in the first parse.
 */

import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'

type Element = DefaultTreeAdapterMap['element']
type TextNode = DefaultTreeAdapterMap['textNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']
type ChildNode = DefaultTreeAdapterMap['childNode']

/** Elements after whose start tag the HTML parser drops one newline. */
const DROPS_LEADING_NEWLINE = new Set(['pre', 'textarea', 'listing'])

export interface RawSpan {
  text: string
  /** Offset of `text` in the template source */
  offset: number
}

/** The source text a text node was parsed from, or null without location info. */
export function rawTextSpan(html: string, node: TextNode): RawSpan | null {
  const loc = node.sourceCodeLocation
  if (!loc) return null
  let start = loc.startOffset

  // parse5 reports the start of such a first text node imprecisely when it
  // begins with an entity; the rule itself is exact: the text starts after the
  // start tag, less the one newline the parser drops.
  const parent = node.parentNode
  const startTag =
    parent && 'tagName' in parent && DROPS_LEADING_NEWLINE.has(parent.tagName)
      ? parent.sourceCodeLocation?.startTag
      : undefined
  if (startTag && parent!.childNodes[0] === node) {
    start = startTag.endOffset
    if (html[start] === '\r') start++
    if (html[start] === '\n') start++
  }
  return { text: html.slice(start, loc.endOffset), offset: start }
}

/** The source text of an attribute's value (quotes removed), or null without location info. */
export function rawAttributeValue(html: string, element: Element, name: string): string | null {
  const loc = element.sourceCodeLocation?.attrs?.[name]
  if (!loc) return null
  const raw = html.slice(loc.startOffset, loc.endOffset)
  const eq = raw.indexOf('=', 1) // a name may begin with '=', never contain one
  if (eq < 0) return ''
  const value = raw.slice(eq + 1).replace(/^[\t\n\f\r ]+/, '')
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
    return value.slice(1, -1)
  }
  return value
}

/** Decode a piece of raw text as the HTML parser does inside `parent`. */
export function decodeText(chunk: string, parent: ParentNode | null): string {
  if (!/[&<\r\0]/.test(chunk)) return chunk
  const fragment =
    parent && 'tagName' in parent ? parseFragment(parent, chunk, {}) : parseFragment(chunk)
  let text = ''
  const collect = (nodes: ChildNode[]): void => {
    for (const node of nodes) {
      if (node.nodeName === '#text') text += (node as TextNode).value
      else if ('childNodes' in node) collect(node.childNodes)
    }
  }
  collect(fragment.childNodes)
  return text
}

/** Decode a piece of a raw attribute value as the HTML parser does. */
export function decodeAttributeValue(chunk: string): string {
  if (!/[&\r\0]/.test(chunk)) return chunk
  const fragment = parseFragment(`<i a="${chunk.replace(/"/g, '&quot;')}"></i>`)
  return (fragment.childNodes[0] as Element).attrs[0].value
}
