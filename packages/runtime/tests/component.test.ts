/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest'
import { Component } from '../src/component'

// Test component with template
class TestComponent extends Component {
  name = 'World'

  static createTemplate() {
    return (vm: TestComponent) => {
      const div = document.createElement('div')
      div.textContent = `Hello, ${vm.name}!`
      return div
    }
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
  })

  describe('update', () => {
    it('should update props via Object.assign', () => {
      const component = new TestComponent()
      expect(component.name).toBe('World')

      component.update({ name: 'Alice' })
      expect(component.name).toBe('Alice')
    })
  })

  describe('getTemplateFactory', () => {
    it('should cache template factory', () => {
      const factory1 = TestComponent.getTemplateFactory()
      const factory2 = TestComponent.getTemplateFactory()

      expect(factory1).toBe(factory2)
    })

    it('should throw if createTemplate not implemented', () => {
      expect(() => {
        NoTemplateComponent.getTemplateFactory()
      }).toThrow('must implement static createTemplate()')
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
