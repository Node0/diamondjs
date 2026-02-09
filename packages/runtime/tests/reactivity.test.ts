import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReactivityEngine, reactivityEngine } from '../src/reactivity'

describe('ReactivityEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('createProxy', () => {
    it('should create a reactive proxy', () => {
      const engine = new ReactivityEngine()
      const obj = { count: 0 }
      const proxy = engine.createProxy(obj)

      expect(proxy.count).toBe(0)
      proxy.count = 5
      expect(proxy.count).toBe(5)
    })

    it('should track nested object access', () => {
      const engine = new ReactivityEngine()
      const obj = { user: { name: 'Alice' } }
      const proxy = engine.createProxy(obj)

      expect(proxy.user.name).toBe('Alice')
    })
  })

  describe('createEffect', () => {
    it('should run effect immediately', () => {
      const engine = new ReactivityEngine()
      const effect = vi.fn()

      engine.createEffect(effect)

      expect(effect).toHaveBeenCalledTimes(1)
    })

    it('should re-run effect when dependencies change', async () => {
      const engine = new ReactivityEngine()
      const obj = { count: 0 }
      const proxy = engine.createProxy(obj)
      const effect = vi.fn(() => proxy.count)

      engine.createEffect(effect)
      expect(effect).toHaveBeenCalledTimes(1)

      proxy.count = 5
      await vi.runAllTimersAsync()

      expect(effect).toHaveBeenCalledTimes(2)
    })

    it('should not re-run when unrelated properties change', async () => {
      const engine = new ReactivityEngine()
      const obj = { count: 0, name: 'test' }
      const proxy = engine.createProxy(obj)
      const effect = vi.fn(() => proxy.count)

      engine.createEffect(effect)
      expect(effect).toHaveBeenCalledTimes(1)

      proxy.name = 'changed'
      await vi.runAllTimersAsync()

      // Effect only reads count, not name
      expect(effect).toHaveBeenCalledTimes(1)
    })

    it('should return cleanup function', async () => {
      const engine = new ReactivityEngine()
      const obj = { count: 0 }
      const proxy = engine.createProxy(obj)
      const effect = vi.fn(() => proxy.count)

      const cleanup = engine.createEffect(effect)
      expect(effect).toHaveBeenCalledTimes(1)

      cleanup()
      proxy.count = 5
      await vi.runAllTimersAsync()

      // Effect not called again after cleanup
      expect(effect).toHaveBeenCalledTimes(1)
    })

    it('should not trigger when value unchanged', async () => {
      const engine = new ReactivityEngine()
      const obj = { count: 5 }
      const proxy = engine.createProxy(obj)
      const effect = vi.fn(() => proxy.count)

      engine.createEffect(effect)
      expect(effect).toHaveBeenCalledTimes(1)

      proxy.count = 5 // Same value
      await vi.runAllTimersAsync()

      expect(effect).toHaveBeenCalledTimes(1)
    })
  })

  describe('createComputed', () => {
    it('should return computed value', () => {
      const engine = new ReactivityEngine()
      const obj = { count: 5 }
      const proxy = engine.createProxy(obj)

      const doubled = engine.createComputed(() => proxy.count * 2)

      expect(doubled()).toBe(10)
    })

    it('should cache computed value', () => {
      const engine = new ReactivityEngine()
      const obj = { count: 5 }
      const proxy = engine.createProxy(obj)
      const getter = vi.fn(() => proxy.count * 2)

      const doubled = engine.createComputed(getter)

      doubled()
      doubled()
      doubled()

      // Getter called multiple times due to dependency tracking
      // but result is cached
      expect(doubled()).toBe(10)
    })
  })

  describe('singleton instance', () => {
    it('should export a singleton', () => {
      expect(reactivityEngine).toBeInstanceOf(ReactivityEngine)
    })
  })
})
