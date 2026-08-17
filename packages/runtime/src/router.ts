/**
 * Router — the v2.2 navigation pipeline (§3.1, normative order):
 *
 *   1. TRIGGER    — navigation gets a monotonic ID
 *   2. RECOGNIZE  — specificity match + converter param parsing
 *   3. PLAN       — Map<outletName, matchedRoute> from the chain
 *   4. GUARDS     — all guards, chain order (parent first), awaited to
 *                   completion before anything mounts or constructs;
 *                   runs on EVERY vector (push, initial, popstate)
 *   5. RACE CHECK — nav ID still current, else discard silently
 *   6. HISTORY    — pushState stamped { diamondNavId, index }
 *   7. COMMIT     — diff vs occupancy; unmount deepest-first, mount
 *                   parent-first, synchronous; mount failure leaves the
 *                   previous route intact
 *   8. SETTLE     — one Print('STATE') narration per navigation
 *
 * The Router is the SOLE history writer: transports and app code request
 * navigation via router.navigate(), never touch history directly.
 *
 * Matching is SPECIFICITY, never declaration order: segment-wise
 * left-to-right, static beats param; '*' matches last regardless of
 * position. Reordering route blocks never changes behavior. Matching is
 * path-only: trailing-slash-insensitive, static segments case-sensitive,
 * query params never participate (an optional per-route `query` converter
 * map parses them through ParseResult; otherwise they pass through raw as
 * an app concern).
 *
 * Outlets are a CLOSED WORLD: <outlet name="x"> compiles as an ordinary
 * element; the router discovers declared outlets at mount time. A route may
 * target only a root-declared outlet or one declared by an ancestor route's
 * component. No public dynamic registration.
 *
 * Params are CONSTRUCTOR CONSTANTS: new RouteComponent(params). A param
 * change is unmount + remount, always. Divergent-from-forms policy, stated:
 * forms keep-last-good on invalid parse; the router FAILS THE MATCH.
 */

import { Component } from './component'
import { Guard, type GuardClass, type GuardContext, type Deny } from './guard'
import { Pending } from './pending'
import { Print } from '@diamondjs/primafacie'

export type RouteId = string

/** Converter contract for :segment params — same ParseResult shape as from-view. */
interface ParamConverter {
  parse(raw: string): { valid: boolean; value: unknown | null }
}

type RouteComponentClass = new (params?: Record<string, unknown>) => Component

export type RouteDefinition =
  | { path: string; redirect: RouteId }
  | {
      path: string
      component: RouteComponentClass
      outlet: string
      params?: Record<string, ParamConverter>
      query?: Record<string, ParamConverter>
      guard?: GuardClass | GuardClass[]
      children?: RouteMap
    }

export type RouteMap = Record<RouteId, RouteDefinition>

/** A flattened route: resolved full path + parent chain. */
interface FlatRoute {
  id: RouteId
  def: RouteDefinition
  parent: FlatRoute | null
  segments: string[]
  fullPath: string
  depth: number
}

interface Recognition {
  leaf: FlatRoute
  /** Component routes, parent first (redirects already resolved away). */
  chain: FlatRoute[]
  params: Record<string, unknown>
}

interface OutletEntry {
  element: HTMLElement
  ownerRouteId: RouteId | null // null = root-declared
  active: Component | null
}

interface Occupant {
  routeId: RouteId
  component: Component
  paramsKey: string
  depth: number
}

type NavVector = 'push' | 'initial' | 'popstate'

const TIMEOUT: unique symbol = Symbol('guard-timeout')

function isDev(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    (globalThis as { __DIAMOND_DEV__?: unknown }).__DIAMOND_DEV__ === true
  )
}

export class Router {
  private flat: FlatRoute[] = []
  private byId = new Map<RouteId, FlatRoute>()
  private outlets = new Map<string, OutletEntry>()
  private occupancy = new Map<string, Occupant>()
  private navSeq = 0
  private historyIndex = 0
  private currentPath: string | null = null
  private narrate = true
  private started = false

  constructor(routes: RouteMap) {
    this.flatten(routes, null)
  }

  /** Quiet (or re-enable) the per-navigation settle narration. */
  configure(options: { narrate?: boolean }): void {
    if (options.narrate !== undefined) this.narrate = options.narrate
  }

  /**
   * Start routing: discover root-declared outlets, install the popstate
   * listener and the link interceptor, print the dev route table, and run
   * the pipeline for the initial location (guards run on this vector too).
   */
  async start(root: ParentNode = document): Promise<void> {
    if (this.started) return
    this.started = true
    this.discoverOutlets(root, null)
    window.addEventListener('popstate', this.onPopstate)
    document.addEventListener('click', this.onClick)
    if (isDev()) this.printRouteTable()
    await this.run(this.readLocation(), 'initial')
  }

  /** Detach listeners and unmount everything (deepest-first). */
  stop(): void {
    if (!this.started) return
    this.started = false
    window.removeEventListener('popstate', this.onPopstate)
    document.removeEventListener('click', this.onClick)
    const occupied = [...this.occupancy.entries()].sort(
      (a, b) => b[1].depth - a[1].depth
    )
    for (const [name, occ] of occupied) this.unmountOutlet(name, occ)
  }

  /**
   * Request a navigation (the only way anything moves). Phase-1 check: with
   * active Pending holds, confirm departure and abort cleanly on decline.
   */
  async navigate(path: string): Promise<void> {
    if (Pending.active) {
      const ok = window.confirm(
        `You have unsaved work (${Pending.labels().join(', ')}). Leave anyway?`
      )
      if (!ok) {
        Print('STATE', `nav to ${path} declined (Pending holds active)`)
        return
      }
    }
    await this.run(this.normalize(path), 'push')
  }

  // ────────────────────────────── the pipeline ──────────────────────────────

  private async run(
    path: string,
    vector: NavVector,
    denyDepth = 0
  ): Promise<void> {
    // 1. TRIGGER
    const navId = ++this.navSeq

    // 2. RECOGNIZE
    const recognized = this.recognize(path)
    if (!recognized) {
      Print('WARNING', `no route matched '${path}' (and no '*' route declared)`)
      return
    }

    // 3. PLAN
    const plan = new Map<string, { route: FlatRoute; params: Record<string, unknown> }>()
    for (const route of recognized.chain) {
      const def = route.def as Extract<RouteDefinition, { component: unknown }>
      plan.set(def.outlet, { route, params: recognized.params })
    }

    // 4. GUARD PHASE — chain order (parent first), awaited to completion
    //    before anything mounts or constructs. Runs on every vector.
    for (const route of recognized.chain) {
      const def = route.def as Extract<RouteDefinition, { component: unknown }>
      const guards = def.guard
        ? Array.isArray(def.guard)
          ? def.guard
          : [def.guard]
        : []
      for (const guard of guards) {
        const ctx: GuardContext = {
          to: path,
          from: this.currentPath,
          params: recognized.params,
          routeId: route.id,
        }
        const verdict = await Router.runGuardEnvelope(guard, ctx)
        if (verdict !== true) {
          if (navId !== this.navSeq) return // superseded while guarding
          await this.executeDeny(verdict, path, vector, denyDepth)
          return
        }
      }
    }

    // 5. RACE CHECK — a newer navigation supersedes this one, silently.
    if (navId !== this.navSeq) return

    // 6. HISTORY WRITE — stamped for canLeave forward-compatibility.
    if (vector === 'push') {
      this.historyIndex++
      history.pushState(
        { diamondNavId: navId, index: this.historyIndex },
        '',
        path
      )
    } else {
      history.replaceState(
        { diamondNavId: navId, index: this.historyIndex },
        '',
        path
      )
    }

    // 7. COMMIT — synchronous; mount failure preserves the previous route
    //    (commit rolls the DOM back; the URL is restored here).
    try {
      this.commit(plan)
    } catch (e) {
      Print(
        'EXCEPTION',
        `commit failed for '${path}': ${String(e)} — previous route preserved`
      )
      if (this.currentPath !== null) {
        history.replaceState(
          { diamondNavId: navId, index: this.historyIndex },
          '',
          this.currentPath
        )
      }
      return
    }
    this.currentPath = path

    // 8. SETTLE
    if (this.narrate) {
      Print('STATE', `nav → ${path} [${[...plan.keys()].join(', ')}]`)
    }
  }

  // ─────────────────────────────── recognize ───────────────────────────────

  private recognize(path: string, depth = 0): Recognition | null {
    if (depth > 10) {
      Print('FAILURE', `redirect resolution exceeded 10 hops at '${path}'`)
      return null
    }
    const segments = this.split(path)
    let best: { route: FlatRoute; params: Record<string, unknown> } | null = null

    for (const route of this.flat) {
      const params = this.match(route, segments)
      if (params === null) continue // includes converter parse failures
      if (!best || this.moreSpecific(route, best.route)) {
        best = { route, params }
      }
    }
    if (!best) return null

    // Redirects resolve by route id; chains are followed, cycles guarded
    // (route-check catches them at build time; this is the runtime backstop).
    const visited = new Set<RouteId>()
    let target = best.route
    while ('redirect' in target.def) {
      if (visited.has(target.id)) {
        Print('FAILURE', `redirect cycle at route '${target.id}'`)
        return null
      }
      visited.add(target.id)
      const next = this.byId.get(target.def.redirect)
      if (!next) {
        Print('FAILURE', `unknown redirect target '${target.def.redirect}' from '${target.id}'`)
        return null
      }
      target = next
    }
    if (target !== best.route) {
      // Re-recognize the target's own full path (redirect targets are static).
      return this.recognize(target.fullPath, depth + 1)
    }

    const chain: FlatRoute[] = []
    for (let r: FlatRoute | null = target; r; r = r.parent) chain.unshift(r)
    return { leaf: target, chain, params: best.params }
  }

  /** Match URL segments against one route; parse :params through converters.
   *  Returns parsed params, or null for no-match (a failed ParseResult IS a
   *  failed match — it falls through toward not-found). */
  private match(route: FlatRoute, url: string[]): Record<string, unknown> | null {
    const pattern = route.segments
    const params: Record<string, unknown> = {}
    const def = route.def as Partial<Extract<RouteDefinition, { component: unknown }>>

    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i]
      if (p === '*') return this.parseQuery(def, params) // consumes the rest
      if (i >= url.length) return null
      if (p.startsWith(':')) {
        const name = p.slice(1)
        const converter = def.params?.[name]
        if (converter) {
          const r = converter.parse(url[i])
          if (!r.valid) return null
          params[name] = r.value
        } else {
          params[name] = url[i] // route-check enforces converter presence
        }
      } else if (p !== url[i]) {
        return null // static segments: case-sensitive exact
      }
    }
    if (url.length !== pattern.length) return null
    return this.parseQuery(def, params)
  }

  /** Optional per-route query converter map (§3.3). Query params never
   *  participate in matching; undeclared ones pass through raw (app concern). */
  private parseQuery(
    def: Partial<Extract<RouteDefinition, { component: unknown }>>,
    params: Record<string, unknown>
  ): Record<string, unknown> | null {
    if (!def.query) return params
    const search = new URLSearchParams(
      typeof location !== 'undefined' ? location.search : ''
    )
    for (const [name, converter] of Object.entries(def.query)) {
      const raw = search.get(name)
      if (raw === null) continue
      const r = converter.parse(raw)
      if (!r.valid) return null
      params[name] = r.value
    }
    return params
  }

  /** Segment-wise specificity, left-to-right: static > :param > '*'.
   *  '*' ranks last regardless of position. Declaration order NEVER decides
   *  (equal specificity over the same shape is an ambiguous-routes build
   *  error in route-check). */
  private moreSpecific(a: FlatRoute, b: FlatRoute): boolean {
    // static(3) > :param(2) > pattern-exhausted(1) > '*'(0): when two patterns
    // match the same URL and one is exhausted where the other continues, the
    // continuing one can only be a wildcard tail — the exact match wins.
    const rank = (s: string): number => (s === '*' ? 0 : s.startsWith(':') ? 2 : 3)
    const as = a.segments
    const bs = b.segments
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      const ra = i < as.length ? rank(as[i]) : 1
      const rb = i < bs.length ? rank(bs[i]) : 1
      if (ra !== rb) return ra > rb
    }
    return false
  }

  // ──────────────────────────── guard envelope ─────────────────────────────

  /**
   * The envelope is a PRIVATE STATIC (not an overridable Guard method — JS
   * cannot seal statics): fail-closed on throw, fail-closed on timeout, one
   * structured narration line per decision, result normalization
   * (false → guard.deny(ctx)).
   */
  private static async runGuardEnvelope(
    guard: GuardClass,
    ctx: GuardContext
  ): Promise<true | Deny> {
    const t0 = Date.now()
    let outcome: true | Deny
    let word: string
    let reason = ''
    try {
      const verdict = await Router.withTimeout(
        Promise.resolve(guard.check(ctx)),
        guard.timeoutMs ?? Guard.timeoutMs
      )
      if (verdict === true) {
        outcome = true
        word = 'allow'
      } else {
        outcome = guard.deny(ctx)
        word = 'deny'
        reason = 'check returned false'
      }
    } catch (e) {
      if (e === TIMEOUT) {
        Print('FAILURE', `guard ${guard.name} timed out after ${guard.timeoutMs}ms — denying (fail closed)`)
        reason = `timeout after ${guard.timeoutMs}ms`
      } else {
        Print('EXCEPTION', `guard ${guard.name} check() threw: ${String(e)} — denying (fail closed)`)
        reason = `check threw: ${String(e)}`
      }
      outcome = guard.deny(ctx)
      word = 'deny'
    }
    Print(
      'STATE',
      `guard ${guard.name} route '${ctx.routeId}' → ${word}` +
        `${reason ? ` (${reason})` : ''} [${Date.now() - t0}ms]`
    )
    return outcome
  }

  private static withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(TIMEOUT), ms)
      work.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        }
      )
    })
  }

  /**
   * A Deny is DATA the router executes — never a guard side effect.
   * External = IdP handoff (location.assign, logged). Location resolves by
   * vector: a denied pushState nav wrote nothing (clean abort), so the deny
   * target is a fresh push; initial load / popstate resolve via replaceState
   * so no denied entry lingers.
   */
  private async executeDeny(
    deny: Deny,
    deniedPath: string,
    vector: NavVector,
    denyDepth: number
  ): Promise<void> {
    if ('external' in deny) {
      Print('STATE', `deny → external handoff: ${deny.external}`)
      location.assign(deny.external)
      return
    }
    if (denyDepth >= 5) {
      Print('CRITICAL', `deny chain exceeded 5 hops at '${deny.path}' — giving up`)
      return
    }
    if (this.normalize(deny.path) === this.normalize(deniedPath)) return
    const redirectVector: NavVector = vector === 'push' ? 'push' : vector
    await this.run(this.normalize(deny.path), redirectVector, denyDepth + 1)
  }

  // ────────────────────────────── commit ───────────────────────────────────

  /**
   * Transactional by ordering: (a) all incoming components CONSTRUCT first —
   * a constructor throw aborts with the previous route fully intact; (b)
   * outgoing unmount deepest-first; (c) incoming mount parent-first,
   * discovering each component's declared outlets as it lands. A mount throw
   * rolls back: newly mounted unmount, previous occupants remount.
   */
  private commit(
    plan: Map<string, { route: FlatRoute; params: Record<string, unknown> }>
  ): void {
    // Diff vs occupancy: same route + same params = keep (params are
    // constructor constants — a param change is unmount + remount, always).
    const incoming: Array<{
      outlet: string
      route: FlatRoute
      params: Record<string, unknown>
      paramsKey: string
    }> = []
    for (const [outlet, { route, params }] of plan) {
      const paramsKey = JSON.stringify(params)
      const occ = this.occupancy.get(outlet)
      if (occ && occ.routeId === route.id && occ.paramsKey === paramsKey) continue
      incoming.push({ outlet, route, params, paramsKey })
    }
    const keepIds = new Set(
      [...plan.values()].map(({ route, params }) => `${route.id}|${JSON.stringify(params)}`)
    )
    const outgoing = [...this.occupancy.entries()]
      .filter(([, occ]) => !keepIds.has(`${occ.routeId}|${occ.paramsKey}`))
      .sort((a, b) => b[1].depth - a[1].depth) // deepest first

    // (a) Construct all incoming first — throw here leaves everything intact.
    const constructed = incoming
      .map((inc) => ({
        ...inc,
        component: new (inc.route.def as Extract<RouteDefinition, { component: unknown }>).component(
          inc.params
        ) as Component,
      }))
      .sort((a, b) => a.route.depth - b.route.depth) // parent first

    // (b) Unmount outgoing, deepest-first.
    const removed: Array<[string, Occupant]> = []
    for (const [name, occ] of outgoing) {
      this.unmountOutlet(name, occ)
      removed.push([name, occ])
    }

    // (c) Mount incoming, parent-first, synchronously.
    const mounted: Array<{ outlet: string; component: Component; routeId: RouteId }> = []
    try {
      for (const inc of constructed) {
        const entry = this.outlets.get(inc.outlet)
        if (!entry) {
          throw new Error(
            `[Diamond] outlet '${inc.outlet}' for route '${inc.route.id}' is not mounted ` +
              `(outlets are a closed, statically-declared world)`
          )
        }
        inc.component.mount(entry.element)
        entry.active = inc.component
        this.discoverOutlets(inc.component.getElement()!, inc.route.id)
        this.occupancy.set(inc.outlet, {
          routeId: inc.route.id,
          component: inc.component,
          paramsKey: inc.paramsKey,
          depth: inc.route.depth,
        })
        mounted.push({ outlet: inc.outlet, component: inc.component, routeId: inc.route.id })
      }
    } catch (e) {
      // Roll back: unmount what just mounted (deepest-first), remount what
      // was removed (parent-first). Previous route stays the visible truth.
      for (const m of [...mounted].reverse()) {
        const occ = this.occupancy.get(m.outlet)
        if (occ) this.unmountOutlet(m.outlet, occ)
      }
      for (const [name, occ] of [...removed].sort((a, b) => a[1].depth - b[1].depth)) {
        const entry = this.outlets.get(name)
        if (!entry) continue
        occ.component.mount(entry.element)
        entry.active = occ.component
        this.discoverOutlets(occ.component.getElement()!, occ.routeId)
        this.occupancy.set(name, occ)
      }
      throw e
    }
  }

  private unmountOutlet(name: string, occ: Occupant): void {
    occ.component.unmount()
    this.occupancy.delete(name)
    const entry = this.outlets.get(name)
    if (entry) entry.active = null
    // Outlet entries declared BY the unmounting route leave with it.
    for (const [outletName, outletEntry] of this.outlets) {
      if (outletEntry.ownerRouteId === occ.routeId) this.outlets.delete(outletName)
    }
  }

  /** Register <outlet name="..."> elements under `root` (closed world:
   *  discovery happens only here — at root start and at route mount). */
  private discoverOutlets(root: ParentNode, ownerRouteId: RouteId | null): void {
    const found = (root as Element).querySelectorAll?.('outlet') ?? []
    for (const el of found) {
      const name = el.getAttribute('name')
      if (!name) {
        Print('WARNING', `<outlet> without a name attribute ignored (closed world)`)
        continue
      }
      this.outlets.set(name, {
        element: el as HTMLElement,
        ownerRouteId,
        active: null,
      })
    }
  }

  // ─────────────────────────── links & startup ─────────────────────────────

  /** Link pattern (spec §6.3, verbatim authority): static href + interceptor.
   *  Same-origin, primary button, no modifier keys → preventDefault +
   *  navigate(). Middle-click / modifiers / external pass through untouched. */
  private onClick = (e: MouseEvent): void => {
    if (e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const target = e.target as Element | null
    const anchor = target?.closest?.('a[href]')
    if (!anchor) return
    const href = anchor.getAttribute('href')!
    const url = new URL(href, location.href)
    if (url.origin !== location.origin) return
    e.preventDefault()
    void this.navigate(url.pathname)
  }

  private onPopstate = (): void => {
    // Known gap (recorded): SPA Back is not intercepted — that is the
    // deferred canLeave problem. Departure with active holds narrates.
    if (Pending.active) {
      Print('WARNING', `departure with active holds: ${Pending.labels().join(', ')}`)
    }
    void this.run(this.readLocation(), 'popstate')
  }

  /** Dev-only startup route table: line-oriented (greppable, survives
   *  wsSink) — one Print('STATE') per route row, tree flattened with
   *  indentation. Absent in prod (isDev() is false). */
  private printRouteTable(): void {
    Print('STATE', 'route table: id | path | outlet | params | guards | redirect')
    for (const route of this.flat) {
      const pad = '  '.repeat(route.depth)
      const def = route.def
      if ('redirect' in def) {
        Print('STATE', `${pad}${route.id} | ${route.fullPath} | → redirect '${def.redirect}'`)
        continue
      }
      const params = Object.entries(def.params ?? {})
        .map(([k, v]) => `${k}:${(v as { name?: string }).name ?? 'converter'}`)
        .join(',')
      const guards = (def.guard ? (Array.isArray(def.guard) ? def.guard : [def.guard]) : [])
        .map((g) => g.name)
        .join(',')
      Print(
        'STATE',
        `${pad}${route.id} | ${route.fullPath} | ${def.outlet}` +
          ` | ${params || '-'} | ${guards || '-'} | -`
      )
    }
  }

  // ────────────────────────────── plumbing ─────────────────────────────────

  private flatten(routes: RouteMap, parent: FlatRoute | null): void {
    for (const [id, def] of Object.entries(routes)) {
      const own = this.split(def.path)
      const segments = parent ? [...parent.segments, ...own] : own
      const flat: FlatRoute = {
        id,
        def,
        parent,
        segments,
        fullPath: '/' + segments.join('/'),
        depth: parent ? parent.depth + 1 : 0,
      }
      this.flat.push(flat)
      this.byId.set(id, flat)
      if ('children' in def && def.children) this.flatten(def.children, flat)
    }
  }

  /** Path-only, trailing-slash-insensitive normalization. */
  private normalize(path: string): string {
    const pathOnly = path.split(/[?#]/)[0]
    const segments = this.split(pathOnly)
    return '/' + segments.join('/')
  }

  private split(path: string): string[] {
    return path.split('/').filter((s) => s.length > 0)
  }

  private readLocation(): string {
    return this.normalize(location.pathname)
  }
}
