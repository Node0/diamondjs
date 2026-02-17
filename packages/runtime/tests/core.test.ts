/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiamondCore } from '../src/core'

describe('DiamondCore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('reactive', () => {
    it('should create reactive state', () => {
      const state = DiamondCore.reactive({ count: 0 })
      expect(state.count).toBe(0)
      state.count = 5
      expect(state.count).toBe(5)
    })
  })

  describe('effect', () => {
    it('should run effect and track dependencies', async () => {
      const state = DiamondCore.reactive({ count: 0 })
      const effect = vi.fn(() => state.count)

      DiamondCore.effect(effect)
      expect(effect).toHaveBeenCalledTimes(1)

      state.count = 5
      await vi.runAllTimersAsync()

      expect(effect).toHaveBeenCalledTimes(2)
    })

    it('should return cleanup function', async () => {
      const state = DiamondCore.reactive({ count: 0 })
      const effect = vi.fn(() => state.count)

      const cleanup = DiamondCore.effect(effect)
      cleanup()

      state.count = 5
      await vi.runAllTimersAsync()

      expect(effect).toHaveBeenCalledTimes(1)
    })
  })

  describe('computed', () => {
    it('should compute derived values', () => {
      const state = DiamondCore.reactive({ count: 5 })
      const doubled = DiamondCore.computed(() => state.count * 2)

      expect(doubled()).toBe(10)
    })
  })

  describe('bind', () => {
    it('should bind element property to reactive getter (one-way)', async () => {
      const state = DiamondCore.reactive({ message: 'Hello' })
      const div = document.createElement('div')

      DiamondCore.bind(div, 'textContent', () => state.message)

      // Initial bind
      await vi.runAllTimersAsync()
      expect(div.textContent).toBe('Hello')

      // Update state
      state.message = 'World'
      await vi.runAllTimersAsync()
      expect(div.textContent).toBe('World')
    })

    it('should support two-way binding with setter', async () => {
      const state = DiamondCore.reactive({ value: 'initial' })
      const input = document.createElement('input')

      DiamondCore.bind(
        input,
        'value',
        () => state.value,
        (v) => {
          state.value = v as string
        }
      )

      await vi.runAllTimersAsync()
      expect(input.value).toBe('initial')

      // Simulate user input
      input.value = 'user typed'
      input.dispatchEvent(new Event('input'))

      expect(state.value).toBe('user typed')
    })

    it('should return cleanup function', async () => {
      const state = DiamondCore.reactive({ message: 'Hello' })
      const div = document.createElement('div')

      const cleanup = DiamondCore.bind(div, 'textContent', () => state.message)
      await vi.runAllTimersAsync()

      cleanup()
      state.message = 'Changed'
      await vi.runAllTimersAsync()

      // Should still be old value after cleanup
      expect(div.textContent).toBe('Hello')
    })

    it('should block unsafe DOM sink bindings by default', () => {
      const div = document.createElement('div')

      expect(() => {
        DiamondCore.bind(div, 'innerHTML', () => '<img src=x onerror=alert(1)>')
      }).toThrow('Refused unsafe binding')
    })

    it('should allow unsafe DOM sink bindings with explicit bindUnsafe', async () => {
      const state = DiamondCore.reactive({ html: '<strong>trusted</strong>' })
      const div = document.createElement('div')

      DiamondCore.bindUnsafe(div, 'innerHTML', () => state.html)
      await vi.runAllTimersAsync()

      expect(div.innerHTML).toBe('<strong>trusted</strong>')
    })

    it('should use change event for checkboxes', async () => {
      const state = DiamondCore.reactive({ checked: false })
      const input = document.createElement('input')
      input.type = 'checkbox'

      DiamondCore.bind(
        input,
        'checked',
        () => state.checked,
        (v) => {
          state.checked = v as boolean
        }
      )

      input.checked = true
      input.dispatchEvent(new Event('change'))

      expect(state.checked).toBe(true)
    })

    it('should use change event for select elements', async () => {
      const state = DiamondCore.reactive({ selected: 'a' })
      const select = document.createElement('select')
      select.innerHTML = '<option value="a">A</option><option value="b">B</option>'

      DiamondCore.bind(
        select,
        'value',
        () => state.selected,
        (v) => {
          state.selected = v as string
        }
      )

      select.value = 'b'
      select.dispatchEvent(new Event('change'))

      expect(state.selected).toBe('b')
    })
  })

  describe('on', () => {
    it('should attach event listener', () => {
      const button = document.createElement('button')
      const handler = vi.fn()

      DiamondCore.on(button, 'click', handler)
      button.click()

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should return cleanup function', () => {
      const button = document.createElement('button')
      const handler = vi.fn()

      const cleanup = DiamondCore.on(button, 'click', handler)
      cleanup()
      button.click()

      expect(handler).not.toHaveBeenCalled()
    })

    it('should support capture phase', () => {
      const parent = document.createElement('div')
      const child = document.createElement('button')
      parent.appendChild(child)
      document.body.appendChild(parent)

      const events: string[] = []

      DiamondCore.on(parent, 'click', () => events.push('parent-capture'), true)
      DiamondCore.on(child, 'click', () => events.push('child'))

      child.click()

      expect(events[0]).toBe('parent-capture')
      expect(events[1]).toBe('child')

      document.body.removeChild(parent)
    })
  })

  describe('delegate', () => {
    it('should delegate events to matching children', () => {
      const parent = document.createElement('ul')
      const li1 = document.createElement('li')
      const li2 = document.createElement('li')
      parent.appendChild(li1)
      parent.appendChild(li2)

      const handler = vi.fn()
      DiamondCore.delegate(parent, 'click', 'li', handler)

      li1.click()
      expect(handler).toHaveBeenCalledTimes(1)

      li2.click()
      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('should not trigger for non-matching children', () => {
      const parent = document.createElement('div')
      const span = document.createElement('span')
      parent.appendChild(span)

      const handler = vi.fn()
      DiamondCore.delegate(parent, 'click', 'li', handler)

      span.click()
      expect(handler).not.toHaveBeenCalled()
    })

    it('should return cleanup function', () => {
      const parent = document.createElement('ul')
      const li = document.createElement('li')
      parent.appendChild(li)

      const handler = vi.fn()
      const cleanup = DiamondCore.delegate(parent, 'click', 'li', handler)

      cleanup()
      li.click()

      expect(handler).not.toHaveBeenCalled()
    })
  })
})
