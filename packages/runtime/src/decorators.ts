/**
 * Decorators for DiamondJS components
 *
 * Property-level decorators for explicit reactivity declarations.
 * Decorated properties drive the UI. Bare properties are inert.
 */

import { reactivityEngine } from './reactivity'

/**
 * @reactive property decorator
 *
 * Marks a class property as reactive. When the property changes,
 * any effects or bindings that read it will re-execute.
 *
 * This is a write-time convenience — the compiler transforms @reactive
 * into explicit DiamondCore.makeReactive() calls in the constructor.
 *
 * Usage:
 *   @reactive count = 0;       // Drives UI — changes trigger re-render
 *   lastClickTime = 0;         // Inert (no decorator, no render)
 *
 * The decorator supports both TC39 Stage 3 and legacy TypeScript patterns.
 * In practice, the compiler handles the transformation, so the runtime
 * decorator function is minimal — it exists so TypeScript doesn't complain.
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
    return function (initialValue: unknown) {
      // The compiler transforms @reactive into DiamondCore.makeReactive()
      // calls in the constructor. This initializer just passes through.
      return initialValue
    }
  }

  // Legacy TypeScript decorator (experimentalDecorators: true)
  // Define a getter/setter on the prototype so that field assignment
  // (this.prop = initialValue) flows through the reactive proxy.
  const propertyKey = contextOrKey as string
  const target = _targetOrUndefined as object
  const storageKey = Symbol(`__reactive_${propertyKey}`)

  Object.defineProperty(target, propertyKey, {
    configurable: true,
    enumerable: true,
    get(this: Record<symbol, { value: unknown }>) {
      const store = this[storageKey]
      return store ? store.value : undefined
    },
    set(this: Record<symbol, { value: unknown }>, newValue: unknown) {
      let store = this[storageKey]
      if (!store) {
        // First assignment (field initializer) — create reactive backing store
        this[storageKey] = reactivityEngine.createProxy({ value: newValue })
      } else {
        store.value = newValue
      }
    }
  })
}
