/**
 * @vitest-environment happy-dom
 *
 * Issue #26 — in-place mutation of a reactive array re-runs the effects that
 * iterate it. Before the fix `push()` on `state.items` left a `repeat` showing
 * the old rows; only reassignment re-rendered. The cause was in the set trap:
 * the new index fired ITERATE_KEY (tracked only by ownKeys readers), and the
 * following `length` write was a no-op because the array had already bumped
 * `length` itself. The trap now wakes the `length` readers when a new key
 * lands on an array.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCore } from '../src/core'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** A repeat over `items` with the getter's run count exposed. */
function mountRepeat<T>(items: () => Iterable<T>) {
  const host = document.createElement('ul')
  const anchor = document.createComment('repeat')
  host.appendChild(anchor)
  let runs = 0
  DiamondCore.repeat(
    anchor,
    () => {
      runs++
      return items()
    },
    (item) => {
      const li = document.createElement('li')
      li.textContent = String(item)
      return li
    }
  )
  return {
    text: () => Array.from(host.querySelectorAll('li'), (li) => li.textContent).join(''),
    runs: () => runs,
  }
}

describe('repeat re-runs on in-place array mutation (#26)', () => {
  it('push() renders the new row, with one extra pass of the getter', async () => {
    const state = DiamondCore.reactive({ items: ['x'] })
    const r = mountRepeat(() => state.items)
    await tick()
    expect(r.text()).toBe('x')
    expect(r.runs()).toBe(1)

    state.items.push('y')
    await tick()
    expect(r.text()).toBe('xy')
    expect(r.runs()).toBe(2)
  })

  it('unshift(), splice() insertion and index assignment past the end all render', async () => {
    const state = DiamondCore.reactive({ items: ['b'] })
    const r = mountRepeat(() => state.items)
    await tick()

    state.items.unshift('a')
    await tick()
    expect(r.text()).toBe('ab')

    state.items.splice(1, 0, 'm')
    await tick()
    expect(r.text()).toBe('amb')

    state.items[state.items.length] = 'z'
    await tick()
    expect(r.text()).toBe('ambz')
  })

  it('pop(), shift(), splice() removal and length = 0 render (removal already worked; pinned)', async () => {
    const state = DiamondCore.reactive({ items: ['a', 'b', 'c', 'd'] })
    const r = mountRepeat(() => state.items)
    await tick()

    state.items.pop()
    await tick()
    expect(r.text()).toBe('abc')

    state.items.shift()
    await tick()
    expect(r.text()).toBe('bc')

    state.items.splice(0, 1)
    await tick()
    expect(r.text()).toBe('c')

    state.items.length = 0
    await tick()
    expect(r.text()).toBe('')
  })

  it('replacing an existing index renders the new value', async () => {
    const state = DiamondCore.reactive({ items: ['a', 'b'] })
    const r = mountRepeat(() => state.items)
    await tick()

    state.items[0] = 'z'
    await tick()
    expect(r.text()).toBe('zb')
  })

  it('reassignment still works', async () => {
    const state = DiamondCore.reactive({ items: ['x'] })
    const r = mountRepeat(() => state.items)
    await tick()

    state.items = [...state.items, 'y']
    await tick()
    expect(r.text()).toBe('xy')
  })

  it('several mutations in one tick are one re-run', async () => {
    const state = DiamondCore.reactive({ items: [] as string[] })
    const r = mountRepeat(() => state.items)
    await tick()
    expect(r.runs()).toBe(1)

    state.items.push('a')
    state.items.push('b')
    state.items.unshift('0')
    state.items.splice(1, 0, 'm')
    await tick()
    expect(r.text()).toBe('0mab')
    expect(r.runs()).toBe(2)
  })

  it('objects as items keep their identity-keyed rows across a push', async () => {
    const a = { id: 1 }
    const b = { id: 2 }
    const state = DiamondCore.reactive({ items: [a] })
    const host = document.createElement('ul')
    const anchor = document.createComment('repeat')
    host.appendChild(anchor)
    let built = 0
    DiamondCore.repeat(anchor, () => state.items, (it: { id: number }) => {
      built++
      const li = document.createElement('li')
      li.textContent = String(it.id)
      return li
    })
    await tick()
    const first = host.querySelector('li')

    state.items.push(b)
    await tick()
    expect(Array.from(host.querySelectorAll('li'), (li) => li.textContent)).toEqual(['1', '2'])
    expect(host.querySelector('li')).toBe(first) // row for `a` reused, not rebuilt
    expect(built).toBe(2)
  })
})

describe('plain effects over a reactive array (#26)', () => {
  it('an effect reading .length re-runs after push()', async () => {
    const state = DiamondCore.reactive({ items: ['x'] })
    const seen: number[] = []
    DiamondCore.effect(() => {
      seen.push(state.items.length)
    })
    await tick()
    state.items.push('y')
    await tick()
    expect(seen).toEqual([1, 2])
  })

  it('an effect iterating with for…of re-runs after push()', async () => {
    const state = DiamondCore.reactive({ items: ['x'] })
    const seen: string[] = []
    DiamondCore.effect(() => {
      let joined = ''
      for (const it of state.items) joined += it
      seen.push(joined)
    })
    await tick()
    state.items.push('y')
    await tick()
    expect(seen).toEqual(['x', 'xy'])
  })

  it('a new key on a plain object still wakes only key-set readers, not a `length` property', async () => {
    const state = DiamondCore.reactive({ bag: { length: 1 } as Record<string, number> })
    let lengthRuns = 0
    let keysRuns = 0
    DiamondCore.effect(() => {
      void state.bag.length
      lengthRuns++
    })
    DiamondCore.effect(() => {
      void Object.keys(state.bag)
      keysRuns++
    })
    await tick()
    state.bag.other = 2
    await tick()
    expect(lengthRuns).toBe(1)
    expect(keysRuns).toBe(2)
  })
})
