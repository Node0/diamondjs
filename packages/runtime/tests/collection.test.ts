/**
 * @vitest-environment happy-dom
 *
 * Collection<T> (v2.1, DDR §7.2 / 2.1a) — coarse-grained version-signal
 * reactivity, no per-item proxies, scale-shaped behavior.
 */
import { describe, it, expect, vi } from 'vitest'
import { DiamondCore } from '../src/core'
import { Collection } from '../src/collection'

const tick = () => new Promise((r) => setTimeout(r, 0))

interface Cogit {
  id: number
  label: string
}

const cogit = (id: number, label = `c${id}`): Cogit => ({ id, label })

describe('Collection — reactivity (version signal)', () => {
  it('length/iteration inside an effect re-runs on push', async () => {
    const coll = new Collection<Cogit>()
    let seen = -1
    DiamondCore.effect(() => {
      seen = coll.length
    })
    expect(seen).toBe(0)

    coll.push(cogit(1))
    await tick()
    expect(seen).toBe(1)
  })

  it('10k naked pushes collapse to ONE effect re-run (scheduler dedupe)', async () => {
    const coll = new Collection<Cogit>()
    const runs = vi.fn()
    DiamondCore.effect(() => {
      void coll.length
      runs()
    })
    expect(runs).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 10_000; i++) coll.push(cogit(i))
    await tick()
    expect(coll.length).toBe(10_000)
    expect(runs).toHaveBeenCalledTimes(2) // initial + one batched flush
  })

  it('mutate() re-renders exactly once for arbitrary array surgery', async () => {
    const coll = new Collection<Cogit>([cogit(1), cogit(2)])
    const runs = vi.fn()
    DiamondCore.effect(() => {
      void coll.length
      runs()
    })

    coll.mutate((items) => {
      items.splice(0, 1)
      items.push(cogit(3), cogit(4))
      items.reverse()
    })
    await tick()
    expect(runs).toHaveBeenCalledTimes(2)
    expect(coll.toArray().map((c) => c.id)).toEqual([4, 3, 2])
  })

  it('items are NOT proxied — identity preserved, field edits invisible until notify()', async () => {
    const item = cogit(1, 'before')
    const coll = new Collection([item])
    expect(coll.at(0)).toBe(item) // same reference, no proxy wrapper

    let label = ''
    DiamondCore.effect(() => {
      void coll.length // version dep
      label = coll.at(0)!.label
    })
    expect(label).toBe('before')

    item.label = 'after' // in-place edit — invisible by design
    await tick()
    expect(label).toBe('before')

    coll.notify() // the escape hatch
    await tick()
    expect(label).toBe('after')
  })
})

describe('Collection — keyed lookup', () => {
  it('byKey is O(1)-shaped and maintained by push/remove', () => {
    const coll = new Collection<Cogit>([cogit(1), cogit(2)], {
      key: (c) => c.id,
    })
    expect(coll.byKey(2)?.label).toBe('c2')

    const three = cogit(3)
    coll.push(three)
    expect(coll.byKey(3)).toBe(three)

    coll.remove(three)
    expect(coll.byKey(3)).toBeUndefined()
  })

  it('rebuilds the index lazily after mutate()', () => {
    const coll = new Collection<Cogit>([cogit(1)], { key: (c) => c.id })
    coll.mutate((items) => {
      items.length = 0
      items.push(cogit(7), cogit(8))
    })
    expect(coll.byKey(1)).toBeUndefined()
    expect(coll.byKey(8)?.label).toBe('c8')
  })

  it('throws a directive error without a key function', () => {
    const coll = new Collection<Cogit>([cogit(1)])
    expect(() => coll.byKey(1)).toThrow('requires a key function')
  })
})

describe('Collection — sorted views + binary search', () => {
  const byId = (a: Cogit, b: Cogit) => a.id - b.id

  it('sortBy caches per comparator reference until a mutation', () => {
    const coll = new Collection<Cogit>([cogit(3), cogit(1), cogit(2)])
    const view1 = coll.sortBy(byId)
    const view2 = coll.sortBy(byId)
    expect(view1).toBe(view2) // same array identity — cache hit
    expect(view1.map((c) => c.id)).toEqual([1, 2, 3])

    coll.push(cogit(0))
    const view3 = coll.sortBy(byId)
    expect(view3).not.toBe(view1) // invalidated by the bump
    expect(view3.map((c) => c.id)).toEqual([0, 1, 2, 3])
  })

  it('binarySearch finds an index or returns ~insertionPoint', () => {
    const coll = new Collection<Cogit>([cogit(10), cogit(30), cogit(20)])
    const sorted = coll.sortBy(byId)

    expect(coll.binarySearch(sorted, (c) => c.id - 20)).toBe(1)
    const miss = coll.binarySearch(sorted, (c) => c.id - 25)
    expect(miss).toBeLessThan(0)
    expect(~miss).toBe(2) // 25 would insert before 30
  })
})

describe('Collection — search helpers', () => {
  it('find and where snapshot correctly', () => {
    const coll = new Collection<Cogit>([cogit(1), cogit(2), cogit(3)])
    expect(coll.find((c) => c.id === 2)?.label).toBe('c2')
    expect(coll.where((c) => c.id > 1).map((c) => c.id)).toEqual([2, 3])
  })
})

describe('Collection — repeat integration', () => {
  it('DiamondCore.repeat consumes a Collection; push appends without rebuilding rows', async () => {
    const host = document.createElement('ul')
    const anchor = document.createComment('repeat')
    host.appendChild(anchor)

    const coll = DiamondCore.collection<Cogit>([cogit(1), cogit(2)])
    const makeItem = vi.fn((c: Cogit) => {
      const li = document.createElement('li')
      li.textContent = c.label
      return li
    })
    DiamondCore.repeat(anchor, () => coll, makeItem)
    expect(host.querySelectorAll('li')).toHaveLength(2)
    const firstRow = host.querySelector('li')

    coll.push(cogit(3))
    await tick()
    expect(host.querySelectorAll('li')).toHaveLength(3)
    expect(makeItem).toHaveBeenCalledTimes(3) // only the new row built
    expect(host.querySelector('li')).toBe(firstRow) // identity keying held
  })
})
