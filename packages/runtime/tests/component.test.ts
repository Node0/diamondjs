/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest'
import { Component } from '../src/component'
import { DiamondCore } from '../src/core'

const tick = () => new Promise((r) => setTimeout(r, 0))

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

  describe('holistic root cleanup (v2.1)', () => {
    class BoundComponent extends Component {
      state = DiamondCore.reactive({ label: 'first' })
      clicks = 0

      createTemplate() {
        const div = document.createElement('div')
        DiamondCore.bind(div, 'textContent', () => this.state.label)
        DiamondCore.on(div, 'click', () => this.clicks++)
        return div
      }
    }

    it('stops root-level bindings from updating after unmount', async () => {
      const host = document.createElement('div')
      const component = new BoundComponent()
      component.mount(host)
      await tick()

      const el = component.getElement()!
      expect(el.textContent).toBe('first')

      component.unmount()
      component.state.label = 'second'
      await tick()

      // The root binding's effect was disposed with the component scope —
      // the detached element no longer tracks the model.
      expect(el.textContent).toBe('first')
    })

    it('detaches root-level event listeners on unmount', () => {
      const host = document.createElement('div')
      const component = new BoundComponent()
      component.mount(host)

      const el = component.getElement()!
      el.click()
      expect(component.clicks).toBe(1)

      component.unmount()
      el.click()
      expect(component.clicks).toBe(1)
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
