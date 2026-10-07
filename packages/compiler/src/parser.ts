/**
 * TemplateParser - parse5 wrapper for HTML template parsing
 *
 * Parses HTML templates and extracts binding information
 * with source location tracking for source maps.
 */

import { parseFragment, DefaultTreeAdapterMap } from 'parse5'
import { PROPERTY_NAME_MAP } from '@diamondjs/runtime'
import { scanInterpolations, interpolationParts, type InterpolationScan } from './pipe'
import { jsString } from './js-text'
import { rawTextSpan, rawAttributeValue, decodeText, decodeAttributeValue } from './raw-source'
import type {
  SourceLocation,
  BindingInfo,
  BindingType,
  StructuralInfo,
  SwitchCaseInfo,
  Diagnostic,
  InterpolationInfo,
  ElementInfo,
  TextInfo,
  NodeInfo,
} from './types'
import { isTextInfo } from './types'

type Element = DefaultTreeAdapterMap['element']
type TextNode = DefaultTreeAdapterMap['textNode']
type Node = DefaultTreeAdapterMap['node']
type DocumentFragment = DefaultTreeAdapterMap['documentFragment']

/**
 * PROPERTY_NAME_MAP's canonical home is @diamondjs/runtime (v2.1) — the runtime
 * spread gate canonicalizes keys against the same map this parser uses, so a
 * safe sink can't fail closed in one place and pass in the other. Re-exported
 * here so the compiler's public API is unchanged.
 *
 * INVARIANT: every multi-case entry of SAFE_SINKS must appear in the map (else
 * a safe sink arrives non-canonical and fails closed as a false stink:warn).
 * Enforced by security.test.ts.
 */
export { PROPERTY_NAME_MAP }

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

  /** The template being parsed — interpolation syntax is read from the raw source (#29) */
  private source = ''

  /**
   * Parse an HTML template string
   *
   * @param html - Template HTML string
   * @returns Parsed node information
   */
  parse(html: string): NodeInfo[] {
    this.diagnostics = []
    this.source = html
    const fragment = parseFragment(html, {
      sourceCodeLocationInfo: true,
    }) as DocumentFragment

    return this.trimRootEdges(this.processChildren(fragment.childNodes))
  }

  /**
   * #15 (c): a whitespace-only text node before the first root or after the
   * last root is syntax — the indentation around a template, not content.
   * A template mounts inside its host, so the whitespace around the host's
   * tag belongs to the parent and is kept there. Only whole whitespace-only
   * nodes go: a text root with content keeps its own edges, and whitespace
   * between roots is content. ASCII whitespace only, as for `else-if` (#18).
   */
  private trimRootEdges(roots: NodeInfo[]): NodeInfo[] {
    const isIndentation = (n: NodeInfo | undefined): boolean =>
      n !== undefined && isTextInfo(n) && /^[ \t\n\f\r]*$/.test(n.content)
    let start = 0
    let end = roots.length
    if (isIndentation(roots[start])) start++
    if (end > start && isIndentation(roots[end - 1])) end--
    return roots.slice(start, end)
  }

  /**
   * Process child nodes recursively
   */
  private processChildren(nodes: Node[]): NodeInfo[] {
    const result: NodeInfo[] = []

    for (const node of nodes) {
      if (this.isElement(node)) {
        // <switch>/<case>/<default> (v2.1): switch is consumed whole by
        // processSwitch; a case/default reached HERE has no <switch> parent.
        if (node.tagName === 'switch') {
          const sw = this.processSwitch(node)
          if (sw) result.push(sw)
          continue
        }
        if (node.tagName === 'case' || node.tagName === 'default') {
          this.diagnostics.push({
            severity: 'error',
            code: `${node.tagName}-outside-switch`,
            message: `<${node.tagName}> is only valid as a direct child of <switch> (v2.1).`,
            location: this.getElementLocation(node),
          })
          continue
        }
        result.push(this.processElement(node))
      } else if (this.isTextNode(node)) {
        const textInfo = this.processTextNode(node)
        if (textInfo) {
          // An HTML comment is dropped, so the text on either side of it is
          // one run (#15): what plain HTML would hold once the comment is gone.
          const prev = result[result.length - 1]
          if (prev && isTextInfo(prev)) result[result.length - 1] = this.mergeText(prev, textInfo)
          else result.push(textInfo)
        }
      }
    }

    return result
  }

  /** Concatenate two adjacent text nodes; the first one's location stands for both. */
  private mergeText(a: TextInfo, b: TextInfo): TextInfo {
    const parts = a.parts && b.parts ? [...a.parts, ...b.parts] : undefined
    return {
      content: a.content + b.content,
      interpolations: [...a.interpolations, ...b.interpolations],
      ...(parts ? { parts } : {}),
      location: a.location,
    }
  }

  /**
   * Process a <switch on="..."> construct (v2.1, Amendment A1 backlog).
   *
   * The three elements are compile-time-erasable wrappers with structural
   * semantics only — they have no DOM target, so ANY attribute beyond
   * switch[on] / case[if] is an error. Cases are checked in document order,
   * first match wins; <default> must be the last non-whitespace child.
   */
  private processSwitch(element: Element): ElementInfo | null {
    const location = this.getElementLocation(element)
    let onExpression: string | null = null

    for (const attr of element.attrs) {
      if (attr.name === 'on') {
        onExpression = attr.value
      } else {
        this.diagnostics.push({
          severity: 'error',
          code: 'switch-extraneous-attr',
          message: `<switch> takes only 'on' (got '${attr.name}'). The element is erased at compile time — there is no DOM target for other attributes.`,
          location,
        })
      }
    }

    if (onExpression === null || onExpression.trim() === '') {
      this.diagnostics.push({
        severity: 'error',
        code: 'switch-no-on',
        message: `<switch> requires on="<expression>" — the value the cases match against.`,
        location,
      })
      return null
    }

    const cases: SwitchCaseInfo[] = []
    let defaultChildren: NodeInfo[] | null = null
    let sawDefault = false

    for (const child of element.childNodes) {
      if (this.isTextNode(child)) {
        // Only ASCII whitespace is syntax here (§5.9 (b), D-28) — the same class
        // as between `if`/`else-if` and at a template's root edges. Anything else,
        // a non-breaking space included, is text, and text has no place here.
        if (!/^[ \t\n\f\r]*$/.test(child.value)) {
          this.diagnostics.push({
            severity: 'error',
            code: 'switch-bad-child',
            message: `Text is not valid directly inside <switch> (a non-breaking space counts as text); wrap it in a <case> or <default>.`,
            location,
          })
        }
        continue
      }
      if (!this.isElement(child)) continue // comments etc.

      if (child.tagName === 'case') {
        if (sawDefault) {
          this.diagnostics.push({
            severity: 'error',
            code: 'switch-default-not-last',
            message: `<default> must be the last child of <switch>; a <case> follows it.`,
            location: this.getElementLocation(child),
          })
        }
        const info = this.processCase(child)
        if (info) cases.push(info)
        continue
      }

      if (child.tagName === 'default') {
        if (sawDefault) {
          this.diagnostics.push({
            severity: 'error',
            code: 'switch-multiple-default',
            message: `<switch> allows at most one <default>.`,
            location: this.getElementLocation(child),
          })
          continue
        }
        sawDefault = true
        for (const attr of child.attrs) {
          this.diagnostics.push({
            severity: 'error',
            code: 'switch-extraneous-attr',
            message: `<default> takes no attributes (got '${attr.name}') — it renders when no case matches.`,
            location: this.getElementLocation(child),
          })
        }
        defaultChildren = this.processChildren(child.childNodes)
        continue
      }

      this.diagnostics.push({
        severity: 'error',
        code: 'switch-bad-child',
        message: `<${child.tagName}> is not valid directly inside <switch>; only <case> and <default> are.`,
        location: this.getElementLocation(child),
      })
    }

    if (cases.length === 0 && !defaultChildren) {
      this.diagnostics.push({
        severity: 'error',
        code: 'switch-empty',
        message: `<switch> has no <case> or <default> — it can never render anything.`,
        location,
      })
      return null
    }

    return {
      tagName: 'switch',
      bindings: [],
      events: [],
      interpolations: [],
      staticAttrs: new Map(),
      children: [],
      location,
      switchInfo: {
        onExpression: onExpression.trim(),
        cases,
        defaultChildren,
        location,
      },
    }
  }

  /** Process one <case if="..."> arm; consumed inside processSwitch only. */
  private processCase(element: Element): SwitchCaseInfo | null {
    const location = this.getElementLocation(element)
    let match: string | null = null

    for (const attr of element.attrs) {
      if (attr.name === 'if') {
        match = attr.value
      } else {
        this.diagnostics.push({
          severity: 'error',
          code: 'switch-extraneous-attr',
          message: `<case> takes only 'if' (got '${attr.name}'). The element is erased at compile time — there is no DOM target for other attributes.`,
          location,
        })
      }
    }

    if (match === null || match.trim() === '') {
      this.diagnostics.push({
        severity: 'error',
        code: 'case-no-if',
        message: `<case> requires if="<value or boolean expression>".`,
        location,
      })
      return null
    }

    const { kind, literal } = this.classifyCaseMatch(match.trim())
    return {
      match: match.trim(),
      kind,
      literal,
      children: this.processChildren(element.childNodes),
      location,
    }
  }

  /**
   * Classify a case's if-value (Amendment A1 §7.3, recorded in Amendment A2):
   *  - quoted string / numeric / true / false / null → equality vs that literal
   *  - bare single word (identifier-shaped, dashes allowed) → equality vs the
   *    STRING (if="loading" matches on === 'loading' — A1's own example)
   *  - anything else (operators, spaces, dots, parens) → boolean expression;
   *    a dotted path like if="user.role" is truthiness, NOT equality.
   */
  private classifyCaseMatch(value: string): {
    kind: 'equality' | 'expression'
    literal?: string | number | boolean | null
  } {
    if (/^'[^']*'$/.test(value) || /^"[^"]*"$/.test(value)) {
      return { kind: 'equality', literal: value.slice(1, -1) }
    }
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return { kind: 'equality', literal: Number(value) }
    }
    if (value === 'true') return { kind: 'equality', literal: true }
    if (value === 'false') return { kind: 'equality', literal: false }
    if (value === 'null') return { kind: 'equality', literal: null }
    if (/^[A-Za-z_$][\w$-]*$/.test(value)) {
      return { kind: 'equality', literal: value }
    }
    return { kind: 'expression' }
  }

  /**
   * Process an element node
   */
  private processElement(element: Element): ElementInfo {
    const bindings: BindingInfo[] = []
    const events: BindingInfo[] = []
    const staticAttrs = new Map<string, string>()
    const updateOnMap = new Map<
      string,
      { event: string; location: SourceLocation | null }
    >()
    const errorIntoMap = new Map<
      string,
      { target: string; location: SourceLocation | null }
    >()
    let structural: StructuralInfo | undefined

    // Process attributes
    for (const attr of element.attrs) {
      // parse5 lowercases attr names. A dotted name (`property.command[.qualifier]`)
      // is a binding; structural directives (if/else-if/repeat.for) and removed
      // forms (else/with/rawIf) are recognized first; everything else is static.
      const name = attr.name
      const segments = name.split('.')
      const location = this.getAttrLocation(element, name)

      // --- Attribute spread (v2.1, DDR §7.1) — before the dot-split logic
      // (a spread name would shred into ['','','attrs','bind']). Only the two
      // canonical forms exist; anything else after '...' fails loudly.
      if (name.startsWith('...')) {
        if (name === '...attrs.bind' || name === '...attrs.rawbind') {
          this.checkRemovedAmpersand(attr.value, location)
          bindings.push({
            type: 'spread',
            property: '...attrs',
            expression: attr.value,
            raw: name === '...attrs.rawbind',
            location,
          })
        } else {
          this.diagnostics.push({
            severity: 'error',
            code: 'bad-spread',
            message: `Unknown spread form '${name}'. Only '...attrs.bind' (allowlist-gated at runtime) and '...attrs.rawBind' (developer-owned, audited) exist (DDR §7.1).`,
            location,
          })
        }
        continue
      }

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

      // Bare `update-on` is ambiguous on multi-binding elements (§4.3)
      if (name === 'update-on') {
        this.diagnostics.push({
          severity: 'error',
          code: 'bare-update-on',
          message: `Bare 'update-on' is ambiguous on multi-binding elements; scope it to a property, e.g. value.update-on="blur" (DDR §4.3).`,
          location,
        })
        continue
      }

      // Bare `error-into` — same ambiguity (v2.1)
      if (name === 'error-into') {
        this.diagnostics.push({
          severity: 'error',
          code: 'bare-error-into',
          message: `Bare 'error-into' is ambiguous on multi-binding elements; scope it to a property, e.g. value.error-into="amountError".`,
          location,
        })
        continue
      }

      // Property-scoped binding-update timing: value.update-on="blur" (§4.3)
      if (segments.length === 2 && segments[1] === 'update-on') {
        const prop = PROPERTY_NAME_MAP[segments[0]] || segments[0]
        updateOnMap.set(prop, { event: attr.value, location })
        continue
      }

      // Property-scoped ParseResult error surface: value.error-into="amountError"
      // (v2.1, §5.7 rendering surface). The target must be a bare property path
      // — it becomes reactive state the template renders like any other.
      if (segments.length === 2 && segments[1] === 'error-into') {
        const prop = PROPERTY_NAME_MAP[segments[0]] || segments[0]
        if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(attr.value.trim())) {
          this.diagnostics.push({
            severity: 'error',
            code: 'bad-error-into',
            message: `'${prop}.error-into' expects a bare property path (e.g. "amountError" or "form.amountError"); got "${attr.value}".`,
            location,
          })
          continue
        }
        errorIntoMap.set(prop, { target: attr.value.trim(), location })
        continue
      }

      if (segments.length < 2) {
        const value = this.staticAttrValue(element, attr, location)
        if (value !== null) staticAttrs.set(name, value)
        continue
      }

      const [rawProperty, ...commandSegs] = segments
      const parsed = this.parseCommand(commandSegs, name, location)

      if (!parsed) {
        // Retired or unknown command — diagnostic already recorded; drop the attr
        // so no bogus binding ships. (The transformer throws on error-severity.)
        continue
      }

      // §4.3: Aurelia `&` binding behaviors are removed
      this.checkRemovedAmpersand(attr.value, location)

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

    // Apply update-on modifiers to their matching inbound bindings (§4.3)
    for (const [prop, uo] of updateOnMap) {
      const target = bindings.find((b) => b.property === prop)
      if (!target) {
        this.diagnostics.push({
          severity: 'error',
          code: 'update-on-no-binding',
          message: `'${prop}.update-on' has no '${prop}' binding to time; add a two-way or from-view binding (DDR §4.3).`,
          location: uo.location,
        })
        continue
      }
      if (
        target.type !== 'two-way' &&
        target.type !== 'bind' &&
        target.type !== 'from-view'
      ) {
        this.diagnostics.push({
          severity: 'error',
          code: 'update-on-not-inbound',
          message: `'${prop}.update-on' only applies to the inbound leg (two-way / from-view); '${prop}' is bound '${target.type}'.`,
          location: uo.location,
        })
        continue
      }
      target.updateOn = uo.event
    }

    // Apply error-into modifiers to their matching inbound bindings (v2.1).
    // Whether the binding actually HAS a converter (a ParseResult to read) is
    // only known at codegen, which emits error-into-no-converter.
    for (const [prop, ei] of errorIntoMap) {
      const target = bindings.find((b) => b.property === prop)
      if (!target) {
        this.diagnostics.push({
          severity: 'error',
          code: 'error-into-no-binding',
          message: `'${prop}.error-into' has no '${prop}' binding to read errors from; add a two-way or from-view binding with a converter.`,
          location: ei.location,
        })
        continue
      }
      if (
        target.type !== 'two-way' &&
        target.type !== 'bind' &&
        target.type !== 'from-view'
      ) {
        this.diagnostics.push({
          severity: 'error',
          code: 'error-into-not-inbound',
          message: `'${prop}.error-into' only applies to the inbound leg (two-way / from-view) — ParseResult errors come from parse; '${prop}' is bound '${target.type}'.`,
          location: ei.location,
        })
        continue
      }
      target.errorInto = ei.target
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
   * A plain attribute's value. Interpolation syntax is read from the raw
   * source (#29): `\${` and entity spellings are literal text. §16 D-3 stands
   * for a real `${` — attribute interpolation would compile the literal
   * silently, so it is diagnosed (support is a future decision, not a shipped
   * feature) and null is returned.
   */
  private staticAttrValue(
    element: Element,
    attr: { name: string; value: string },
    location: SourceLocation | null
  ): string | null {
    const raw = rawAttributeValue(this.source, element, attr.name)
    // No raw `${`: nothing to scan — the parser's own value is the text.
    if (raw !== null && !raw.includes('${')) return attr.value

    const { scan, decode } = this.scanRaw(raw, attr.value, decodeAttributeValue)

    if (scan.spans.length > 0) {
      this.diagnostics.push({
        severity: 'error',
        code: 'attr-interpolation-unsupported',
        message:
          `Attribute interpolation is not supported: ${attr.name}="${attr.value}" ` +
          `would ship the literal text. Use a binding instead, e.g. ` +
          `${attr.name}.to-view="${this.suggestConcatExpression(scan, decode)}".`,
        location,
      })
      return null
    }
    for (let k = 0; k < scan.escapes.length; k++) this.noteEscapedInterpolation(location)
    return decode(scan.statics[0])
  }

  /**
   * Process a text node into literal text + interpolations (#29). Syntax —
   * the `${` opener, its `}`, an escaping backslash — is recognized in the
   * RAW source only, so an entity-encoded `$` or `{` is never an
   * interpolation; each piece is then entity-decoded as the HTML parser
   * decoded the whole (`${a &lt; b}` keeps working).
   */
  private processTextNode(node: TextNode): TextInfo | null {
    const content = node.value

    // #15: text is kept exactly as the HTML parser produced it — whitespace-only
    // nodes included (NBSP-only ones most of all). The only whitespace that is
    // syntax is consumed at its own site: between `if` and `else-if`
    // (generator, #18), directly inside <switch> (processSwitch), and at a
    // template's root edges (trimRootEdges).
    if (content === '') return null

    const location = this.getTextLocation(node)
    const span = rawTextSpan(this.source, node)

    // No raw `${`: nothing to scan — the parser's own value is the text.
    if (span !== null && !span.text.includes('${')) {
      return { content, interpolations: [], parts: [{ kind: 'text', value: content }], location }
    }

    const { scan, decode, trusted } = this.scanRaw(span?.text ?? null, content, (piece) =>
      decodeText(piece, node.parentNode)
    )

    for (const at of scan.escapes) {
      this.noteEscapedInterpolation(trusted ? this.locationAt(span!.offset + at) : location)
    }

    const interpolations: InterpolationInfo[] = []
    for (const found of scan.spans) {
      const expression = decode(found.expression).trim()
      if (found.unterminated) {
        this.diagnostics.push({
          severity: 'error',
          code: 'unterminated-interpolation',
          message: `Unterminated interpolation: '\${${expression}' has no closing '}'.`,
          location,
        })
        continue
      }
      this.checkRemovedAmpersand(expression, location)
      interpolations.push({
        expression,
        location, // Simplified - same as text node
      })
    }
    const parts = interpolationParts(scan, decode)

    return { content, interpolations, parts, location }
  }

  /**
   * Scan raw source for interpolation syntax (#29). The raw text is trusted
   * only when it decodes to exactly what the HTML parser produced; when it
   * does not (no location info, a span the parser reports imprecisely), the
   * decoded value is scanned instead, as before #29.
   */
  private scanRaw(
    raw: string | null,
    value: string,
    decodeRaw: (piece: string) => string
  ): { scan: InterpolationScan; decode: (piece: string) => string; trusted: boolean } {
    const trusted = raw !== null && decodeRaw(raw) === value
    return {
      scan: scanInterpolations(trusted ? raw : value),
      decode: trusted ? decodeRaw : (piece) => piece,
      trusted,
    }
  }

  /**
   * Advisory (#29): a `\${` was read as a literal `${`. Literal `${` is rare,
   * and the one case that silently changes meaning is a backslash meant as
   * text right before an interpolation — a Windows path.
   */
  private noteEscapedInterpolation(location: SourceLocation | null): void {
    this.diagnostics.push({
      severity: 'info',
      code: 'escaped-interpolation',
      message:
        `'\\\${' is a literal '\${', not an interpolation. If the backslash is itself text ` +
        `followed by an interpolation — a path such as C:\\Users\\\${user} — write '\\\\\${'.`,
      location,
    })
  }

  /** Source location of an offset into the template. */
  private locationAt(offset: number): SourceLocation {
    const before = this.source.slice(0, offset)
    const lineStart = before.lastIndexOf('\n') + 1
    return {
      line: before.split('\n').length,
      column: offset - lineStart + 1,
      offset,
    }
  }

  /**
   * Rewrite an interpolated attribute value as the equivalent concatenation
   * expression for the D-3 remediation message: `Hello ${name}` →
   * `'Hello ' + name`. Best-effort (an unterminated span falls back to a
   * quoted literal); the output is a suggestion, never emitted code.
   */
  private suggestConcatExpression(
    scan: InterpolationScan,
    decode: (piece: string) => string
  ): string {
    const parts: string[] = []
    scan.spans.forEach((span, k) => {
      const staticPart = decode(scan.statics[k])
      if (span.unterminated) {
        parts.push(jsString(staticPart + '${' + decode(span.expression)))
        return
      }
      if (staticPart) parts.push(jsString(staticPart))
      parts.push(decode(span.expression).trim())
    })
    const tail = decode(scan.statics[scan.spans.length])
    if (tail) parts.push(jsString(tail))
    return parts.join(' + ') || "''"
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

    // Unknown command — replaces the old silent `|| 'bind'` fallback. The
    // non-raw three-segment spelling (`.bind.to-view`) was never grammar (D-27):
    // one spelling per command, and the three-segment form is rawBind's.
    const dir = /^bind\.(to-view|from-view|two-way)$/.exec(key)?.[1]
    const hint = dir ? ` Write '.${dir}' (or '.rawBind.${dir}' for a raw sink); the three-segment form is for rawBind only (spec §5.1).` : ''
    this.diagnostics.push({
      severity: 'error',
      code: 'unknown-command',
      message: `Unknown binding command '.${key}' in '${attrName}'.${hint}`,
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
   * Diagnose a removed Aurelia binding behavior (`expr & name`). A lone `&`
   * (not `&&`) in a binding/interpolation expression is the retired glyph (§4.3).
   */
  private checkRemovedAmpersand(
    expr: string,
    location: SourceLocation | null
  ): void {
    if (/(?<!&)&(?!&)/.test(expr)) {
      this.diagnostics.push({
        severity: 'error',
        code: 'ampersand-removed',
        message: `& is not valid in a DiamondJS binding expression. If you meant bitwise AND, move the computation to a view-model getter (get result() { return this.a & this.b }). If you meant the removed & behavior syntax, use value.update-on, this.debounce, or a reactive dependency instead.`,
        location,
      })
    }
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
