/**
 * DiamondCore - Central runtime API
 * 
 * All reactive operations go through static methods on this class.
 * This is the primary API surface that compiled templates interact with.
 */

import { reactivityEngine } from './reactivity'
import { SAFE_SINKS, canonicalizeSinkKey, isDataOrAriaKey } from './security'
import { devWarn } from './dev-log'

type CleanupFn = () => void

/** Dev-only flag (bundlers replace process.env.NODE_ENV with a literal). */
let IS_DEV: boolean
try {
  IS_DEV = process.env.NODE_ENV !== 'production'
} catch {
  IS_DEV = true
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
   * Active cleanup scope. When set, bind()/on()/if()/repeat() register their
   * teardown here so a structural directive can dispose a branch's effects and
   * listeners when it removes that subtree. Null at the component root (matching
   * the existing no-auto-cleanup-at-root behavior of compiled templates).
   */
  private static currentScope: CleanupFn[] | null = null

  /** Register a cleanup with the active scope (no-op at the root). */
  private static track(cleanup: CleanupFn): void {
    if (this.currentScope) this.currentScope.push(cleanup)
  }

  /**
   * Run `fn` while collecting every cleanup registered by bind/on/if/repeat
   * during it. Returns the produced value plus a single cleanup that disposes
   * all of them. Used by structural directives to tear down a removed subtree.
   */
  static captureScope<T>(fn: () => T): { value: T; cleanup: CleanupFn } {
    const prev = this.currentScope
    const scope: CleanupFn[] = []
    this.currentScope = scope
    try {
      const value = fn()
      return {
        value,
        cleanup: () => {
          for (const c of scope.splice(0)) {
            try {
              c()
            } catch (error) {
              console.error('[Diamond] Cleanup error:', error)
            }
          }
        },
      }
    } finally {
      this.currentScope = prev
    }
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
    return reactivityEngine.createEffect(fn)
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
      cleanupEffect = this.effect(() => {
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
   * Reactive conditional inclusion (DDR §6.2). Renders the first branch whose
   * `when()` is truthy by inserting it before `anchor`; removes it when none
   * match. Branches are built lazily and cached, so toggling reuses the same
   * subtree. `if` / `else-if` compile to this — there is no sink, no raw, and
   * it is always reactive.
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
    const built: Array<{ node: Node; cleanup: CleanupFn } | null> =
      branches.map(() => null)
    let activeIndex = -1

    // Conditions are read here (before make()) so the master effect tracks their
    // dependencies; make() creates nested effects that reset the active effect.
    const cleanup = this.effect(() => {
      let matched = -1
      for (let i = 0; i < branches.length; i++) {
        if (branches[i].when()) {
          matched = i
          break
        }
      }
      if (matched === activeIndex) return

      // Detach the current branch (kept cached for reuse on re-activation)
      if (activeIndex >= 0) {
        const prev = built[activeIndex]
        ;(prev?.node as ChildNode | undefined)?.remove()
      }
      activeIndex = matched
      if (matched < 0) return

      let entry = built[matched]
      if (!entry) {
        const captured = this.captureScope(() => branches[matched].make())
        entry = { node: captured.value, cleanup: captured.cleanup }
        built[matched] = entry
      }
      anchor.parentNode?.insertBefore(entry.node, anchor)
    })

    this.track(cleanup)
    this.track(() => {
      for (const b of built) b?.cleanup()
    })
  }

  /**
   * Reactive keyed list rendering (DDR §6.3, repeat.for). Builds one subtree per
   * item — keyed by item identity — reusing and reordering nodes across updates
   * and disposing the effects/listeners of removed items.
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
    let current = new Map<unknown, { node: ChildNode; cleanup: CleanupFn }>()

    // itemsGetter() is read first so the master effect tracks the collection.
    const cleanup = this.effect(() => {
      const items = Array.from(itemsGetter() ?? [])
      const next = new Map<unknown, { node: ChildNode; cleanup: CleanupFn }>()
      const parent = anchor.parentNode
      const ordered: ChildNode[] = []

      items.forEach((item, i) => {
        const key: unknown = item
        let entry = current.get(key)
        if (entry) {
          current.delete(key)
        } else {
          const captured = this.captureScope(() => makeItem(item, i))
          entry = {
            node: captured.value as ChildNode,
            cleanup: captured.cleanup,
          }
        }
        next.set(key, entry)
        ordered.push(entry.node)
      })

      // Dispose items that disappeared
      for (const gone of current.values()) {
        gone.node.remove()
        gone.cleanup()
      }

      // Insert / reorder nodes into document order before the anchor
      if (parent) {
        for (const node of ordered) parent.insertBefore(node, anchor)
      }

      current = next
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
   *      dev-only warn-once); `data-*`/`aria-*` pass via the attribute branch.
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

    const cleanup = this.effect(() => {
      const obj = objGetter() ?? {}
      const seen = new Set<string>()

      for (const key of Object.keys(obj)) {
        const value = obj[key] // per-key read — tracked on proxy sources
        const canonical = canonicalizeSinkKey(key)

        // [Diamond] gate FIRST, branch SECOND (DDR §7.1) — unknown keys fail closed
        if (!raw && !SAFE_SINKS.has(canonical) && !isDataOrAriaKey(key)) {
          if (IS_DEV && !warnedKeys.has(key)) {
            warnedKeys.add(key)
            devWarn(
              'DiamondCore.spread',
              `[Diamond] spread: unsafe key '${key}' skipped (fails closed). ` +
                `Declare intent with ...attrs.rawBind if you own every key.`
            )
          }
          continue
        }

        seen.add(key)
        if (canonical in el && !isDataOrAriaKey(key)) {
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

  // NOTE: DiamondCore.delegate() was removed in v2.0 (DDR §6.4) as an orphaned
  // Aurelia-era stub, and returns in v2.1 as a clean-slate design (see delegate()
  // below, added with the Collection/2.1b work).

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
