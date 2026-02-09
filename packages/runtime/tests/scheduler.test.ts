import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler, scheduler } from '../src/scheduler'

describe('Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('queueEffect', () => {
    it('should queue effects for microtask execution', async () => {
      const testScheduler = new Scheduler()
      const effect = vi.fn()

      testScheduler.queueEffect(effect)

      // Effect not called synchronously
      expect(effect).not.toHaveBeenCalled()

      // Flush microtasks
      await vi.runAllTimersAsync()

      expect(effect).toHaveBeenCalledTimes(1)
    })

    it('should deduplicate same effect', async () => {
      const testScheduler = new Scheduler()
      const effect = vi.fn()

      testScheduler.queueEffect(effect)
      testScheduler.queueEffect(effect)
      testScheduler.queueEffect(effect)

      await vi.runAllTimersAsync()

      // Only called once due to Set deduplication
      expect(effect).toHaveBeenCalledTimes(1)
    })

    it('should batch multiple different effects', async () => {
      const testScheduler = new Scheduler()
      const effect1 = vi.fn()
      const effect2 = vi.fn()
      const effect3 = vi.fn()

      testScheduler.queueEffect(effect1)
      testScheduler.queueEffect(effect2)
      testScheduler.queueEffect(effect3)

      await vi.runAllTimersAsync()

      expect(effect1).toHaveBeenCalledTimes(1)
      expect(effect2).toHaveBeenCalledTimes(1)
      expect(effect3).toHaveBeenCalledTimes(1)
    })

    it('should handle effect errors gracefully', async () => {
      const testScheduler = new Scheduler()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const errorEffect = vi.fn(() => {
        throw new Error('Test error')
      })
      const normalEffect = vi.fn()

      testScheduler.queueEffect(errorEffect)
      testScheduler.queueEffect(normalEffect)

      await vi.runAllTimersAsync()

      // Error logged but other effects still run
      expect(errorSpy).toHaveBeenCalled()
      expect(normalEffect).toHaveBeenCalledTimes(1)

      errorSpy.mockRestore()
    })
  })

  describe('singleton scheduler', () => {
    it('should export a singleton instance', () => {
      expect(scheduler).toBeInstanceOf(Scheduler)
    })
  })
})
