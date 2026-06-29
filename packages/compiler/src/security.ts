/**
 * Security policy — the single auditable allowlist + compile-time sink-write gate.
 *
 * DiamondJS v2.0 inverts the original blocklist (DDR §3.2): instead of
 * enumerating known-dangerous sinks (which fails OPEN on anything unforeseen),
 * we enumerate the small, spec-derivable SAFE set and fail CLOSED on ignorance.
 *
 *   - On the allowlist           → clean write, no stink.
 *   - Off the allowlist, no raw  → stink:warn (latent hole; hard-gated by tooling).
 *   - Off the allowlist, raw     → stink:declared (intentional; baselined + reviewed).
 *   - Novel / unknown            → treated as raw (fails closed).
 *
 * This module performs NO output transformation — DiamondJS does no runtime
 * escaping. The gate is purely a compile-time *permission + audit* decision:
 * for a non-safe sink the emitted bytes are identical whether declared or not.
 * You cannot make `innerHTML` safe with code, only with a *declaration* — the
 * gate's job is to force that declaration into the reviewed baseline.
 */

import type { Diagnostic, SinkOp, SourceLocation } from './types'

/**
 * The safe-sink allowlist (canonical camelCase keys).
 *
 * Inclusion test: assigning an arbitrary attacker-controlled string to the
 * property cannot cause (a) HTML/markup parsing, (b) script execution, or
 * (c) navigation to a script-capable URL scheme. The §11.2 "load-bearing
 * unknown" — refine empirically (see impl_docs/working_notes.md).
 *
 * NOTE: any entry whose camelCase ≠ lowercase MUST also exist in the parser's
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
 * The raw command a developer should reach for to declare a given sink op.
 * Used in the stink:warn remediation message.
 */
function rawSuggestion(op: SinkOp): string {
  switch (op) {
    case 'set':
      return 'rawSet'
    case 'to-view':
      return 'rawBind.to-view'
    case 'from-view':
      return 'rawBind.from-view'
    case 'two-way':
    case 'bind':
    default:
      return 'rawBind.two-way'
  }
}

/**
 * Gate a single sink write. Returns a Diagnostic to attach (warn/declared/info)
 * or null when the write is a clean, allowlisted sink. The caller emits the
 * write unconditionally — the gate never changes the emitted code.
 *
 * `property` must already be normalized to canonical camelCase (the parser does
 * this via PROPERTY_NAME_MAP before constructing BindingInfo).
 */
export function gateSink(
  property: string,
  op: SinkOp,
  raw: boolean,
  expression: string,
  location: SourceLocation | null
): Diagnostic | null {
  const safe = SAFE_SINKS.has(property)

  if (raw) {
    if (safe) {
      // Raw declared on an already-safe sink — harmless but noisy.
      return {
        severity: 'info',
        code: 'raw:redundant',
        message: `Redundant raw on safe sink '${property}' (${op}); plain '${op}' suffices.`,
        location,
        property,
        op,
        raw: true,
        expression,
      }
    }
    // Intentional, declared raw on a non-safe sink → baselined, not blocked.
    return {
      severity: 'declared',
      code: 'stink:declared',
      message: `raw ${property} via ${op}${expression ? `: ${expression}` : ''}`,
      location,
      property,
      op,
      raw: true,
      expression,
    }
  }

  if (safe) {
    // Allowlisted sink, no raw needed — clean.
    return null
  }

  // Non-safe sink written WITHOUT raw — latent hole nobody declared.
  return {
    severity: 'warn',
    code: 'stink:warn',
    message:
      `Unsafe sink '${property}' written without raw (${op}). ` +
      `Use '${property}.${rawSuggestion(op)}' (and route untrusted input through a sanitizer), ` +
      `or bind a safe sink instead.`,
    location,
    property,
    op,
    raw: false,
    expression,
  }
}
