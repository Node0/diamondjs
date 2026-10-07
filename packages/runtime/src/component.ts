/**
 * Component — Base class for all DiamondJS components
 *
 * Subclasses have a createTemplate() instance method injected by the compiler
 * and use 'this' to reference component properties and methods — no 'vm'.
 *
 * Lifecycle (spec §4.4, Lifecycle Contract record): six phases, one callback
 * each — constructing → constructed → mounting → mounted → unmounting →
 * unmounted — and two terminal phases, faulted and disposed, with none. The
 * JS constructor is constructing's callback; the other five are the methods
 * named after their phase. The entry points mount(), unmount() and dispose()
 * are final (LC-3). Every transition is one write: a record appended to the
 * instance's ring and the reactive snapshot (`phase`, `generation`) updated
 * from it (LC-13).
 */

import { DiamondCore, Scope, type ScopeFailure } from './core'
import { adoptDefinedReactiveFields } from './decorators'
import { Print } from '@diamondjs/primafacie'

// prettier-ignore
export type Phase = 'constructing' | 'constructed' | 'mounting' | 'mounted' | 'unmounting' | 'unmounted' | 'faulted' | 'disposed'
// prettier-ignore
export type Cause = 'construct' | 'mount' | 'connect' | 'unmount' | 'dispose' | 'stale' | 'callback-failed'

export interface LifecycleRecord {
  /** Global, monotonic across every instance. */
  seq: number
  /** performance.now() at the transition. */
  t: number
  /** Runtime-assigned instance id. */
  instance: number
  generation: number
  from: Phase
  to: Phase
  cause: Cause
  outcome: 'ok' | 'failed' | 'faulted' | 'stale'
  error?: unknown
  failures?: ScopeFailure[]
}

/** The snapshot a ring folds to: its last record's destination (LC-13, L-32). */
export function fold(history: readonly LifecycleRecord[]): { phase: Phase; generation: number } {
  const last = history[history.length - 1]
  return last ? { phase: last.to, generation: last.generation } : { phase: 'constructing', generation: 0 }
}

/** Per-instance ring size (open decision 2: constant). */
const RING = 32
let seq = 0
let instances = 0
const DETACHED: ReadonlySet<Phase> = new Set(['constructing', 'constructed', 'unmounted', 'disposed'])
/** LC-14: what each outcome emits; a successful transition is STATE in dev builds only. */
const LEVEL: Partial<Record<LifecycleRecord['outcome'], 'CRITICAL' | 'FAILURE' | 'WARNING'>> = { faulted: 'CRITICAL', failed: 'FAILURE', stale: 'WARNING' }
const warnedDetachedRoot = new WeakSet<object>()

function isDev(): boolean {
  return (globalThis as { __DIAMOND_DEV__?: unknown }).__DIAMOND_DEV__ === true
}

/**
 * Component base class
 *
 * @example
 * export class MyComponent extends Component {
 *   name = 'World'
 *
 *   // Compiler-generated from .html template (instance method)
 *   createTemplate() {
 *     const div = document.createElement('div')
 *     DiamondCore.bind(div, 'textContent', () => `Hello, ${this.name}!`)
 *     return div
 *   }
 *
 *   override mounted() { this.getElement()?.querySelector('input')?.focus() }
 * }
 */
export abstract class Component {
  /** The root DOM node of the mounted template (null when not mounted) */
  protected element: HTMLElement | null = null

  private readonly id = ++instances
  /** The reactive snapshot (§5.9): effects may read `phase` / `generation`. */
  private readonly lc = DiamondCore.reactive({ phase: 'constructing' as Phase, generation: 0 })
  private readonly ring: LifecycleRecord[] = []
  /** Instance scope (LC-8): timer cancels and what constructed()/unmounted() acquire. */
  private readonly instanceScope = new Scope()
  /** Mount scope (LC-8): the template, children, range and what the mount callbacks acquire. */
  private mountScope: Scope | null = null
  /** Where a failed mount returns to (§4: constructed first, unmounted on remount). */
  private prior: Phase = 'constructed'
  /** debounce/throttle cancels: run at unmount(), kept for the remount (P-4). */
  private readonly timers = new Set<() => void>()

  constructor() {
    // LC-3: entry points are final. Detected here, at construction, so a
    // subclass written against the four-hook contract fails loud.
    if (this.mount !== Component.prototype.mount || this.unmount !== Component.prototype.unmount) {
      throw new Error(
        `[Diamond] ${this.constructor.name} overrides mount()/unmount(). These are final. ` +
          `Override mounted()/unmounting() instead (spec §4.4).`
      )
    }
  }

  get phase(): Phase {
    return this.lc.phase
  }

  get generation(): number {
    return this.lc.generation
  }

  /** This instance's transition ring (the last 32 records). */
  history(): readonly LifecycleRecord[] {
    return this.ring
  }

  /**
   * Compiler-generated instance method that builds the DOM tree.
   * Uses 'this' to reference component properties and methods.
   *
   * @returns The root HTMLElement for this component
   */
  createTemplate(): HTMLElement {
    throw new Error(
      `${this.constructor.name} must implement createTemplate(). ` +
        'This should be compiler-generated from the .html template.'
    )
  }

  // ── phase callbacks (override these; the base does nothing) ──────────────

  /** @reactive fields operational; instance scope current; no element. Once per instance. */
  protected constructed(): void {}
  /** Mount scope current, generation assigned; no template or children yet. */
  protected mounting(): void {}
  /** Range in the document, bindings applied, root structurals placed, children mounted. */
  protected mounted(): void {}
  /** Range still in the document; generation already invalidated. */
  protected unmounting(): void {}
  /** Range detached, mount inventory empty, state preserved; remount permitted. */
  protected unmounted(): void {}

  // ── entry points (final) ─────────────────────────────────────────────────

  /**
   * First framework entry (§5.6): repair [[Define]]-emitted @reactive fields
   * (#11), open the instance scope and run constructed() once. Idempotent;
   * mount() and the router/D8 construction sites call it.
   */
  ensureConstructed(): void {
    if (this.lc.phase !== 'constructing') return
    adoptDefinedReactiveFields(this)
    try {
      DiamondCore.withScope(this.instanceScope, () => {
        this.transition('constructed', 'construct')
        this.constructed()
      })
    } catch (e) {
      this.transition('faulted', 'construct', e, this.instanceScope.dispose())
      throw e
    }
  }

  /**
   * Mount the component into a host element (§5.2). Builds the template in
   * a fresh mount scope and appends it; when the host is in the document the
   * connection drain runs here and mounted() fires before this returns.
   * Otherwise the component stays `mounting` until an ancestor's drain
   * reaches it (a D8 child), and a root mounted into a detached host is
   * reported once in dev builds — mounted() will not run.
   *
   * @param host - Parent DOM element to append to
   */
  mount(host: HTMLElement): void {
    const name = this.constructor.name
    const phase = this.lc.phase
    if (phase === 'mounting' || phase === 'mounted' || phase === 'unmounting') {
      throw new Error(`[Diamond] ${name} is already mounted (phase '${phase}'). Call unmount() before mounting again — a second mount() would orphan the first DOM subtree (D-6).`)
    }
    if (phase === 'faulted' || phase === 'disposed') {
      throw new Error(`[Diamond] ${name} is ${phase} and cannot be mounted${this.faultDetail()}. Recovery is a fresh instance (LC-11).`)
    }
    const nested = DiamondCore.inScope()
    this.ensureConstructed()
    this.prior = this.lc.phase
    this.lc.generation++
    this.transition('mounting', 'mount')
    const scope = DiamondCore.openScope()
    this.mountScope = scope
    try {
      this.mounting()
      const body = this.createTemplate()
      const range = DiamondCore.trackRange(body)
      scope.add(range.remove)
      scope.nodes = range.nodes
      this.element = body
      host.appendChild(range.node)
      if (host.isConnected) this.deliver()
      else if (!nested && isDev() && !warnedDetachedRoot.has(this.constructor)) {
        warnedDetachedRoot.add(this.constructor)
        Print('WARNING', `[Diamond] ${name} was mounted into a host that is not in the document: mounted() will not run. Root hosts must be connected.`)
      }
    } catch (e) {
      this.rollbackMount(e, 'mount')
      throw e
    } finally {
      DiamondCore.closeScope(scope)
    }
  }

  /**
   * Fold a construction scope's entries into the instance scope (router/D8
   * construction sites, P-5): what a constructor acquired follows the instance.
   * @internal
   */
  adopt(scope: Scope): void {
    for (const fn of scope.list.splice(0)) this.instanceScope.add(fn)
  }

  /**
   * The connection drain reached this component (§5.3): children first, then
   * root-level placements, then the `mounted` transition and callback, all
   * with the mount scope current. A throw anywhere rolls the mount back and
   * propagates to the caller.
   * @internal
   */
  deliver(): void {
    if (this.lc.phase !== 'mounting') return
    const scope = this.mountScope!
    try {
      DiamondCore.drain(scope)
      DiamondCore.withScope(scope, () => {
        this.transition('mounted', 'connect')
        this.mounted()
      })
    } catch (e) {
      this.rollbackMount(e, 'connect')
      throw e
    }
  }

  /** Rollback by inventory (LC-7): dispose the mount scope, return to `prior`. */
  private rollbackMount(error: unknown, cause: Cause): void {
    const scope = this.mountScope
    if (!scope) return
    this.mountScope = null
    this.element = null
    const failures = scope.dispose()
    this.transition(failures.length ? 'faulted' : this.prior, cause, error, failures)
  }

  /**
   * Unmount the component (§5.4): invalidate the generation, run unmounting()
   * with the range still in the document, dispose the mount inventory (LIFO:
   * the range leaves first, then children, then bindings), then unmounted().
   * Callback failures are recorded and teardown continues (LC-12); a cleanup
   * failure faults the instance (LC-10).
   */
  unmount(): void {
    const phase = this.lc.phase
    if (phase !== 'mounted' && phase !== 'mounting') throw new Error(`[Diamond] ${this.constructor.name} is not mounted (phase '${phase}'); nothing to unmount.`)
    this.lc.generation++
    this.transition('unmounting', 'unmount')
    const scope = this.mountScope!
    DiamondCore.withScope(scope, () => this.safeCall(() => this.unmounting()))
    const failures = scope.dispose()
    this.mountScope = null
    this.element = null
    for (const cancel of this.timers) cancel()
    this.transition(failures.length ? 'faulted' : 'unmounted', 'unmount', undefined, failures)
    if (!failures.length) {
      DiamondCore.withScope(this.instanceScope, () => this.safeCall(() => this.unmounted()))
    }
  }

  /**
   * Leave for good (§5.4): unmount if mounted, then close the instance scope.
   * Terminal. The router calls this when an occupant departs, structurals
   * when a branch or row holding a child is removed, app code at teardown.
   */
  dispose(): void {
    const phase = this.lc.phase
    if (phase === 'disposed') return
    if (phase === 'mounted' || phase === 'mounting') this.unmount()
    const failures = this.instanceScope.dispose()
    if (this.lc.phase !== 'faulted') {
      this.transition(failures.length ? 'faulted' : 'disposed', 'dispose', undefined, failures)
    }
  }

  /**
   * Dev-mode verification (§5.5): the snapshot against the DOM. `mounted` ⇔
   * every node of the managed range is in the document; a detached phase ⇔
   * no element and no mount scope.
   */
  domPing(): { phase: Phase; generation: number; connected: boolean; consistent: boolean } {
    const phase = this.lc.phase
    const nodes = this.mountScope?.nodes?.() ?? []
    const connected = nodes.length > 0 && nodes.every((n) => n.isConnected)
    const detached = this.element === null && this.mountScope === null
    const consistent = phase === 'mounted' ? connected : phase === 'mounting' ? !connected : !DETACHED.has(phase) || detached
    return { phase, generation: this.lc.generation, connected, consistent }
  }

  /**
   * Get the component's root element (null if not mounted)
   */
  getElement(): HTMLElement | null {
    return this.element
  }

  // ── registration helpers ─────────────────────────────────────────────────

  /**
   * Register a cleanup against the current lifetime: the mount scope while
   * mounted (disposed by unmount()), else the instance scope (disposed by
   * dispose()).
   *
   * @param cleanup - Function to call at that disposal
   */
  protected registerCleanup(cleanup: () => void): void {
    ;(this.mountScope ?? this.instanceScope).add(cleanup)
  }

  /**
   * Bind a callback to the current mount generation (LC-9). The returned
   * wrapper runs `fn` only while that generation is current; after an
   * unmount() it declines and records `stale`. For rAF, fetch and other
   * callbacks the inventory cannot cancel.
   */
  protected whileMounted<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    const generation = this.lc.generation
    return (...args: A): void => {
      if (generation === this.lc.generation) fn(...args)
      else this.transition(this.lc.phase, 'stale')
    }
  }

  /**
   * Debounce a handler (DDR §4.3, handler timing). Returns a wrapped function
   * that defers `fn` until `ms` of quiet. The pending timer's `cancel` is
   * **self-registered**: it runs at unmount() and is disposed with the scope
   * it was created in (the instance scope for a class-field one-liner, so a
   * remount keeps it), so the call site stays leak-safe:
   *
   *   handleInput = this.debounce((v) => (this.query = v), 500)
   */
  protected debounce<A extends unknown[]>(
    fn: (...args: A) => void,
    ms: number
  ): (...args: A) => void {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    this.timer(cancel)
    return (...args: A): void => {
      cancel()
      timer = setTimeout(() => {
        timer = undefined
        fn(...args)
      }, ms)
    }
  }

  /**
   * Throttle a handler (DDR §4.3, handler timing). Returns a wrapped function
   * that runs `fn` at most once per `ms`, trailing-edge. Like debounce, the
   * pending timer self-registers its `cancel`.
   */
  protected throttle<A extends unknown[]>(
    fn: (...args: A) => void,
    ms: number
  ): (...args: A) => void {
    // -Infinity so the first call always fires on the leading edge,
    // independent of the wall clock's starting value.
    let last = Number.NEGATIVE_INFINITY
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    this.timer(cancel)
    return (...args: A): void => {
      const now = Date.now()
      const remaining = ms - (now - last)
      if (remaining <= 0) {
        cancel()
        last = now
        fn(...args)
      } else if (timer === undefined) {
        timer = setTimeout(() => {
          last = Date.now()
          timer = undefined
          fn(...args)
        }, remaining)
      }
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private timer(cancel: () => void): void {
    this.timers.add(cancel)
    this.registerCleanup(() => {
      cancel()
      this.timers.delete(cancel)
    })
  }

  /** Run a teardown callback; a throw is recorded, never propagated (LC-12). */
  private safeCall(fn: () => void): void {
    try {
      fn()
    } catch (e) {
      this.transition(this.lc.phase, 'callback-failed', e)
    }
  }

  private faultDetail(): string {
    const f = this.ring[this.ring.length - 1]?.failures
    return f?.length ? ` (cleanup #${f[0].index} threw: ${String(f[0].error)})` : ''
  }

  /**
   * The single writer (LC-13): append one record to the ring, apply it to the
   * snapshot, emit per LC-14 — failed transitions FAILURE, faults CRITICAL,
   * stale WARNING, successful ones STATE in dev builds only.
   */
  private transition(to: Phase, cause: Cause, error?: unknown, failures?: ScopeFailure[]): void {
    const from = this.lc.phase
    const outcome = to === 'faulted' ? 'faulted' : cause === 'stale' ? 'stale' : error !== undefined ? 'failed' : 'ok'
    const generation = this.lc.generation
    const record: LifecycleRecord = { seq: ++seq, t: performance.now(), instance: this.id, generation, from, to, cause, outcome }
    if (error !== undefined) record.error = error
    if (failures?.length) record.failures = failures
    if (this.ring.push(record) > RING) this.ring.shift()
    this.lc.phase = to
    const level = LEVEL[outcome] ?? (isDev() ? 'STATE' : null)
    if (level) Print(level, `[Diamond] ${this.constructor.name}#${this.id} ${from} → ${to} (${cause}, ${outcome}, g${generation})${error !== undefined ? `: ${String(error)}` : ''}`)
  }
}
