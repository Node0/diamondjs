/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest'
import { Component } from '../src/component'

// Test component with instance template method
class TestComponent extends Component {
  name = 'World'

  createTemplate() {
    const div = document.createElement('div')
    div.textContent = `Hello, ${this.name}!`
    return div
  }
}

// Component without template (should error)
class NoTemplateComponent extends Component {
  // No createTemplate implementation
}

describe('Component', () => {
  describe('mount', () => {
    it('should mount component to host element', () => {
      const host = document.createElement('div')
      const component = new TestComponent()

      component.mount(host)

      expect(host.children.length).toBe(1)
      expect(host.children[0].textContent).toBe('Hello, World!')
    })

    it('should set element property after mount', () => {
      const host = document.createElement('div')
      const component = new TestComponent()

      expect(component.getElement()).toBeNull()
      component.mount(host)
      expect(component.getElement()).not.toBeNull()
    })

    it('should use this to reference component properties', () => {
      const host = document.createElement('div')
      const component = new TestComponent()
      component.name = 'Diamond'

      component.mount(host)

      expect(host.children[0].textContent).toBe('Hello, Diamond!')
    })
  })

  describe('unmount', () => {
    it('should remove element from DOM', () => {
      const host = document.createElement('div')
      const component = new TestComponent()

      component.mount(host)
      expect(host.children.length).toBe(1)

      component.unmount()
      expect(host.children.length).toBe(0)
    })

    it('should clear element reference', () => {
      const host = document.createElement('div')
      const component = new TestComponent()

      component.mount(host)
      component.unmount()

      expect(component.getElement()).toBeNull()
    })

    it('should run cleanup functions', () => {
      const cleanup = vi.fn()

      class CleanupComponent extends Component {
        createTemplate() {
          this.registerCleanup(cleanup)
          return document.createElement('div')
        }

        // Expose registerCleanup for testing
        public registerCleanup(fn: () => void): void {
          super.registerCleanup(fn)
        }
      }

      const host = document.createElement('div')
      const component = new CleanupComponent()
      component.mount(host)
      component.unmount()

      expect(cleanup).toHaveBeenCalledTimes(1)
    })
  })

  describe('update', () => {
    it('should update props via Object.assign', () => {
      const component = new TestComponent()
      expect(component.name).toBe('World')

      component.update({ name: 'Alice' })
      expect(component.name).toBe('Alice')
    })
  })

  describe('createTemplate', () => {
    it('should throw if createTemplate not implemented', () => {
      const host = document.createElement('div')
      const component = new NoTemplateComponent()

      expect(() => {
        component.mount(host)
      }).toThrow('must implement createTemplate()')
    })
  })

  describe('getElement', () => {
    it('should return null before mount', () => {
      const component = new TestComponent()
      expect(component.getElement()).toBeNull()
    })

    it('should return element after mount', () => {
      const host = document.createElement('div')
      const component = new TestComponent()
      component.mount(host)

      const element = component.getElement()
      expect(element).toBeInstanceOf(HTMLDivElement)
      expect(element?.textContent).toBe('Hello, World!')
    })
  })
})
