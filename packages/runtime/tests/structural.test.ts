/**
 * @vitest-environment happy-dom
 *
 * Runtime primitives for structural directives (DDR §6.2/§6.3):
 * DiamondCore.captureScope / if / repeat.
 */
import { describe, it, expect, vi } from 'vitest'
import { DiamondCore } from '../src/core'

// Flush the scheduler's microtask queue (reactive updates are batched).
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('DiamondCore.captureScope', () => {
  it('collects and disposes bind() effects created within fn', async () => {
    const state = DiamondCore.reactive({ v: 'a' })
    const div = document.createElement('div')

    const { value, cleanup } = DiamondCore.captureScope(() => {
      DiamondCore.bind(div, 'textContent', () => state.v)
      return div
    })
    expect(value).toBe(div)
    await tick()
    expect(div.textContent).toBe('a')

    state.v = 'b'
    await tick()
    expect(div.textContent).toBe('b')

    cleanup()
    state.v = 'c'
    await tick()
    expect(div.textContent).toBe('b') // effect disposed → no further updates
  })

  it('collects and disposes on() listeners created within fn', () => {
    const btn = document.createElement('button')
    const fn = vi.fn()
    const { cleanup } = DiamondCore.captureScope(() => {
      DiamondCore.on(btn, 'click', fn)
      return btn
    })
    btn.click()
    expect(fn).toHaveBeenCalledTimes(1)
    cleanup()
    btn.click()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not register cleanups at the root (no active scope)', () => {
    // Smoke test: bind/on outside captureScope must not throw.
    const div = document.createElement('div')
    expect(() =>
      DiamondCore.bind(div, 'textContent', () => 'x')
    ).not.toThrow()
  })
})

describe('DiamondCore.if', () => {
  function setup() {
    const host = document.createElement('div')
    const anchor = document.createComment('if')
    host.appendChild(anchor)
    return { host, anchor }
  }

  it('renders the matching branch and removes it when false', async () => {
    const state = DiamondCore.reactive({ show: true })
    const { host, anchor } = setup()
    DiamondCore.if(anchor, [
      {
        when: () => state.show,
        make: () => {
          const s = document.createElement('span')
          s.textContent = 'shown'
          return s
        },
      },
    ])
    expect(host.querySelector('span')?.textContent).toBe('shown')

    state.show = false
    await tick()
    expect(host.querySelector('span')).toBeNull()

    state.show = true
    await tick()
    expect(host.querySelector('span')?.textContent).toBe('shown')
  })

  it('picks the first truthy branch (else-if semantics)', async () => {
    const state = DiamondCore.reactive({ a: false, b: false })
    const { host, anchor } = setup()
    DiamondCore.if(anchor, [
      { when: () => state.a, make: () => mk('A') },
      { when: () => state.b, make: () => mk('B') },
    ])
    function mk(t: string) {
      const e = document.createElement('span')
      e.textContent = t
      return e
    }
    expect(host.querySelector('span')).toBeNull()

    state.b = true
    await tick()
    expect(host.querySelector('span')?.textContent).toBe('B')

    state.a = true
    await tick()
    expect(host.querySelector('span')?.textContent).toBe('A')
  })

  it('rebuilds a fresh subtree when toggled back on (detached means disposed, A3)', async () => {
    const state = DiamondCore.reactive({ show: true })
    const { host, anchor } = setup()
    const make = vi.fn(() => document.createElement('span'))
    DiamondCore.if(anchor, [{ when: () => state.show, make }])
    const first = host.querySelector('span')
    state.show = false
    await tick()
    state.show = true
    await tick()
    expect(make).toHaveBeenCalledTimes(2) // disposed on detach, rebuilt on re-activation
    expect(host.querySelector('span')).not.toBe(first)
  })

  it('inserts the branch before the anchor (document order preserved)', () => {
    const state = DiamondCore.reactive({ show: true })
    const host = document.createElement('div')
    const before = document.createElement('p')
    before.textContent = 'before'
    const anchor = document.createComment('if')
    const after = document.createElement('p')
    after.textContent = 'after'
    host.append(before, anchor, after)

    DiamondCore.if(anchor, [
      {
        when: () => state.show,
        make: () => {
          const e = document.createElement('span')
          e.textContent = 'mid'
          return e
        },
      },
    ])
    expect(Array.from(host.children).map((c) => c.textContent)).toEqual([
      'before',
      'mid',
      'after',
    ])
  })
})

describe('DiamondCore.repeat', () => {
  function setup() {
    const host = document.createElement('ul')
    const anchor = document.createComment('repeat')
    host.appendChild(anchor)
    return { host, anchor }
  }
  const texts = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('li')).map((li) => li.textContent)

  it('renders one node per item', () => {
    const state = DiamondCore.reactive({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    })
    const { host, anchor } = setup()
    DiamondCore.repeat(anchor, () => state.items, (it) => {
      const li = document.createElement('li')
      li.textContent = String(it.id)
      return li
    })
    expect(texts(host)).toEqual(['1', '2', '3'])
  })

  it('reacts to additions and removals (by reassignment)', async () => {
    const state = DiamondCore.reactive({ items: [{ id: 1 }] as { id: number }[] })
    const { host, anchor } = setup()
    DiamondCore.repeat(anchor, () => state.items, (it) => {
      const li = document.createElement('li')
      li.textContent = String(it.id)
      return li
    })
    expect(texts(host)).toEqual(['1'])

    state.items = [...state.items, { id: 2 }, { id: 3 }]
    await tick()
    expect(texts(host)).toEqual(['1', '2', '3'])

    state.items = state.items.filter((i) => i.id !== 2)
    await tick()
    expect(texts(host)).toEqual(['1', '3'])
  })

  it('reuses nodes by item identity across reorder', async () => {
    const a = { id: 'a' }
    const b = { id: 'b' }
    const state = DiamondCore.reactive({ items: [a, b] })
    const { host, anchor } = setup()
    DiamondCore.repeat(anchor, () => state.items, (it) => {
      const li = document.createElement('li')
      li.textContent = it.id
      return li
    })
    const liA = host.querySelectorAll('li')[0]

    state.items = [b, a]
    await tick()
    const reordered = Array.from(host.querySelectorAll('li'))
    expect(reordered.map((li) => li.textContent)).toEqual(['b', 'a'])
    expect(reordered[1]).toBe(liA) // same node, moved
  })

  it('renders duplicate primitive items as distinct rows (D-2)', async () => {
    const state = DiamondCore.reactive({ items: ['x', 'x', 'y'] as string[] })
    const { host, anchor } = setup()
    let builds = 0
    DiamondCore.repeat(anchor, () => state.items, (it) => {
      builds++
      const li = document.createElement('li')
      li.textContent = it
      return li
    })
    expect(texts(host)).toEqual(['x', 'x', 'y']) // no collapse to one slot
    expect(builds).toBe(3)

    // Stable across updates: adding a third 'x' builds exactly one new row
    state.items = ['x', 'x', 'y', 'x']
    await tick()
    expect(texts(host)).toEqual(['x', 'x', 'y', 'x'])
    expect(builds).toBe(4)

    // Removing one duplicate removes exactly one row
    state.items = ['x', 'y', 'x']
    await tick()
    expect(texts(host)).toEqual(['x', 'y', 'x'])

    // Clear disposes everything — no phantom rows
    state.items = []
    await tick()
    expect(texts(host)).toEqual([])
    expect(host.querySelectorAll('li').length).toBe(0)
  })

  it('does not confuse primitives of different types with equal string forms (D-2)', () => {
    const state = DiamondCore.reactive({ items: [1, '1'] as Array<number | string> })
    const { host, anchor } = setup()
    DiamondCore.repeat(anchor, () => state.items, (it) => {
      const li = document.createElement('li')
      li.textContent = typeof it
      return li
    })
    expect(texts(host)).toEqual(['number', 'string'])
  })
})
