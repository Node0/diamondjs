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
import { SAFE_SINKS, isInertMetadataKey, canonicalizeSinkKey } from '@diamondjs/runtime'

/**
 * The safe-sink allowlist's canonical home is @diamondjs/runtime (v2.1): the
 * runtime spread gate (DDR §7.1) and this compile-time gate must consult the
 * SAME single auditable set. Re-exported here so the compiler's public API is
 * unchanged.
 */
export { SAFE_SINKS, canonicalizeSinkKey }

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
 * URL schemes a static link literal may carry and still gate clean: they can
 * only navigate, never execute. Everything unenumerated (`javascript:`,
 * `data:`, `blob:`, `vbscript:`, …) fails closed — allowlist, not blocklist.
 */
export const INERT_URL_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * A static `<a href>` / `<area href>` whose literal target is inert is the
 * router's documented link pattern (spec §6.3: "SPA links use a static href
 * attribute plus a click-interceptor, never a dynamic href bind") — not a sink
 * write to gate (issue #8). `href` stays OFF the allowlist for every bound
 * form: the allowlist's inclusion test asks what an arbitrary attacker string
 * could do, and a bound href can carry `javascript:`. A literal typed by the
 * template author is fully known here, so only its scheme matters: scheme-less
 * targets (`/path`, `./rel`, `#frag`, `?q=`) and INERT_URL_SCHEMES pass; any
 * other scheme still warns exactly as before (§16 D-10 keeps
 * `<a href="javascript:…">` visible). Whitespace and control characters are
 * stripped first because the HTML URL parser strips them too — `java\nscript:`
 * IS `javascript:` to a browser — and stripping can only make a literal LOOK
 * more like a scheme, i.e. err toward warning.
 */
export function isInertStaticHref(tagName: string, attr: string, value: string): boolean {
  if (attr !== 'href' || (tagName !== 'a' && tagName !== 'area')) return false
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000- \u007f]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  return scheme === null || INERT_URL_SCHEMES.has(scheme[1].toLowerCase())
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
  // data-*/aria-*/role pass through the attribute branch — inert metadata,
  // never parsed as HTML/script/URL (Amendment A2 + #8; consistent with the
  // §7.1 spread gate).
  const safe = SAFE_SINKS.has(property) || isInertMetadataKey(property)

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
