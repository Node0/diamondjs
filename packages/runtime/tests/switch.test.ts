/**
 * @vitest-environment happy-dom
 *
 * DiamondCore.switch (v2.1, Amendment A1 §7.3) — first-match-wins dispatch,
 * default fallback, single on-evaluation, branch caching, cleanup.
 */
import { describe, it, expect, vi } from 'vitest'
import { DiamondCore } from '../src/core'

const tick = () => new Promise((r) => setTimeout(r, 0))

function mount(): { host: HTMLElement; anchor: Comment } {
  const host = document.createElement('div')
  const anchor = document.createComment('switch')
  host.appendChild(anchor)
  return { host, anchor }
}

const div = (text: string) => () => {
  const el = document.createElement('div')
  el.textContent = text
  return el
}

describe('DiamondCore.switch', () => {
  it('renders the first matching case (document order wins)', () => {
    const { host, anchor } = mount()
    DiamondCore.switch(anchor, () => 'b', [
      { match: (v) => v === 'a', make: div('A') },
      { match: (v) => v === 'b', make: div('B-first') },
      { match: () => true, make: div('B-second') }, // also matches — must lose
    ])
    expect(host.textContent).toBe('B-first')
  })

  it('renders the default when no case matches, removes it when one does', async () => {
    const { host, anchor } = mount()
    const state = DiamondCore.reactive({ status: 'unknown' })
    DiamondCore.switch(
      anchor,
      () => state.status,
      [{ match: (v) => v === 'ready', make: div('Ready') }],
      div('Unexpected')
    )
    expect(host.textContent).toBe('Unexpected')

    state.status = 'ready'
    await tick()
    expect(host.textContent).toBe('Ready')
  })

  it('renders nothing without a default when no case matches', () => {
    const { host, anchor } = mount()
    DiamondCore.switch(anchor, () => 'nope', [
      { match: (v) => v === 'a', make: div('A') },
    ])
    expect(host.textContent).toBe('')
  })

  it('evaluates the on-getter exactly ONCE per update', async () => {
    const { anchor } = mount()
    const state = DiamondCore.reactive({ n: 0 })
    const onGetter = vi.fn(() => state.n)
    DiamondCore.switch(anchor, onGetter, [
      { match: (v) => v === 0, make: div('zero') },
      { match: (v) => v === 1, make: div('one') },
      { match: (v) => v === 2, make: div('two') },
    ])
    expect(onGetter).toHaveBeenCalledTimes(1) // N match tests, one evaluation

    state.n = 2
    await tick()
    expect(onGetter).toHaveBeenCalledTimes(2)
  })

  it('caches branches: re-activating a case reuses the same subtree', async () => {
    const { host, anchor } = mount()
    const state = DiamondCore.reactive({ s: 'a' })
    const makeA = vi.fn(div('A'))
    DiamondCore.switch(anchor, () => state.s, [
      { match: (v) => v === 'a', make: makeA },
      { match: (v) => v === 'b', make: div('B') },
    ])
    const firstNode = host.firstChild

    state.s = 'b'
    await tick()
    state.s = 'a'
    await tick()

    expect(makeA).toHaveBeenCalledTimes(1) // built once, reused
    expect(host.firstChild).toBe(firstNode) // same node identity
  })

  it('tracks reactive deps of expression-style match predicates', async () => {
    const { host, anchor } = mount()
    const state = DiamondCore.reactive({ progress: 0.2 })
    DiamondCore.switch(
      anchor,
      () => state.progress,
      [{ match: () => state.progress > 0.5, make: div('far') }],
      div('near')
    )
    expect(host.textContent).toBe('near')

    state.progress = 0.9
    await tick()
    expect(host.textContent).toBe('far')
  })

  it('disposes all built branches when the enclosing scope cleans up', async () => {
    const { host, anchor } = mount()
    const state = DiamondCore.reactive({ s: 'a', label: 'x' })

    const { cleanup } = DiamondCore.captureScope(() => {
      DiamondCore.switch(anchor, () => state.s, [
        {
          match: (v) => v === 'a',
          make: () => {
            const el = document.createElement('div')
            DiamondCore.bind(el, 'textContent', () => state.label)
            return el
          },
        },
      ])
    })
    await tick()
    expect(host.textContent).toBe('x')

    cleanup()
    state.label = 'y'
    await tick()
    expect(host.textContent).toBe('x') // branch binding disposed with the scope
  })
})
