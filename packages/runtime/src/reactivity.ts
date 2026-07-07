/**
 * ReactivityEngine - Proxy-based reactivity system
 *
 * Provides automatic dependency tracking and effect re-execution
 * when reactive state changes.
 */

import { scheduler } from './scheduler'
import { devWarn } from './dev-log'

type EffectFn = () => void
type CleanupFn = () => void

/**
 * Sentinel dependency key for key-set iteration (Object.keys / for...in /
 * spread sources). Tracked by the ownKeys trap; triggered when a key is added
 * or deleted — so an effect that enumerates a reactive object re-runs when its
 * SHAPE changes, not just its values. (v2.1, required by DiamondCore.spread.)
 */
export const ITERATE_KEY: unique symbol = Symbol('diamond.iterate')

// Inbound smell-check heuristics (hoisted — the set trap is hot-path)
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/
const CANONICAL_PHONE_RE = /^\d{10}$/

/**
 * Dev-only flag for the inbound smell check (DDR §3.3 row 3). Evaluated once; in
 * a production bundle `process.env.NODE_ENV` is replaced with the literal, so the
 * hot-path cost in prod is a single boolean.
 */
let IS_DEV: boolean
try {
  IS_DEV = process.env.NODE_ENV !== 'production'
} catch {
  IS_DEV = true
}

/**
 * ReactivityEngine - Internal engine for reactive state management
 *
 * Uses ES6 Proxy for transparent property access tracking.
 * Dependencies are tracked automatically when effects read reactive properties.
 */
export class ReactivityEngine {
  /** Currently executing effect (for dependency tracking) */
  private activeEffect: EffectFn | null = null

  /** Map of object -> property -> Set of dependent effects */
  private dependencies = new WeakMap<object, Map<PropertyKey, Set<EffectFn>>>()

  /** Track which dependency sets each effect belongs to (for cleanup) */
  private effectDeps = new WeakMap<EffectFn, Set<Set<EffectFn>>>()

  /** Proxy cache — ensures referential identity for deep reactivity */
  private proxyCache = new WeakMap<object, object>()

  /** Properties already warned by the inbound smell check (warn-once) */
  private smellWarned = new WeakMap<object, Set<PropertyKey>>()

  /**
   * Create a reactive proxy for an object.
   * Uses WeakMap cache to ensure the same proxy is returned for
   * the same underlying object (referential identity).
   *
   * @param obj - Plain object to make reactive
   * @returns Proxy that tracks reads and triggers updates on writes
   */
  createProxy<T extends object>(obj: T): T {
    // Return cached proxy if one exists
    if (this.proxyCache.has(obj)) {
      return this.proxyCache.get(obj) as T
    }

    const proxy = new Proxy(obj, {
      get: (target, prop, receiver) => {
        this.trackDependency(target, prop)
        const value = Reflect.get(target, prop, receiver)
        // Deep reactivity: lazily wrap nested objects
        if (value !== null && typeof value === 'object') {
          return this.createProxy(value) // Cache handles dedup
        }
        return value
      },
      set: (target, prop, value, receiver) => {
        const hadKey = Reflect.has(target, prop)
        const oldValue = Reflect.get(target, prop, receiver)
        const result = Reflect.set(target, prop, value, receiver)
        if (oldValue !== value) {
          if (IS_DEV) this.checkInboundSmell(target, prop, oldValue, value)
          this.triggerEffects(target, prop)
          // A NEW key changes the object's shape — wake key-set iterators
          if (!hadKey) this.triggerEffects(target, ITERATE_KEY)
        }
        return result
      },
      ownKeys: (target) => {
        // Object.keys / for...in inside an effect tracks the key SET
        this.trackDependency(target, ITERATE_KEY)
        return Reflect.ownKeys(target)
      },
      deleteProperty: (target, prop) => {
        const hadKey = Reflect.has(target, prop)
        const result = Reflect.deleteProperty(target, prop)
        if (hadKey && result) {
          this.triggerEffects(target, prop)
          this.triggerEffects(target, ITERATE_KEY)
        }
        return result
      }
    })

    // Cache for referential identity
    this.proxyCache.set(obj, proxy)
    return proxy
  }

  /**
   * Track a dependency between the active effect and a property
   */
  private trackDependency(target: object, prop: PropertyKey): void {
    if (!this.activeEffect) return

    let depsMap = this.dependencies.get(target)
    if (!depsMap) {
      depsMap = new Map()
      this.dependencies.set(target, depsMap)
    }

    let dep = depsMap.get(prop)
    if (!dep) {
      dep = new Set()
      depsMap.set(prop, dep)
    }

    dep.add(this.activeEffect)

    // Track which sets this effect belongs to (for cleanup)
    let effectSets = this.effectDeps.get(this.activeEffect)
    if (!effectSets) {
      effectSets = new Set()
      this.effectDeps.set(this.activeEffect, effectSets)
    }
    effectSets.add(dep)
  }

  /**
   * Trigger all effects that depend on a property
   */
  private triggerEffects(target: object, prop: PropertyKey): void {
    const depsMap = this.dependencies.get(target)
    if (!depsMap) return

    const dep = depsMap.get(prop)
    if (dep) {
      for (const effect of dep) {
        scheduler.queueEffect(effect)
      }
    }
  }

  /**
   * Inbound smell check (DDR §3.3 row 3 / §5.1) — a THIN runtime backstop.
   *
   * Flags a display-formatted string overwriting a numeric model value (e.g.
   * "$1,250.00" written over 1234.56) — the corruption a two-way binding without
   * a `parse` causes. This is NOT the compile-time `stink:warn`; it is a distinct
   * runtime channel, dev-only, warn-once-per-property. It only catches the
   * number→non-numeric-string row; the real defense is §5.6 compile-time
   * parse-required (a non-throwing string→string corruption can't be caught here).
   */
  private checkInboundSmell(
    target: object,
    prop: PropertyKey,
    oldValue: unknown,
    newValue: unknown
  ): void {
    // All three rules require a string inbound value — cheapest guard first.
    if (typeof newValue !== 'string') return

    // §5.1 row 1: number overwritten by a non-numeric string ("$1,250.00" over 1234.56)
    let reason: string | null = null
    if (typeof oldValue === 'number' && Number.isNaN(Number(newValue))) {
      reason =
        `held a number but received the non-numeric string ${JSON.stringify(newValue)}`
    } else if (typeof oldValue === 'string') {
      // v2.1 widening (user-ratified; §5.1 calls these rows "invisible by
      // design" — this is a best-effort, dev-only, heuristic backstop; false
      // positives are accepted as dev noise):
      // §5.1 row 2: canonical ISO date string overwritten by a locale-formatted one
      if (
        ISO_DATE_RE.test(oldValue) &&
        newValue.includes('/') &&
        /\d/.test(newValue)
      ) {
        reason =
          `held a canonical ISO date but received the display-formatted string ${JSON.stringify(newValue)}`
      }
      // §5.1 row 3: canonical 10-digit phone overwritten by a formatted one
      else if (CANONICAL_PHONE_RE.test(oldValue) && /\D/.test(newValue)) {
        reason =
          `held a canonical 10-digit string but received the formatted string ${JSON.stringify(newValue)}`
      }
    }
    if (!reason) return

    let warned = this.smellWarned.get(target)
    if (!warned) {
      warned = new Set()
      this.smellWarned.set(target, warned)
    }
    if (warned.has(prop)) return
    warned.add(prop)

    devWarn(
      'ReactivityEngine.checkInboundSmell',
      `[Diamond] inbound corruption: property '${String(prop)}' ${reason}. ` +
        `A display-formatted value is leaking into the model — a two-way binding likely needs a parse (DDR §5.1). ` +
        `This is a thin backstop; the real defense is compile-time parse-required (§5.6).`
    )
  }

  /**
   * Run a function and track its dependencies
   * Re-runs the function when any dependency changes
   * 
   * @param fn - Effect function to track and execute
   * @returns Cleanup function to stop tracking
   */
  createEffect(fn: EffectFn): CleanupFn {
    const effectFn = () => {
      this.activeEffect = effectFn
      try {
        fn()
      } finally {
        this.activeEffect = null
      }
    }

    // Run immediately to collect dependencies
    effectFn()

    // Return cleanup function
    return () => this.cleanupEffect(effectFn)
  }

  /**
   * Create a computed value that caches and auto-updates
   * 
   * @param getter - Function that computes the value
   * @returns Getter function that returns cached value
   */
  createComputed<T>(getter: () => T): () => T {
    let cached: T
    let dirty = true

    const effect = () => {
      if (dirty) {
        this.activeEffect = effect
        try {
          cached = getter()
        } finally {
          this.activeEffect = null
        }
        dirty = false
      }
    }

    // Mark as dirty when dependencies change
    this.createEffect(() => {
      dirty = true
      getter() // Track dependencies
    })

    return () => {
      if (dirty) effect()
      return cached
    }
  }

  /**
   * Remove an effect from all dependency sets
   */
  private cleanupEffect(effect: EffectFn): void {
    const effectSets = this.effectDeps.get(effect)
    if (effectSets) {
      for (const dep of effectSets) {
        dep.delete(effect)
      }
      this.effectDeps.delete(effect)
    }
  }

}

// Singleton instance
export const reactivityEngine = new ReactivityEngine()
