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

    it('from-view (no getter) never pushes model → DOM, even when the model changes elsewhere', async () => {
      const state = DiamondCore.reactive({ q: 'model-initial' })
      const input = document.createElement('input')
      input.value = 'user-typed'

      // from-view: setter only, NO getter
      DiamondCore.bind(input, 'value', undefined, (v) => {
        state.q = v as string
      })
      await vi.runAllTimersAsync()

      // Model did NOT overwrite the user's input on setup
      expect(input.value).toBe('user-typed')

      // DOM → model still works
      input.value = 'new-user-input'
      input.dispatchEvent(new Event('input'))
      expect(state.q).toBe('new-user-input')

      // CRITICAL: a model write from elsewhere must NOT reach the sink
      state.q = 'changed-by-websocket'
      await vi.runAllTimersAsync()
      expect(input.value).toBe('new-user-input') // sink untouched by the model
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

  describe('delegate (removed in v2.0 §6.4; reintroduced in v2.1 as 2.1b)', () => {
    it('exists as the clean-slate data-delegation API (item-resolving, not the Aurelia stub)', () => {
      // The v2.0 removal killed an orphaned event-fallback stub. The v2.1
      // delegate is a different contract entirely: container listener +
      // closest() + repeat's node→item registry (see delegate.test.ts).
      expect(typeof DiamondCore.delegate).toBe('function')
      expect(DiamondCore.delegate.length).toBe(4) // container, event, selector, handler
    })
  })
})
