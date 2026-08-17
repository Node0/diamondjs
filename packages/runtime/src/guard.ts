/**
 * Guard — the navigation-policy contract (v2.2 §3.5).
 *
 * Three static members, nothing else — no hook forest, ever (recorded
 * rejected alternative). The check/deny cleave is normative:
 *
 *   - `check` is a PURE PREDICATE — callable from templates, handlers, and
 *     socket message handlers as second enforcement points. It answers
 *     "may they?", never navigates, never redirects.
 *   - `deny` holds ALL navigation policy: where a refused navigation goes.
 *     It returns a Destination — DATA the router executes, never a side
 *     effect (v2.2.1: the same tagged union route redirects speak; guards
 *     get site-path and external-url denials for free — the OAuth IdP
 *     handoff is { type: 'external-url', target: authorizeUrl(...) }).
 *
 * Fail-closed by construction: the base `check` returns false (an
 * unoverridden guard denies), and the base `deny` conceals (route-id
 * 'not-found' — existence of the resource is not admitted).
 *
 * The execution envelope (timeout, throw-containment, narration, result
 * normalization) is a private static on Router — JS cannot seal statics, so
 * the envelope is deliberately NOT an overridable member here.
 *
 * Principle: client guards PREDICT; servers ENFORCE. Client guards are UX
 * and telemetry, never the security authority — enforcement lives at the API.
 */

import type { Destination } from './router'

/** v2.2 context: flat, everything real. Capability namespaces (ctx.policy,
 *  ctx.security, ctx.tenant, …) are the named v3 growth path — no stubs. */
export interface GuardContext {
  /** Destination path (path-only, normalized) */
  to: string
  /** Origin path, or null on initial load */
  from: string | null
  /** Parsed params for the matched chain (converter outputs, not raw strings) */
  params: Record<string, unknown>
  /** The route id this guard is protecting */
  routeId: string
}

export abstract class Guard {
  /** Pure permission predicate. Base implementation fails closed. */
  static check(ctx: GuardContext): boolean | Promise<boolean> {
    void ctx
    return false
  }

  /** Navigation policy on refusal. Base implementation conceals. */
  static deny(ctx: GuardContext): Destination {
    void ctx
    return { type: 'route-id', target: 'not-found' }
  }

  /** Envelope deadline for check(); exceeding it denies (fail closed). */
  static timeoutMs = 5000
}

/** A concrete guard is the CLASS itself (statics), never an instance. */
export type GuardClass = typeof Guard
