/**
 * @vitest-environment happy-dom
 *
 * DiamondCore.delegate (v2.1, DDR §7.2 / 2.1b) — one container listener,
 * closest() + registry walk-up, source-agnostic homogenization.
 */
import { describe, it, expect, vi } from 'vitest'
import { DiamondCore } from '../src/core'

const tick = () => new Promise((r) => setTimeout(r, 0))

interface Row {
  id: number
  label: string
}

function mountList(items: Iterable<Row>): {
  host: HTMLElement
} {
  const host = document.createElement('ul')
  const anchor = document.createComment('repeat')
  host.appendChild(anchor)
  DiamondCore.repeat(anchor, () => items, (row: Row) => {
    const li = document.createElement('li')
    const span = document.createElement('span')
    span.textContent = row.label
    li.appendChild(span) // nested descendant — exercises closest() + walk-up
    return li
  })
  return { host }
}

describe('DiamondCore.delegate', () => {
  it('resolves a click on a nested descendant to the row item', () => {
    const rows = [
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]
    const { host } = mountList(rows)
    const handler = vi.fn()
    DiamondCore.delegate<Row>(host, 'click', 'li', handler)

    // Click the SPAN inside the second row — closest('li') + registry walk-up
    const spans = host.querySelectorAll('span')
    spans[1].dispatchEvent(new Event('click', { bubbles: true }))

    expect(handler).toHaveBeenCalledTimes(1)
    const [item, , node] = handler.mock.calls[0]
    expect(item).toBe(rows[1])
    expect((node as Element).tagName.toLowerCase()).toBe('li')
  })

  it('homogenization: identical behavior over a reactive array and a Collection', async () => {
    const arrayRows = DiamondCore.reactive({
      items: [{ id: 1, label: 'a' }] as Row[],
    })
    const collRows = DiamondCore.collection<Row>([{ id: 1, label: 'a' }])

    // Source 1: reactive array
    const hostA = document.createElement('ul')
    const anchorA = document.createComment('repeat')
    hostA.appendChild(anchorA)
    DiamondCore.repeat(anchorA, () => arrayRows.items, (r: Row) => {
      const li = document.createElement('li')
      li.textContent = r.label
      return li
    })

    // Source 2: Collection
    const hostB = document.createElement('ul')
    const anchorB = document.createComment('repeat')
    hostB.appendChild(anchorB)
    DiamondCore.repeat(anchorB, () => collRows, (r: Row) => {
      const li = document.createElement('li')
      li.textContent = r.label
      return li
    })
    await tick()

    const gotA: Row[] = []
    const gotB: Row[] = []
    DiamondCore.delegate<Row>(hostA, 'click', 'li', (item) => gotA.push(item))
    DiamondCore.delegate<Row>(hostB, 'click', 'li', (item) => gotB.push(item))

    hostA.querySelector('li')!.dispatchEvent(new Event('click', { bubbles: true }))
    hostB.querySelector('li')!.dispatchEvent(new Event('click', { bubbles: true }))

    // The delegate call is byte-identical for both sources; each resolves its own item
    expect(gotA[0].label).toBe('a')
    expect(gotB[0].label).toBe('a')
  })

  it('no handler call when the selector does not match', () => {
    const { host } = mountList([{ id: 1, label: 'one' }])
    const handler = vi.fn()
    DiamondCore.delegate<Row>(host, 'click', 'button', handler)

    host.querySelector('span')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('no-op when the matched node has no registered item (ratified A2)', () => {
    const host = document.createElement('ul')
    const loose = document.createElement('li') // NOT rendered by repeat
    loose.textContent = 'loose'
    host.appendChild(loose)

    const handler = vi.fn()
    DiamondCore.delegate<Row>(host, 'click', 'li', handler)
    loose.dispatchEvent(new Event('click', { bubbles: true }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('cleanup removes the container listener', () => {
    const rows = [{ id: 1, label: 'one' }]
    const { host } = mountList(rows)
    const handler = vi.fn()
    const cleanup = DiamondCore.delegate<Row>(host, 'click', 'li', handler)

    cleanup()
    host.querySelector('li')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(handler).not.toHaveBeenCalled()
  })

  it('a delegate created inside a scope is disposed with that scope', () => {
    const rows = [{ id: 1, label: 'one' }]
    const { host } = mountList(rows)
    const handler = vi.fn()

    const { cleanup } = DiamondCore.captureScope(() => {
      DiamondCore.delegate<Row>(host, 'click', 'li', handler)
    })
    host.querySelector('li')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)

    cleanup()
    host.querySelector('li')!.dispatchEvent(new Event('click', { bubbles: true }))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('rows removed by repeat are dropped from the registry', async () => {
    const state = DiamondCore.reactive({
      items: [
        { id: 1, label: 'one' },
        { id: 2, label: 'two' },
      ] as Row[],
    })
    const host = document.createElement('ul')
    const anchor = document.createComment('repeat')
    host.appendChild(anchor)
    DiamondCore.repeat(anchor, () => state.items, (r: Row) => {
      const li = document.createElement('li')
      li.textContent = r.label
      return li
    })
    const removedNode = host.querySelectorAll('li')[0]

    state.items = [state.items[1]] // drop row 1
    await tick()

    const handler = vi.fn()
    DiamondCore.delegate<Row>(host, 'click', 'li', handler)
    // Re-attach the removed node manually — its registry entry must be gone
    host.appendChild(removedNode)
    removedNode.dispatchEvent(new Event('click', { bubbles: true }))
    expect(handler).not.toHaveBeenCalled()
  })
})
