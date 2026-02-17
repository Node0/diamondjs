/**
 * Scheduler - Batched effect execution using microtasks
 * 
 * Prevents layout thrashing by batching multiple reactive updates
 * into a single microtask execution.
 */

/**
 * Scheduler class for managing effect execution
 * Uses microtask queue to batch updates
 */
export class Scheduler {
  private queue: Set<() => void> = new Set()
  private flushing = false

  /**
   * Queue an effect to run on next microtask
   * Duplicate effects are deduplicated via Set
   */
  queueEffect(effect: () => void): void {
    this.queue.add(effect)

    if (!this.flushing) {
      this.flushing = true
      queueMicrotask(() => this.flush())
    }
  }

  /**
   * Flush all queued effects
   */
  private flush(): void {
    const effects = Array.from(this.queue)
    this.queue.clear()
    this.flushing = false

    for (const effect of effects) {
      try {
        effect()
      } catch (error) {
        console.error('[Diamond] Effect execution error:', error)
      }
    }
  }
}

// Singleton scheduler instance
export const scheduler = new Scheduler()
