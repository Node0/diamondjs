/**
 * DiamondCore - Central runtime API
 * 
 * All reactive operations go through static methods on this class.
 * This is the primary API surface that compiled templates interact with.
 */

import { reactivityEngine } from './reactivity'
import { SAFE_SINKS, canonicalizeSinkKey, isInertMetadataKey } from './security'
import { Print } from '@diamondjs/primafacie'
import { Collection, type CollectionOptions } from './collection'
import type { Component } from './component'

type CleanupFn = () => void

export interface ScopeFailure {
  index: number
  error: unknown
}

/**
 * The inventory of one lifetime (Lifecycle Contract LC-7/LC-8). Every
 * framework-owned acquisition made while the scope is current — bind/on/
 * effect cleanups, structural disposers, child instances, tracked ranges,
 * registerCleanup — lands in `list`. Failure recovery and teardown are the
 * same call, `dispose()`: LIFO, each cleanup in its own try, failures
 * collected and returned, the list empty afterwards. `children` (D8 child
 * instances) and `scopes` (structural branches placed while this scope's
 * tree was detached) wait here for the connection drain; `pending` holds
 * root-level structural placements deferred until it.
 */
export class Scope {
  list: CleanupFn[] = []
  children: Component[] = []
  scopes: Scope[] = []
  pending: Array<() => void> = []
  /** The managed range's live nodes (set by Component.mount; read by domPing). */
  nodes: (() => Node[]) | null = null
  /** The scope that was current when this one opened (restored by closeScope). */
  prev: Scope | null = null

  add(fn: CleanupFn): void {
    this.list.push(fn)
  }

  dispose(): ScopeFailure[] {
    const failures: ScopeFailure[] = []
    for (let i = this.list.length - 1; i >= 0; i--) {
      try {
        this.list[i]()
      } catch (error) {
        failures.push({ index: i, error })
      }
    }
    this.list.length = this.children.length = this.scopes.length = this.pending.length = 0
    return failures
  }
}

/**
 * DiamondCore - The main runtime API class
 * 
 * Provides static methods for:
 * - Creating reactive state
 * - Running tracked effects
 * - Binding DOM properties to reactive state
 * - Attaching event handlers
 */
export class DiamondCore {
  /**
   * The current scope. bind()/on()/effect()/if()/switch()/repeat()/spread()/
   * delegate()/child() register their teardown here: a component's mount scope while its template builds, a
   * branch's scope inside a structural's make(). Null outside any component
   * (hand-written templates): acquisitions there are the author's to dispose.
   */
  private static currentScope: Scope | null = null

  /** Register a cleanup with the current scope (no-op outside any scope). */
  private static track(cleanup: CleanupFn): void {
    this.currentScope?.add(cleanup)
  }

  /** Open a fresh scope and make it current. */
  static openScope(): Scope {
    const scope = new Scope()
    scope.prev = this.currentScope
    this.currentScope = scope
    return scope
  }

  /** Restore the scope that was current when `scope` opened. */
  static closeScope(scope: Scope): void {
    this.currentScope = scope.prev
  }

  /** Run `fn` with `scope` current — a lifecycle callback's acquisitions land there. */
  static withScope<T>(scope: Scope, fn: () => T): T {
    const prev = this.currentScope
    this.currentScope = scope
    try {
      return fn()
    } finally {
      this.currentScope = prev
    }
  }

  /** Whether a scope is current, i.e. this call is nested in a framework parent. */
  static inScope(): boolean {
    return this.currentScope !== null
  }

  /**
   * Run `fn` in a fresh scope. Returns the produced value, the scope, and one
   * cleanup that disposes it. Structural directives build each branch this
   * way. A throw inside `fn` disposes what was acquired before it (P-2) and
   * rethrows.
   */
  static captureScope<T>(fn: () => T): { value: T; cleanup: CleanupFn; scope: Scope } {
    const scope = this.openScope()
    try {
      const value = fn()
      return { value, scope, cleanup: () => this.report(scope.dispose()) }
    } catch (e) {
      scope.dispose()
      throw e
    } finally {
      this.closeScope(scope)
    }
  }

  /** A branch has no instance to fault (§4.6); its cleanup failures are recorded through Print (D-26). */
  private static report(failures: ScopeFailure[]): void {
    for (const f of failures) Print('FAILURE', `[Diamond] cleanup #${f.index} threw: ${String(f.error)}`)
  }

  /**
   * Make an object reactive using Proxy
   *
   * Use for: UI state, forms, small datasets (< 1000 items)
   *
   * @example
   * const state = DiamondCore.reactive({ count: 0, name: '' })
   * state.count++ // Triggers effects that read count
   */
  static reactive<T extends object>(obj: T): T {
    return reactivityEngine.createProxy(obj)
  }

  /**
   * Make a specific property reactive on a component instance.
   * Called by compiler-generated constructor code for @reactive properties.
   *
   * For object values: wraps in reactive proxy.
   * For primitives: the compiler generates getter/setter pairs
   * that call effect tracking.
   */
  static makeReactive(target: object, property: string): void {
    const value = (target as Record<string, unknown>)[property]
    if (value !== null && typeof value === 'object') {
      (target as Record<string, unknown>)[property] = this.reactive(value as object)
    }
    // For primitives, the compiler generates getter/setter pairs
    // that integrate with the reactivity engine. No runtime action needed here.
  }

  /**
   * Run a function and re-run it when dependencies change
   * 
   * @example
   * const cleanup = DiamondCore.effect(() => {
   *   console.log('Count is:', state.count)
   * })
   * // Later: cleanup() to stop tracking
   */
  static effect(fn: () => void): CleanupFn {
    const cleanup = reactivityEngine.createEffect(fn)
    this.track(cleanup) // LC-7: an effect is an acquisition of the current scope
    return cleanup
  }

  /** Dev/test-only: effects created and not yet disposed (`__DIAMOND_DEV__`). */
  static __liveEffects(): number {
    return reactivityEngine.liveEffects
  }

  /**
   * Create a computed value that caches and auto-updates
   * 
   * @example
   * const doubled = DiamondCore.computed(() => state.count * 2)
   * console.log(doubled()) // Returns cached value
   */
  static computed<T>(getter: () => T): () => T {
    return reactivityEngine.createComputed(getter)
  }

  /**
   * Bind a DOM element property to a reactive getter
   * Optionally supports two-way binding with a setter
   * 
   * @param element - DOM element to bind
   * @param property - Element property to update (e.g., 'value', 'textContent')
   * @param getter - Function that returns the current value
   * @param setter - Optional function to update state from element (two-way binding)
   * @returns Cleanup function
   * 
   * @example
   * // One-way to-view (model → DOM only)
   * DiamondCore.bind(span, 'textContent', () => this.message)
   *
   * // Two-way (model ↔ DOM)
   * DiamondCore.bind(input, 'value', () => this.name, (v) => this.name = v)
   *
   * // One-way from-view (DOM → model only): NO getter, so the model never
   * // pushes into the sink — preserving the inbound-only contract.
   * DiamondCore.bind(input, 'value', undefined, (v) => this.name = v)
   */
  static bind(
    element: HTMLElement,
    property: string,
    getter: (() => unknown) | undefined,
    setter?: (value: unknown) => void,
    eventName?: string
  ): CleanupFn {
    // Cast element for dynamic property access
    const el = element as unknown as Record<string, unknown>

    // To-view effect: ONLY when a getter is provided. from-view passes no getter,
    // so the model can never write into the sink — a one-way-named flow must not
    // permit the opposite flow (would silently bypass an inbound security boundary).
    // Dashed names (data-*/aria-*) are attributes, not JS properties — they go
    // through setAttribute (null/undefined removes the attribute).
    let cleanupEffect: CleanupFn = () => {}
    if (getter) {
      const isAttribute = property.includes('-')
      cleanupEffect = reactivityEngine.createEffect(() => {
        const value = getter()
        if (isAttribute) {
          if (value == null) element.removeAttribute(property)
          else element.setAttribute(property, String(value))
        } else {
          el[property] = value
        }
      })
    }

    // Set up the inbound (DOM → model) listener if a setter is provided. The
    // sampling event defaults to input/change but can be overridden via
    // value.update-on="blur" (§4.3) — passed through as `eventName`.
    let cleanupListener: CleanupFn | null = null
    if (setter) {
      const event = eventName ?? this.getInputEventName(element)
      const handler = () => {
        const value = el[property]
        setter(value)
      }
      element.addEventListener(event, handler)
      cleanupListener = () => element.removeEventListener(event, handler)
    }

    // Return combined cleanup (and register it with the active scope, if any)
    const cleanup: CleanupFn = () => {
      cleanupEffect()
      cleanupListener?.()
    }
    this.track(cleanup)
    return cleanup
  }

  /**
   * Attach an event listener to an element
   * 
   * @param element - DOM element
   * @param event - Event name (e.g., 'click', 'submit')
   * @param handler - Event handler function
   * @param capture - Use capture phase (default: false)
   * @returns Cleanup function
   * 
   * @example
   * DiamondCore.on(button, 'click', () => this.handleClick())
   */
  static on(
    element: HTMLElement,
    event: string,
    handler: (e: Event) => void,
    capture = false
  ): CleanupFn {
    element.addEventListener(event, handler, capture)
    const cleanup: CleanupFn = () =>
      element.removeEventListener(event, handler, capture)
    this.track(cleanup)
    return cleanup
  }

  /**
   * Reactive conditional inclusion (DDR §6.2, A3). Renders the first branch
   * whose `when()` is truthy by inserting it before `anchor`; removes it when
   * none match. Branches are built lazily; a branch that is toggled off is
   * DISPOSED with its subtree (detached means disposed — the one disposal rule
   * shared with switch()/repeat()) and rebuilt fresh on re-activation.
   * `if` / `else-if` compile to this — there is no sink, no raw, and it is
   * always reactive.
   *
   * @example
   * const a = document.createComment('if')
   * DiamondCore.if(a, [
   *   { when: () => this.isLoading, make: () => buildLoading() },
   *   { when: () => this.hasError,  make: () => buildError() },
   * ])
   */
  static if(
    anchor: Comment,
    branches: Array<{ when: () => boolean; make: () => Node }>
  ): void {
    this.unstable.add(anchor)
    const owner = this.currentScope
    let active: { node: Node; cleanup: CleanupFn } | null = null
    let activeIndex = -1

    // Conditions are read here (before make()) so the master effect tracks their
    // dependencies; make() creates nested effects that reset the active effect.
    const cleanup = reactivityEngine.createEffect(() => {
      let matched = -1
      for (let i = 0; i < branches.length; i++) {
        if (branches[i].when()) {
          matched = i
          break
        }
      }
      if (matched === activeIndex) return

      // Dispose the outgoing branch eagerly (same shape as repeat's
      // gone.cleanup()); its range leaves the DOM first (the scope's last
      // entry, LIFO). It is rebuilt from make() if re-activated.
      if (active) {
        active.cleanup()
        active = null
      }
      activeIndex = matched
      if (matched < 0) return

      const captured = this.captureScope(() => branches[matched].make())
      const range = this.trackRange(captured.value, anchor)
      captured.scope.add(range.remove)
      active = { node: range.node, cleanup: captured.cleanup }
      this.placeBefore(anchor, [range.node], () => (active ? [active.node] : []), [captured.scope], owner)
    })

    this.track(cleanup)
    this.track(() => {
      active?.cleanup()
    })
  }

  /**
   * Insert `nodes` before `anchor` — now when the anchor is in a tree, else
   * later. A structural's master effect runs synchronously inside the
   * if()/switch()/repeat() call that creates it; when that call precedes the
   * anchor's own appendChild (a structural at a template root, which
   * Component.mount() attaches only after createTemplate() returns; or a
   * hand-written template), `anchor.parentNode` is still null and a bare
   * insertBefore would silently drop the first render. Inside a component the
   * placement waits in the owning scope's `pending` and runs in the
   * connection drain (P-3: the nodes are in the document before mounted()
   * runs); outside any scope it runs on the next microtask, as before. The
   * deferred pass re-reads `live()` so a branch replaced or disposed in
   * between is never resurrected, and inserts in current order (re-inserting
   * a placed node before its anchor is a no-op move, so repeat's
   * reorder-while-detached is handled too). After every placement the placed
   * branches' scopes are settled: delivered if the anchor is in the document,
   * else left with the owner for its drain.
   */
  private static placeBefore(
    anchor: Comment,
    nodes: Iterable<Node>,
    live: () => Iterable<Node>,
    scopes: Scope[],
    owner: Scope | null
  ): void {
    const parent = anchor.parentNode
    if (parent) {
      for (const node of nodes) parent.insertBefore(node, anchor)
      this.settle(anchor, scopes, owner)
      return
    }
    const place = (): void => {
      const p = anchor.parentNode
      if (!p) return
      for (const node of live()) p.insertBefore(node, anchor)
      this.settle(anchor, scopes, owner)
    }
    if (owner) owner.pending.push(place)
    else queueMicrotask(place)
  }

  private static settle(anchor: Comment, scopes: Scope[], owner: Scope | null): void {
    if (anchor.isConnected) for (const s of scopes) this.deliverBranch(s)
    else if (owner) owner.scopes.push(...scopes)
  }

  /**
   * The connection drain (Lifecycle Contract §5.3). Runs when a scope's tree
   * reaches the document: child components first (LC-6), then branches that
   * were placed while the tree was detached, then root-level structural
   * placements that waited for a parent. Every delivered child runs its own
   * mounted() before the caller does. Throws through: a direct child whose
   * mounted() fails has rolled itself back, and the failure is the caller's.
   */
  static drain(scope: Scope): void {
    for (const child of scope.children.splice(0)) child.deliver()
    for (const s of scope.scopes.splice(0)) this.deliverBranch(s)
    for (const place of scope.pending.splice(0)) place()
  }

  /**
   * A structural branch contains its children's failures: a child whose
   * mounted() throws has rolled itself back and emitted the failure; the
   * branch is disposed (its nodes leave the DOM, LIFO) and the enclosing
   * component stays mounted and interactive.
   */
  private static deliverBranch(scope: Scope): void {
    try {
      this.drain(scope)
    } catch {
      this.report(scope.dispose())
    }
  }

  /**
   * Instantiate a child component under the current scope (D8, §7). The child
   * is disposed with the scope and delivered child-first when the scope's
   * tree connects; its host is detached at this point, so it stays `mounting`
   * until then.
   */
  static child(instance: Component, host: HTMLElement): void {
    const scope = this.currentScope
    if (scope) {
      scope.add(() => instance.dispose())
      scope.children.push(instance)
    }
    instance.mount(host)
  }

  /**
   * Nodes a mounted range cannot start on: the anchors of if()/switch()/
   * repeat() (output lands BEFORE an anchor) and the first node of each
   * mounted range (a nested branch is replaced when its condition changes).
   * Repeat rows are the third kind — itemRegistry already knows those.
   */
  private static unstable = new WeakSet<Node>()

  /**
   * Track the mounted range of a body (#17). A multi-root body arrives as a
   * DocumentFragment, which is empty once inserted — so the range is held as
   * its first/last node, taken before the insert, and `remove()` walks the
   * siblings between them as they are at removal time. Nodes a nested
   * structural inserts after mount are inside: they land before its anchor,
   * which is one of the roots. The one escape is a body that BEGINS with a
   * nested structural (its anchor, or output it already rendered); only then
   * is an empty comment prepended as a fixed start (returned in `node`, which
   * is what the caller must insert). A single element/text root is its own
   * range and mounts exactly as before.
   *
   * The walk is bounded: it ends at `last`, at `stop` (the owning structural's
   * anchor, never removed) or at the end of the parent, whichever comes first.
   */
  static trackRange(
    body: Node,
    stop?: Node
  ): { node: Node; remove: CleanupFn; nodes: () => Node[] } {
    const isFragment = body.nodeType === 11
    let first = isFragment ? body.firstChild : body
    const last = isFragment ? body.lastChild : body
    let node = body
    if (first && (this.unstable.has(first) || this.itemRegistry.has(first))) {
      const start = document.createComment('')
      if (!isFragment) {
        node = document.createDocumentFragment()
        node.appendChild(body)
      }
      node.insertBefore(start, first)
      first = start
    }
    if (first) this.unstable.add(first)
    const walk = (visit: (n: Node) => void): void => {
      for (let n = first; n && n !== stop; ) {
        const next = n === last ? null : n.nextSibling
        visit(n)
        n = next
      }
    }
    return {
      node,
      remove: () => walk((n) => n.parentNode?.removeChild(n)),
      nodes: () => {
        const out: Node[] = []
        walk((n) => out.push(n))
        return out
      },
    }
  }

  /**
   * Reactive exhaustive multi-state rendering (v2.1, Amendment A1 §7.3 —
   * <switch>/<case>/<default>). The on-value is evaluated ONCE per update, then
   * tested against each case's match predicate in document order; first match
   * wins. `defaultMake` renders when no case matches — its scope is the switch
   * itself (the container the construct purchased), so unlike bare `else` it
   * needs no positional pairing. Branches are built lazily and disposed on
   * detach, exactly like if() (detached means disposed, per A3).
   *
   * @example
   * const a = document.createComment('switch')
   * DiamondCore.switch(a, () => this.status, [
   *   { match: (v) => v === 'loading', make: () => buildLoading() },
   *   { match: (v) => v === 'ready',   make: () => buildReady() },
   * ], () => buildUnexpected())
   */
  static switch(
    anchor: Comment,
    onGetter: () => unknown,
    cases: Array<{ match: (v: unknown) => boolean; make: () => Node }>,
    defaultMake?: () => Node
  ): void {
    this.unstable.add(anchor)
    const owner = this.currentScope
    // Index cases.length denotes the default branch (when present)
    let active: { node: Node; cleanup: CleanupFn } | null = null
    let activeIndex = -1

    // onGetter + match predicates run inside the master effect, so both the
    // on-value's deps and any expression-case deps are tracked (same
    // reads-before-builds reasoning as if()).
    const cleanup = reactivityEngine.createEffect(() => {
      const v = onGetter()
      let matched = -1
      for (let i = 0; i < cases.length; i++) {
        if (cases[i].match(v)) {
          matched = i
          break
        }
      }
      if (matched < 0 && defaultMake) matched = cases.length
      if (matched === activeIndex) return

      // Dispose the outgoing branch eagerly (same shape as repeat's
      // gone.cleanup()); it is rebuilt from make() if re-activated.
      if (active) {
        active.cleanup()
        active = null
      }
      activeIndex = matched
      if (matched < 0) return

      const make = matched === cases.length ? defaultMake! : cases[matched].make
      const captured = this.captureScope(() => make())
      const range = this.trackRange(captured.value, anchor)
      captured.scope.add(range.remove)
      active = { node: range.node, cleanup: captured.cleanup }
      this.placeBefore(anchor, [range.node], () => (active ? [active.node] : []), [captured.scope], owner)
    })

    this.track(cleanup)
    this.track(() => {
      active?.cleanup()
    })
  }

  /**
   * Reactive keyed list rendering (DDR §6.3, repeat.for). Builds one subtree
   * per item — keyed by item identity for objects, by value + occurrence index
   * for primitives (§16 D-2: duplicate primitives must not collapse to one
   * slot) — reusing and reordering nodes across updates and disposing the
   * effects/listeners of removed items.
   *
   * @example
   * const a = document.createComment('repeat')
   * DiamondCore.repeat(a, () => this.users, (user) => buildRow(user))
   */
  static repeat<T>(
    anchor: Comment,
    itemsGetter: () => Iterable<T> | null | undefined,
    makeItem: (item: T, index: number) => Node
  ): void {
    this.unstable.add(anchor)
    const owner = this.currentScope
    let current = new Map<unknown, { node: ChildNode; cleanup: CleanupFn }>()
    const isIdentityKeyed = (item: unknown): boolean =>
      (typeof item === 'object' && item !== null) || typeof item === 'function'

    // itemsGetter() is read first so the master effect tracks the collection.
    const cleanup = reactivityEngine.createEffect(() => {
      const items = Array.from(itemsGetter() ?? [])
      const next = new Map<unknown, { node: ChildNode; cleanup: CleanupFn }>()
      const ordered: ChildNode[] = []
      // Per-pass occurrence counts so the Nth duplicate of a primitive maps
      // stably to the previous pass's Nth duplicate (D-2).
      const occurrences = new Map<unknown, number>()
      const fresh: Scope[] = []

      items.forEach((item, i) => {
        let key: unknown = item
        if (!isIdentityKeyed(item)) {
          const n = occurrences.get(item) ?? 0
          occurrences.set(item, n + 1)
          key = `${typeof item}:${String(item)}#${n}`
        }
        let entry = current.get(key)
        if (entry) {
          current.delete(key)
        } else {
          const captured = this.captureScope(() => makeItem(item, i))
          const node = captured.value as ChildNode
          captured.scope.add(() => node.remove()) // the row leaves the DOM first (LIFO)
          entry = { node, cleanup: captured.cleanup }
          // node → item registry powers delegate() (v2.1, DDR §7.2 / 2.1b)
          this.itemRegistry.set(node, item)
          fresh.push(captured.scope)
        }
        next.set(key, entry)
        ordered.push(entry.node)
      })

      // Dispose items that disappeared
      for (const gone of current.values()) {
        gone.cleanup()
        this.itemRegistry.delete(gone.node)
      }

      // Insert / reorder nodes into document order before the anchor (the
      // deferred pass reads `current`, i.e. the latest pass's rows in order)
      current = next
      this.placeBefore(anchor, ordered, () => Array.from(current.values(), (e) => e.node), fresh, owner)
    })

    this.track(cleanup)
    this.track(() => {
      for (const e of current.values()) e.cleanup()
    })
  }

  /**
   * Attribute spread (v2.1, DDR §7.1): reactively apply an object's keys to an
   * element. Per key, in strict order:
   *
   *   1. GATE FIRST — canonicalize the key, then consult the SAME allowlist the
   *      compiler gates against. Unknown keys fail closed (skipped, with a
   *      dev-only warn-once); inert metadata (`data-*`/`aria-*`/`role`) passes
   *      via the attribute branch.
   *      `raw = true` (…attrs.rawBind) bypasses the gate entirely — developer-
   *      owned, audited as a heavy stink:declared at compile time.
   *   2. BRANCH SECOND — `key in el` → property assignment; else → setAttribute.
   *
   * Keys applied on a previous run but absent now are reconciled: attribute
   * keys are removed; property keys are restored to their pre-spread value.
   * Precedence between spread and sibling bindings is source order (the
   * compiler emits calls in attribute order); after mount, standard reactive
   * semantics apply (last effect to run wins).
   */
  static spread(
    element: HTMLElement,
    objGetter: () => Record<string, unknown> | null | undefined,
    raw = false
  ): CleanupFn {
    const el = element as unknown as Record<string, unknown>
    // key → how it was applied (+ the pre-spread property value to restore)
    const applied = new Map<string, { kind: 'prop' | 'attr'; prior?: unknown }>()
    const warnedKeys = new Set<string>()

    const remove = (key: string, entry: { kind: 'prop' | 'attr'; prior?: unknown }): void => {
      if (entry.kind === 'attr') element.removeAttribute(key)
      else el[canonicalizeSinkKey(key)] = entry.prior
    }

    const cleanup = reactivityEngine.createEffect(() => {
      const obj = objGetter() ?? {}
      const seen = new Set<string>()

      for (const key of Object.keys(obj)) {
        const value = obj[key] // per-key read — tracked on proxy sources
        const canonical = canonicalizeSinkKey(key)

        // [Diamond] gate FIRST, branch SECOND (DDR §7.1) — unknown keys fail closed.
        // The warning is a STINK SIGNAL, prod-visible by design (v2.2, §12.5);
        // warn-once-per-key dedup keeps it from flooding.
        if (!raw && !SAFE_SINKS.has(canonical) && !isInertMetadataKey(key)) {
          if (!warnedKeys.has(key)) {
            warnedKeys.add(key)
            Print(
              'WARNING',
              `[Diamond] spread: unsafe key '${key}' skipped (fails closed). ` +
                `Declare intent with ...attrs.rawBind if you own every key.`
            )
          }
          continue
        }

        seen.add(key)
        if (canonical in el && !isInertMetadataKey(key)) {
          if (!applied.has(key)) {
            applied.set(key, { kind: 'prop', prior: el[canonical] })
          }
          el[canonical] = value
        } else {
          if (!applied.has(key)) applied.set(key, { kind: 'attr' })
          if (value == null) element.removeAttribute(key)
          else element.setAttribute(key, String(value))
        }
      }

      // Reconcile keys applied previously but absent from this run
      for (const [key, entry] of applied) {
        if (!seen.has(key)) {
          remove(key, entry)
          applied.delete(key)
        }
      }
    })

    const fullCleanup: CleanupFn = () => cleanup()
    this.track(fullCleanup)
    return fullCleanup
  }

  /**
   * repeat()'s node → item registry (v2.1). Whatever repeat iterated — reactive
   * proxy items or plain Collection items — is registered against its rendered
   * node; delegate() resolves events back to the item through it. WeakMap
   * semantics: GC'd rows vanish on their own; live removals are deleted eagerly.
   */
  private static itemRegistry = new WeakMap<Node, unknown>()

  /**
   * Data delegation (v2.1, DDR §7.2 / 2.1b) — a clean-slate design, NOT the
   * removed Aurelia stub. ONE listener on a container serves every repeat row
   * beneath it: the event resolves via closest(selector), then walks up to the
   * first node repeat registered, and the handler receives the DATA ITEM —
   * uniformly, whether repeat iterated a reactive array or a Collection (that
   * uniformity IS the homogenization). Per-node listener thrash on huge lists
   * (the huge-DOM/SVG visualization case) disappears.
   *
   * A selector match with no registered item is a no-op (ratified A2 decision).
   *
   * @example
   * DiamondCore.delegate(listEl, 'click', 'li', (item, e, node) => this.select(item))
   */
  static delegate<T = unknown>(
    container: Element,
    eventType: string,
    selector: string,
    handler: (item: T, event: Event, node: Element) => void
  ): CleanupFn {
    const listener = (event: Event): void => {
      const target = event.target as Element | null
      const node = target?.closest(selector)
      if (!node || !container.contains(node)) return
      let cur: Node | null = node
      while (cur && cur !== container) {
        if (this.itemRegistry.has(cur)) {
          handler(this.itemRegistry.get(cur) as T, event, node)
          return
        }
        cur = cur.parentNode
      }
    }
    container.addEventListener(eventType, listener)
    const cleanup: CleanupFn = () =>
      container.removeEventListener(eventType, listener)
    this.track(cleanup)
    return cleanup
  }

  /**
   * Create a Collection (v2.1, DDR §7.2 / 2.1a) — the collection-at-scale
   * primitive: plain (never-proxied) items, coarse-grained version-signal
   * reactivity, O(1) append, O(1) byKey, cached sorted views, batch mutate.
   *
   * @example
   * cogits = DiamondCore.collection(bigJson.cogits, { key: (c) => c.id })
   */
  static collection<T>(
    items?: Iterable<T>,
    options?: CollectionOptions<T>
  ): Collection<T> {
    return new Collection(items, options)
  }

  /**
   * Get the appropriate input event name for two-way binding
   */
  private static getInputEventName(element: HTMLElement): string {
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') {
        return 'change'
      }
      return 'input'
    }
    if (element instanceof HTMLSelectElement) {
      return 'change'
    }
    if (element instanceof HTMLTextAreaElement) {
      return 'input'
    }
    return 'input'
  }
}
