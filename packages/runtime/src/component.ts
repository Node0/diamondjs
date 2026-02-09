/**
 * Component - Base class for DiamondJS components
 * 
 * Provides the template factory pattern and lifecycle management.
 * Component classes extend this and have a static createTemplate()
 * method injected by the compiler.
 */

type TemplateFactory<T> = (vm: T) => HTMLElement

/**
 * Component base class
 * 
 * Provides:
 * - Static template factory caching (one factory per component class)
 * - 4-hook lifecycle (constructor/mount/update/unmount)
 * - DOM element management
 * 
 * @example
 * export class MyComponent extends Component {
 *   name = 'World'
 *   
 *   // Compiler-generated from .html template
 *   static createTemplate() {
 *     return (vm: MyComponent) => {
 *       const div = document.createElement('div')
 *       DiamondCore.bind(div, 'textContent', () => `Hello, ${vm.name}!`)
 *       return div
 *     }
 *   }
 * }
 */
export abstract class Component {
  /** The root DOM element for this component instance */
  protected element: HTMLElement | null = null

  /** Cleanup functions from bindings */
  private cleanups: Array<() => void> = []

  /** Cached template factory (one per component class) */
  private static _templateFactory: TemplateFactory<unknown> | null = null

  /**
   * Get the cached template factory for this component class
   * Creates and caches on first call (flyweight pattern)
   */
  static getTemplateFactory<T>(): TemplateFactory<T> {
    if (!this._templateFactory) {
      this._templateFactory = this.createTemplate()
    }
    return this._templateFactory as TemplateFactory<T>
  }

  /**
   * Compiler-generated method that returns a template factory
   * Subclasses implement this (compiler injects it)
   * 
   * @throws Error if not implemented (missing template)
   */
  static createTemplate(): TemplateFactory<unknown> {
    throw new Error(
      `${this.name} must implement static createTemplate() method. ` +
        'This should be compiler-generated from the .html template.'
    )
  }

  /**
   * Mount the component to a host element
   * 
   * @param hostElement - Parent DOM element to append to
   */
  mount(hostElement: HTMLElement): void {
    const ComponentClass = this.constructor as typeof Component
    const factory = ComponentClass.getTemplateFactory()
    this.element = factory(this)
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
    // Run all cleanup functions
    for (const cleanup of this.cleanups) {
      try {
        cleanup()
      } catch (error) {
        console.error('[DiamondJS] Cleanup error:', error)
      }
    }
    this.cleanups = []

    // Remove from DOM
    this.element?.remove()
    this.element = null
  }

  /**
   * Register a cleanup function to run on unmount
   * Used internally by bindings
   * 
   * @param cleanup - Function to call on unmount
   */
  protected registerCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  /**
   * Get the component's root element
   * Returns null if not mounted
   */
  getElement(): HTMLElement | null {
    return this.element
  }
}
