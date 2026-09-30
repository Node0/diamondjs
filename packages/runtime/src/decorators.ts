/**
 * Decorators for DiamondJS components
 *
 * Property-level decorators for explicit reactivity declarations.
 * Decorated properties drive the UI. Bare properties are inert.
 */

import { reactivityEngine } from './reactivity'
import { Print } from '@diamondjs/primafacie'

/**
 * Keys decorated @reactive, recorded per prototype (legacy decorators) or per
 * instance (TC39 field decorators never see a prototype). Component.mount()
 * reads them to repair fields that a [[Define]]-emitting toolchain turned into
 * own data properties (issue #11).
 */
const decoratedKeys = new WeakMap<object, Set<string>>()

function recordDecorated(owner: object, key: string): void {
  let keys = decoratedKeys.get(owner)
  if (!keys) decoratedKeys.set(owner, (keys = new Set()))
  keys.add(key)
}

/**
 * Install the reactive accessor pair for `key` on `target` — a prototype on
 * the legacy path, an instance on the TC39 repair path. The backing store is a
 * one-field reactive proxy created on first assignment, so reads inside an
 * effect track and writes retrigger.
 */
function defineReactiveAccessor(target: object, key: string): void {
  const storageKey = Symbol(`__reactive_${key}`)
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get(this: Record<symbol, { value: unknown }>) {
      const store = this[storageKey]
      return store ? store.value : undefined
    },
    set(this: Record<symbol, { value: unknown }>, newValue: unknown) {
      const store = this[storageKey]
      if (!store) {
        // First assignment (field initializer) — create reactive backing store
        this[storageKey] = reactivityEngine.createProxy({ value: newValue })
      } else {
        store.value = newValue
      }
    },
  })
}

/**
 * @reactive property decorator
 *
 * Marks a class property as reactive. When the property changes,
 * any effects or bindings that read it will re-execute.
 *
 * Usage:
 *   @reactive count = 0;       // Drives UI — changes trigger re-render
 *   lastClickTime = 0;         // Inert (no decorator, no render)
 *
 * Legacy decorators (`experimentalDecorators: true`) install a getter/setter
 * pair on the prototype so `this.count = …` flows through the reactive store.
 * That relies on the field being ASSIGNED ([[Set]]). With [[Define]] semantics
 * (`useDefineForClassFields: true` — TypeScript's default for ES2022+ targets,
 * and what Parcel 2.16 / SWC emit) the field becomes an own data property that
 * shadows the accessor; the decorator records the key and Component.mount()
 * repairs it (adoptDefinedReactiveFields). TC39 field decorators cannot install
 * an accessor at all — they only see the instance — so that path records the
 * key too and relies on the same repair.
 */
export function reactive(
  _target: undefined,
  context: ClassFieldDecoratorContext
): (initialValue: unknown) => unknown
export function reactive(
  target: object,
  propertyKey: string
): void
export function reactive(
  _targetOrUndefined: object | undefined,
  contextOrKey: ClassFieldDecoratorContext | string
): ((initialValue: unknown) => unknown) | void {
  // TC39 Stage 3 decorator (TypeScript 5.0+ without experimentalDecorators)
  if (typeof contextOrKey === 'object' && contextOrKey.kind === 'field') {
    const key = String(contextOrKey.name)
    contextOrKey.addInitializer(function (this: unknown) {
      recordDecorated(this as object, key)
    })
    return (initialValue: unknown) => initialValue
  }

  // Legacy TypeScript decorator (experimentalDecorators: true)
  const propertyKey = contextOrKey as string
  const target = _targetOrUndefined as object
  recordDecorated(target, propertyKey)
  defineReactiveAccessor(target, propertyKey)
}

/** Every @reactive key visible from `instance`: its own record plus its prototype chain's. */
function reactiveKeysOf(instance: object): Set<string> {
  const keys = new Set<string>(decoratedKeys.get(instance) ?? [])
  for (let p = Object.getPrototypeOf(instance); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of decoratedKeys.get(p) ?? []) keys.add(k)
  }
  return keys
}

/** Whether some prototype of `instance` already provides a setter for `key`. */
function hasInheritedSetter(instance: object, key: string): boolean {
  for (let p = Object.getPrototypeOf(instance); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, key)
    if (d) return typeof d.set === 'function'
  }
  return false
}

/**
 * Re-route @reactive fields that were emitted with [[Define]] class-field
 * semantics (issue #11).
 *
 * Under `useDefineForClassFields: true` a class field is DEFINED on the
 * instance after super() returns — an own data property that shadows the
 * accessor the legacy decorator installed on the prototype (the TC39 field path
 * never had one). Bindings then read a plain property, nothing is tracked, and
 * no if/bind/repeat ever re-renders — silently. The base constructor runs
 * before those fields exist, so Component.mount() — the first framework entry
 * point after construction — calls this: each shadowed value is captured,
 * the own property deleted, an accessor supplied where the prototype has none,
 * and the value re-assigned so it lands in the reactive store. Zero cost when
 * the toolchain already emits [[Set]] assignments: no decorated key is then an
 * own data property. In dev builds the repair is reported once per class so the
 * project learns its toolchain emits [[Define]] fields.
 */
export function adoptDefinedReactiveFields(instance: object): void {
  const record = instance as Record<string, unknown>
  const repaired: string[] = []
  for (const key of reactiveKeysOf(instance)) {
    const own = Object.getOwnPropertyDescriptor(instance, key)
    if (!own || !('value' in own)) continue // not shadowed — the accessor is in charge
    const value = own.value
    delete record[key]
    if (!hasInheritedSetter(instance, key)) defineReactiveAccessor(instance, key)
    record[key] = value // flows through the accessor → reactive store
    repaired.push(key)
  }
  if (repaired.length > 0) reportDefineSemantics(instance, repaired)
}

/** Dev-only, once per class: name the repaired fields and the tsconfig fix. */
const reportedClasses = new WeakSet<object>()
function reportDefineSemantics(instance: object, keys: string[]): void {
  if ((globalThis as { __DIAMOND_DEV__?: unknown }).__DIAMOND_DEV__ !== true) return
  const ctor = instance.constructor as object
  if (reportedClasses.has(ctor)) return
  reportedClasses.add(ctor)
  Print(
    'WARNING',
    `[Diamond] ${(ctor as { name?: string }).name || 'Component'}: @reactive field(s) [${keys.join(', ')}] ` +
      `were emitted with [[Define]] class-field semantics — the own data property shadowed the ` +
      `reactive accessor. Repaired at mount(). Set "useDefineForClassFields": false (with ` +
      `"experimentalDecorators": true) in tsconfig.json so the toolchain emits [[Set]] assignments.`
  )
}
