/**
 * Component — Base class for all DiamondJS components
 *
 * Provides lifecycle management and DOM mounting.
 * Subclasses have a createTemplate() instance method injected by the compiler.
 * Uses 'this' to reference component properties and methods — no 'vm' indirection.
 */

import { DiamondCore } from './core'

/**
 * Component base class
 *
 * Provides:
 * - Instance template method (createTemplate uses 'this')
 * - 4-hook lifecycle (constructor/mount/update/unmount)
 * - DOM element management
 * - Cleanup registration for bindings
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
 * }
 */
export abstract class Component {
  /** The root DOM element for this component instance */
  protected element: HTMLElement | null = null

  /** Cleanup functions from bindings and effects */
  private cleanups: Array<() => void> = []

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

  /**
   * Mount the component to a host element
   *
   * @param hostElement - Parent DOM element to append to
   */
  mount(hostElement: HTMLElement): void {
    // Capture root-level binding/listener/structural cleanups (they would
    // otherwise be discarded — DiamondCore's scope is null at the root) and
    // register them against this component's teardown, so unmount() disposes
    // the whole tree uniformly.
    const { value, cleanup } = DiamondCore.captureScope(() => this.createTemplate())
    this.element = value
    this.registerCleanup(cleanup)
    hostElement.appendChild(this.element)
  }

  /**
   * Update component with new props
   * Override in subclass to handle prop changes
   *
   * @param newProps - Partial props to update
   */
  update(newProps: Partial<this>): void {
    Object.assign(this, newProps)
  }

  /**
   * Unmount the component and clean up resources
   */
  unmount(): void {
    for (const cleanup of this.cleanups) {
      try {
        cleanup()
      } catch (error) {
        console.error('[Diamond] Cleanup error:', error)
      }
    }
    this.cleanups = []
    this.element?.remove()
    this.element = null
  }

  /**
   * Register a cleanup function to run on unmount
   *
   * @param cleanup - Function to call on unmount
   */
  protected registerCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  /**
   * Debounce a handler (DDR §4.3, handler timing). Returns a wrapped function
   * that defers `fn` until `ms` of quiet. The pending timer's `cancel` is
   * **self-registered** against this component's teardown registry at creation
   * time, so the call site stays a leak-safe one-liner:
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
    this.registerCleanup(cancel)
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
   * pending timer self-registers its `cancel` for unmount.
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
    this.registerCleanup(cancel)
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

  /**
   * Get the component's root element (null if not mounted)
   */
  getElement(): HTMLElement | null {
    return this.element
  }
}
