/**
 * Scheduler - Batched effect execution using microtasks
 * 
 * Prevents layout thrashing by batching multiple reactive updates
 * into a single microtask execution.
 */

/**
 * An effect as the scheduler sees it. `disposed` is set by effect cleanup
 * (§16 D-7): an effect queued before its disposal must be dropped at flush,
 * never run — running it would re-arm dependency tracking and re-subscribe
 * the dead effect (permanent retention of its component + detached DOM).
 */
export interface SchedulableEffect {
  (): void
  disposed?: boolean
}

/**
 * Scheduler class for managing effect execution
 * Uses microtask queue to batch updates
 */
export class Scheduler {
  private queue: Set<SchedulableEffect> = new Set()
  private flushing = false

  /**
   * Queue an effect to run on next microtask
   * Duplicate effects are deduplicated via Set
   */
  queueEffect(effect: SchedulableEffect): void {
    this.queue.add(effect)

    if (!this.flushing) {
      this.flushing = true
      queueMicrotask(() => this.flush())
    }
  }

  /**
   * Flush all queued effects, skipping (and dropping) any disposed
   * between queueing and flush (§16 D-7).
   */
  private flush(): void {
    const effects = Array.from(this.queue)
    this.queue.clear()
    this.flushing = false

    for (const effect of effects) {
      if (effect.disposed) continue
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
