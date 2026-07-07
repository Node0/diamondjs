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
import { SAFE_SINKS, isDataOrAriaKey } from '@diamondjs/runtime'

/**
 * The safe-sink allowlist's canonical home is @diamondjs/runtime (v2.1): the
 * runtime spread gate (DDR §7.1) and this compile-time gate must consult the
 * SAME single auditable set. Re-exported here so the compiler's public API is
 * unchanged.
 */
export { SAFE_SINKS }

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
  // data-*/aria-* pass through the attribute branch — inert metadata, never
  // parsed as HTML/script/URL (Amendment A2; consistent with the §7.1 spread gate).
  const safe = SAFE_SINKS.has(property) || isDataOrAriaKey(property)

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
