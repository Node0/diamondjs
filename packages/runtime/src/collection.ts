/**
 * Collection<T> — the 2.1a collection-at-scale primitive (DDR §7.2).
 *
 * Built for tens of thousands of items against large JSON payloads:
 *
 *   - Items are NEVER proxied. No per-item trap overhead, and item identity is
 *     preserved — which is exactly what DiamondCore.repeat keys on.
 *   - Reactivity is COARSE-GRAINED: one version signal. Reads (length, at,
 *     iteration, sortBy, find, where, byKey, toArray) touch it; mutations bump
 *     it. The scheduler's dedupe collapses N synchronous mutations into ONE
 *     effect flush — 10k push() calls re-render once.
 *   - O(1) amortized append (push), O(1) keyed lookup (byKey, via the optional
 *     key function), cached sorted views (sortBy), binary search on a sorted
 *     view, and batch mutation (mutate) for raw array surgery.
 *
 * For in-place edits to an item's fields (invisible to the version signal by
 * design — the item is not proxied), call notify() to re-render dependents.
 */

import { reactivityEngine } from './reactivity'

export interface CollectionOptions<T> {
  /** Extract a stable key per item to enable O(1) byKey() lookups. */
  key?: (item: T) => unknown
}

export class Collection<T> implements Iterable<T> {
  /** Plain backing array — never proxied, item identity preserved. */
  private items: T[]

  /**
   * The version signal: a one-field micro-proxy through the shared reactivity
   * engine. touch() reads it (tracks inside effects); bump() writes it
   * (triggers dependents). This reuses the engine + scheduler wholesale — the
   * Collection adds zero new reactivity machinery.
   */
  private version = reactivityEngine.createProxy({ n: 0 })

  /** Plain (untracked) revision mirror for cache invalidation. */
  private rev = 0

  private keyFn?: (item: T) => unknown
  private index: Map<unknown, T> | null = null
  private indexDirty = false

  /**
   * Sorted views cached per comparator REFERENCE until the next mutation.
   * Pass a stable (module/class-level) comparator — an inline lambda creates
   * a fresh key per call and defeats the cache.
   */
  private sortCache = new Map<
    (a: T, b: T) => number,
    { rev: number; view: readonly T[] }
  >()

  private batching = false

  constructor(items?: Iterable<T>, options?: CollectionOptions<T>) {
    this.items = items ? Array.from(items) : []
    this.keyFn = options?.key
    if (this.keyFn) {
      this.index = new Map()
      for (const item of this.items) this.index.set(this.keyFn(item), item)
    }
  }

  private touch(): void {
    void this.version.n
  }

  private bump(): void {
    this.rev++
    if (!this.batching) this.version.n++
  }

  /** Reactive item count. */
  get length(): number {
    this.touch()
    return this.items.length
  }

  /** Reactive positional access. */
  at(index: number): T | undefined {
    this.touch()
    return this.items[index]
  }

  /**
   * O(1) keyed lookup. Requires the `key` option. The index is maintained
   * incrementally by push/remove and rebuilt lazily after mutate() (raw array
   * surgery can do anything).
   */
  byKey(key: unknown): T | undefined {
    if (!this.keyFn || !this.index) {
      throw new Error(
        '[Diamond] Collection.byKey requires a key function: new Collection(items, { key: (item) => item.id })'
      )
    }
    this.touch()
    if (this.indexDirty) {
      this.index.clear()
      for (const item of this.items) this.index.set(this.keyFn(item), item)
      this.indexDirty = false
    }
    return this.index.get(key)
  }

  /** O(1) amortized append. Returns the new length. */
  push(...newItems: T[]): number {
    const len = this.items.push(...newItems)
    if (this.keyFn && this.index && !this.indexDirty) {
      for (const item of newItems) this.index.set(this.keyFn(item), item)
    }
    this.bump()
    return len
  }

  /** Remove by identity. O(n) scan — batch removals belong in mutate(). */
  remove(item: T): boolean {
    const i = this.items.indexOf(item)
    if (i < 0) return false
    this.items.splice(i, 1)
    if (this.keyFn && this.index && !this.indexDirty) {
      this.index.delete(this.keyFn(item))
    }
    this.bump()
    return true
  }

  /** Reactive linear search. */
  find(predicate: (item: T) => boolean): T | undefined {
    this.touch()
    return this.items.find(predicate)
  }

  /** Reactive filter — returns a plain snapshot array. */
  where(predicate: (item: T) => boolean): T[] {
    this.touch()
    return this.items.filter(predicate)
  }

  /**
   * Sorted view, cached until the next mutation for the SAME comparator
   * reference. The view is a snapshot — safe input for binarySearch().
   */
  sortBy(comparator: (a: T, b: T) => number): readonly T[] {
    this.touch()
    const cached = this.sortCache.get(comparator)
    if (cached && cached.rev === this.rev) return cached.view
    const view = [...this.items].sort(comparator)
    this.sortCache.set(comparator, { rev: this.rev, view })
    return view
  }

  /**
   * Binary search over a sorted view. `probe(item)` returns <0 when the item
   * sorts before the target, 0 on match, >0 after. Returns the matching index,
   * or the bitwise complement (~insertionPoint) when absent.
   */
  binarySearch(sorted: readonly T[], probe: (item: T) => number): number {
    let lo = 0
    let hi = sorted.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const c = probe(sorted[mid])
      if (c === 0) return mid
      if (c < 0) lo = mid + 1
      else hi = mid - 1
    }
    return ~lo
  }

  /**
   * Batch mutation: `fn` gets the RAW backing array (sort, splice, bulk load —
   * anything), and dependents re-render exactly once afterwards. The byKey
   * index is rebuilt lazily on the next lookup.
   */
  mutate(fn: (items: T[]) => void): void {
    this.batching = true
    try {
      fn(this.items)
    } finally {
      this.batching = false
      if (this.keyFn) this.indexDirty = true
      this.bump()
    }
  }

  /**
   * Manual version bump — the escape hatch for in-place item edits, which the
   * version signal cannot see (items are deliberately not proxied).
   */
  notify(): void {
    this.bump()
  }

  /** Reactive snapshot copy. */
  toArray(): readonly T[] {
    this.touch()
    return [...this.items]
  }

  /** Reactive iteration — DiamondCore.repeat consumes a Collection directly. */
  [Symbol.iterator](): Iterator<T> {
    this.touch()
    return this.items[Symbol.iterator]()
  }
}
