/**
 * DiamondCore - Central runtime API
 * 
 * All reactive operations go through static methods on this class.
 * This is the primary API surface that compiled templates interact with.
 */

import { reactivityEngine } from './reactivity'

type CleanupFn = () => void

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
   * // One-way binding (view-only)
   * DiamondCore.bind(span, 'textContent', () => this.message)
   * 
   * // Two-way binding
   * DiamondCore.bind(input, 'value', () => this.name, (v) => this.name = v)
   */
  static bind(
    element: HTMLElement,
    property: string,
    getter: () => unknown,
    setter?: (value: unknown) => void
  ): CleanupFn {
    // Cast element for dynamic property access
    const el = element as unknown as Record<string, unknown>

    // Set up reactive effect for view updates
    const cleanupEffect = this.effect(() => {
      const value = getter()
      el[property] = value
    })

    // Set up two-way binding if setter provided
    let cleanupListener: CleanupFn | null = null
    if (setter) {
      const eventName = this.getInputEventName(element)
      const handler = () => {
        const value = el[property]
        setter(value)
      }
      element.addEventListener(eventName, handler)
      cleanupListener = () => element.removeEventListener(eventName, handler)
    }

    // Return combined cleanup
    return () => {
      cleanupEffect()
      cleanupListener?.()
    }
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
    return () => element.removeEventListener(event, handler, capture)
  }

  /**
   * Event delegation - attach handler to parent for child elements
   * 
   * @param parent - Parent element to attach listener
   * @param event - Event name
   * @param selector - CSS selector for target elements
   * @param handler - Event handler function
   * @returns Cleanup function
   * 
   * @example
   * DiamondCore.delegate(list, 'click', 'li', (e) => this.selectItem(e))
   */
  static delegate(
    parent: HTMLElement,
    event: string,
    selector: string,
    handler: (e: Event) => void
  ): CleanupFn {
    const delegateHandler = (e: Event) => {
      const target = e.target as HTMLElement
      if (target.matches(selector)) {
        handler(e)
      }
    }
    parent.addEventListener(event, delegateHandler)
    return () => parent.removeEventListener(event, delegateHandler)
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
