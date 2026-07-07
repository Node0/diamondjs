/**
 * Security data shared by the compiler (compile-time sink gate) and the runtime
 * (attribute-spread gate, DDR §7.1).
 *
 * Canonical home: the RUNTIME. Compiled output and the runtime spread loop must
 * gate against the SAME single auditable allowlist (DDR §3.2) — the compiler
 * imports and re-exports these, so there is exactly one set to audit.
 */

/**
 * The safe-sink allowlist (canonical camelCase keys).
 *
 * Inclusion test: assigning an arbitrary attacker-controlled string to the
 * property cannot cause (a) HTML/markup parsing, (b) script execution, or
 * (c) navigation to a script-capable URL scheme. The §11.2 "load-bearing
 * unknown" — refine empirically (see impl_docs/working_notes.md).
 *
 * NOTE: any entry whose camelCase ≠ lowercase MUST also exist in
 * PROPERTY_NAME_MAP, or it arrives non-canonical and fails closed as a false
 * warn. Enforced by a unit test (SAFE_SINKS ⊆ PROPERTY_NAME_MAP ∪ lc-identical).
 */
export const SAFE_SINKS: ReadonlySet<string> = new Set<string>([
  // Text content (no markup parsing)
  'textContent',
  'innerText',
  // Form value / selection state
  'value',
  'valueAsNumber',
  'valueAsDate',
  'checked',
  'selected',
  'selectedIndex',
  // Class (not inline style)
  'className',
  // Boolean / scalar UI state
  'disabled',
  'readOnly',
  'required',
  'hidden',
  'multiple',
  'open',
  // Numeric / layout scalars
  'tabIndex',
  'maxLength',
  'minLength',
  'rowSpan',
  'colSpan',
  'scrollTop',
  'scrollLeft',
  // Plain-text descriptors
  'placeholder',
  'title',
  'alt',
  'label',
  'htmlFor',
  // Constrained-token control props
  'type',
  'name',
  'accept',
  'autocomplete',
  'inputMode',
  'step',
  'min',
  'max',
  'pattern',
  'id',
])

/**
 * Map lowercase attribute names to camelCase DOM property names.
 * HTML attributes are case-insensitive (parse5 lowercases them), and spread
 * source objects may be authored with lowercase keys — both must canonicalize
 * before the allowlist lookup or a safe sink fails closed as a false warn.
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

/** Canonicalize an attribute-cased / lowercase key to its camelCase property name. */
export function canonicalizeSinkKey(key: string): string {
  return PROPERTY_NAME_MAP[key.toLowerCase()] ?? key
}

/**
 * `data-*` / `aria-*` keys pass the outbound gate through the ATTRIBUTE branch:
 * they are inert metadata — never parsed as HTML, script, or a URL. The DDR
 * §7.1 spread example blesses them; recorded as an allowlist extension in
 * Amendment A2.
 */
export function isDataOrAriaKey(key: string): boolean {
  return key.startsWith('data-') || key.startsWith('aria-')
}
