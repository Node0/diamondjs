/**
 * @vitest-environment happy-dom
 *
 * First-mount placement for structural directives (issue #7).
 *
 * Compiled templates — and any hand-written template that mirrors them —
 * create the anchor, call the structural, and only THEN append the anchor to
 * its parent. The structural's first pass runs synchronously inside the call,
 * so `anchor.parentNode` is null at that moment. Before the fix the runtime's
 * `anchor.parentNode?.insertBefore(...)` silently skipped the insert, the
 * branch index was recorded as active, and the branch appeared only when the
 * condition later CHANGED. The runtime now defers a detached placement to the
 * next microtask (by which time Component.mount() has attached the tree).
 *
 * Every existing structural test appends the anchor BEFORE calling the
 * directive — the opposite order from the compiler — which is why none of
 * them caught this.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCore } from '../src/core'
import { Component } from '../src/component'

// Flush the scheduler's microtask queue (reactive updates are batched).
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

const mk = (text: string): HTMLElement => {
  const span = document.createElement('span')
  span.textContent = text
  return span
}

describe('if(): compiler call order (anchor appended AFTER the call)', () => {
  it('renders a truthy branch on first mount, not on the next change', async () => {
    const state = DiamondCore.reactive({ ready: true })
    const host = document.createElement('section')
    const anchor = document.createComment('if')

    DiamondCore.if(anchor, [{ when: () => state.ready, make: () => mk('READY') }])
    host.appendChild(anchor) // ← compiler order

    await tick()
    expect(host.innerHTML).toBe('<span>READY</span><!--if-->')
  })

  it('still toggles normally afterwards', async () => {
    const state = DiamondCore.reactive({ ready: true })
    const host = document.createElement('section')
    const anchor = document.createComment('if')
    DiamondCore.if(anchor, [{ when: () => state.ready, make: () => mk('READY') }])
    host.appendChild(anchor)
    await tick()

    state.ready = false
    await tick()
    expect(host.querySelector('span')).toBeNull()

    state.ready = true
    await tick()
    expect(host.querySelector('span')?.textContent).toBe('READY')
  })

  it('places only the CURRENT branch when the condition changed while detached', async () => {
    const state = DiamondCore.reactive({ a: true, b: false })
    const host = document.createElement('section')
    const anchor = document.createComment('if')
    DiamondCore.if(anchor, [
      { when: () => state.a, make: () => mk('A') },
      { when: () => state.b, make: () => mk('B') },
    ])
    // Flip before the anchor is attached: A was built detached and is disposed;
    // B is built (also detached) on the flush.
    state.a = false
    state.b = true
    host.appendChild(anchor)

    await tick()
    const spans = Array.from(host.querySelectorAll('span')).map((s) => s.textContent)
    expect(spans).toEqual(['B'])
  })

  it('does not resurrect a branch disposed before the anchor was attached', async () => {
    const state = DiamondCore.reactive({ show: true })
    const host = document.createElement('section')
    const anchor = document.createComment('if')
    DiamondCore.if(anchor, [{ when: () => state.show, make: () => mk('X') }])
    state.show = false
    host.appendChild(anchor)

    await tick()
    expect(host.querySelector('span')).toBeNull()
  })
})

describe('switch(): compiler call order', () => {
  it('renders the matching case on first mount', async () => {
    const state = DiamondCore.reactive({ status: 'ready' })
    const host = document.createElement('section')
    const anchor = document.createComment('switch')
    DiamondCore.switch(
      anchor,
      () => state.status,
      [
        { match: (v) => v === 'loading', make: () => mk('LOADING') },
        { match: (v) => v === 'ready', make: () => mk('READY') },
      ],
      () => mk('UNEXPECTED')
    )
    host.appendChild(anchor)

    await tick()
    expect(host.querySelector('span')?.textContent).toBe('READY')

    state.status = 'loading'
    await tick()
    expect(host.querySelector('span')?.textContent).toBe('LOADING')
  })
})

describe('repeat(): compiler call order', () => {
  it('renders a pre-populated list on first mount, in order', async () => {
    const state = DiamondCore.reactive({ items: ['a', 'b', 'c'] })
    const host = document.createElement('ul')
    const anchor = document.createComment('repeat')
    DiamondCore.repeat(anchor, () => state.items, (item) => {
      const li = document.createElement('li')
      li.textContent = String(item)
      return li
    })
    host.appendChild(anchor)

    await tick()
    expect(Array.from(host.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'a',
      'b',
      'c',
    ])
    // The anchor stays the trailing marker
    expect(host.lastChild?.nodeType).toBe(Node.COMMENT_NODE)
  })

  it('applies the LATEST order when the list was reordered while detached', async () => {
    const state = DiamondCore.reactive({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    const host = document.createElement('ul')
    const anchor = document.createComment('repeat')
    DiamondCore.repeat(anchor, () => state.items, (item) => {
      const li = document.createElement('li')
      li.textContent = String((item as { id: number }).id)
      return li
    })
    state.items.reverse()
    host.appendChild(anchor)

    await tick()
    expect(Array.from(host.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      '3',
      '2',
      '1',
    ])
  })

  it('does not place rows removed before the anchor was attached', async () => {
    const state = DiamondCore.reactive({ items: ['a', 'b'] })
    const host = document.createElement('ul')
    const anchor = document.createComment('repeat')
    DiamondCore.repeat(anchor, () => state.items, (item) => {
      const li = document.createElement('li')
      li.textContent = String(item)
      return li
    })
    state.items.pop()
    host.appendChild(anchor)

    await tick()
    expect(Array.from(host.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['a'])
  })
})

describe('Component whose template ROOT is a structural', () => {
  // The compiler cannot pre-attach a root anchor (there is no parent yet);
  // Component.mount() appends it after createTemplate() returns. The runtime
  // guard is what makes this case render.
  class RootIf extends Component {
    state = DiamondCore.reactive({ ready: true })
    createTemplate(): HTMLElement {
      const anchor = document.createComment('if')
      DiamondCore.if(anchor, [{ when: () => this.state.ready, make: () => mk('ROOT-READY') }])
      return anchor as unknown as HTMLElement
    }
  }

  it('renders the branch after mount()', async () => {
    const host = document.createElement('div')
    const c = new RootIf()
    c.mount(host)
    await tick()
    // #17: a body that begins with a structural mounts behind a start marker,
    // so unmount() can remove the branch that rendered before the anchor.
    expect(host.innerHTML).toBe('<!----><span>ROOT-READY</span><!--if-->')
    c.unmount()
    expect(host.innerHTML).toBe('')
  })
})
