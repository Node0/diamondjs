/**
 * Component — Base class for all DiamondJS components
 *
 * Provides lifecycle management and DOM mounting.
 * Subclasses have a createTemplate() instance method injected by the compiler.
 * Uses 'this' to reference component properties and methods — no 'vm' indirection.
 */

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
    this.element = this.createTemplate()
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
   * Get the component's root element (null if not mounted)
   */
  getElement(): HTMLElement | null {
    return this.element
  }
}
