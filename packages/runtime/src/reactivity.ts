/**
 * ReactivityEngine - Proxy-based reactivity system
 *
 * Provides automatic dependency tracking and effect re-execution
 * when reactive state changes.
 */

import { scheduler } from './scheduler'

type EffectFn = () => void
type CleanupFn = () => void

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
        const oldValue = Reflect.get(target, prop, receiver)
        const result = Reflect.set(target, prop, value, receiver)
        if (oldValue !== value) {
          this.triggerEffects(target, prop)
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
