/**
 * @vitest-environment happy-dom
 *
 * Issue #17 — a multi-root body must be removable.
 *
 * The compiler mounts a body with 2+ roots as a DocumentFragment. Inserting a
 * fragment moves its children into the parent and leaves it empty, so the
 * runtime no longer held the nodes it mounted: switch()/if() and
 * Component.unmount() called .remove() on the spent fragment (which has no
 * remove()). The runtime must track the mounted RANGE instead — including
 * siblings a nested if/repeat inserts after mount.
 *
 * The make() bodies below mirror compiled output: build the fragment, append
 * the nested anchor, THEN wire the nested structural.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DiamondCore } from '../src/core'
import { Component } from '../src/component'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

const el = (tag: string, text: string): HTMLElement => {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}

const frag = (...nodes: Node[]): DocumentFragment => {
  const f = document.createDocumentFragment()
  for (const n of nodes) f.appendChild(n)
  return f
}

function mountAnchor(name: string): { host: HTMLElement; anchor: Comment } {
  const host = document.createElement('div')
  const anchor = document.createComment(name)
  host.appendChild(anchor)
  return { host, anchor }
}

const errors = vi.spyOn(console, 'error')
afterEach(() => errors.mockClear())

describe('switch(): multi-root case bodies (#17)', () => {
  it('switching away from a two-root case leaves only the new branch; switching back rebuilds it', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'a' })
    const makeA = vi.fn(() => frag(el('b', 'A1'), el('b', 'A2')))
    DiamondCore.switch(anchor, () => state.mode, [
      { match: (v) => v === 'a', make: makeA },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    expect(host.innerHTML).toBe('<b>A1</b><b>A2</b><!--switch-->')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<i>B</i><!--switch-->')
    expect(errors).not.toHaveBeenCalled()

    state.mode = 'a'
    await tick()
    expect(host.innerHTML).toBe('<b>A1</b><b>A2</b><!--switch-->')
    expect(makeA).toHaveBeenCalledTimes(2)
    expect(errors).not.toHaveBeenCalled()
  })

  it('a two-root <default> is removed when a case matches, and rebuilt when none does', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'other' })
    DiamondCore.switch(
      anchor,
      () => state.mode,
      [{ match: (v) => v === 'a', make: () => el('i', 'A') }],
      () => frag(el('b', 'D1'), el('b', 'D2'))
    )
    expect(host.innerHTML).toBe('<b>D1</b><b>D2</b><!--switch-->')

    state.mode = 'a'
    await tick()
    expect(host.innerHTML).toBe('<i>A</i><!--switch-->')
    expect(errors).not.toHaveBeenCalled()

    state.mode = 'other'
    await tick()
    expect(host.innerHTML).toBe('<b>D1</b><b>D2</b><!--switch-->')
  })

  it('removes nodes a nested if inserted AFTER the body was mounted', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'a', show: false })
    DiamondCore.switch(anchor, () => state.mode, [
      {
        match: (v) => v === 'a',
        make: () => {
          const ifAnchor = document.createComment('if')
          const root = frag(el('b', 'A'), ifAnchor)
          DiamondCore.if(ifAnchor, [{ when: () => state.show, make: () => el('p', 'X') }])
          return root
        },
      },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    state.show = true // inserted after mount — not in any insert-time snapshot
    await tick()
    expect(host.textContent).toBe('AX')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<i>B</i><!--switch-->')
    expect(errors).not.toHaveBeenCalled()
  })

  it('removes repeat rows when the anchor is the FIRST root (rows land before it)', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'a', items: ['x'] })
    DiamondCore.switch(anchor, () => state.mode, [
      {
        match: (v) => v === 'a',
        make: () => {
          const repeatAnchor = document.createComment('repeat')
          const root = frag(repeatAnchor, el('b', 'tail'))
          DiamondCore.repeat(repeatAnchor, () => state.items, (item) => el('li', item))
          return root
        },
      },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    // the one start marker: the body begins with a structural, whose output moves
    expect(host.innerHTML).toBe('<!----><li>x</li><!--repeat--><b>tail</b><!--switch-->')
    state.items = ['y', 'z'] // the row that was first at mount is gone
    await tick()
    expect(host.textContent).toBe('yztail')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<i>B</i><!--switch-->')
    expect(errors).not.toHaveBeenCalled()
  })

  it('removes a leading if branch that was rendered at mount and then replaced', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'a', show: true })
    DiamondCore.switch(anchor, () => state.mode, [
      {
        match: (v) => v === 'a',
        make: () => {
          const ifAnchor = document.createComment('if')
          const root = frag(ifAnchor, el('b', 'tail'))
          // renders into the fragment at once: the body's first node is the branch
          DiamondCore.if(ifAnchor, [{ when: () => state.show, make: () => el('p', 'X') }])
          return root
        },
      },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    expect(host.innerHTML).toBe('<!----><p>X</p><!--if--><b>tail</b><!--switch-->')
    state.show = false
    await tick()
    state.show = true // a NEW <p>; the one mounted first is detached
    await tick()
    expect(host.textContent).toBe('Xtail')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<i>B</i><!--switch-->')
    expect(errors).not.toHaveBeenCalled()
  })

  it('removes the output of a body whose ONLY root is a nested structural', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'a', show: true })
    DiamondCore.switch(anchor, () => state.mode, [
      {
        match: (v) => v === 'a',
        make: () => {
          const ifAnchor = document.createComment('if')
          // compiler order for a sole structural root: wire, then return the anchor
          DiamondCore.if(ifAnchor, [{ when: () => state.show, make: () => el('p', 'X') }])
          return ifAnchor
        },
      },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    await tick() // the nested if places on the next microtask (detached anchor)
    expect(host.textContent).toBe('X')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<i>B</i><!--switch-->')
  })

  it('leaves siblings outside the range alone', async () => {
    const host = document.createElement('div')
    const anchor = document.createComment('switch')
    host.append(el('h1', 'before'), anchor, el('h2', 'after'))
    const state = DiamondCore.reactive({ mode: 'a' })
    DiamondCore.switch(anchor, () => state.mode, [
      { match: (v) => v === 'a', make: () => frag(el('b', 'A1'), el('b', 'A2')) },
    ])
    expect(host.textContent).toBe('beforeA1A2after')

    state.mode = 'none'
    await tick()
    expect(host.innerHTML).toBe('<h1>before</h1><!--switch--><h2>after</h2>')
  })

  it('the walk is bounded by the owning anchor when `last` was removed externally', async () => {
    const host = document.createElement('div')
    const anchor = document.createComment('switch')
    host.append(el('h1', 'before'), anchor, el('h2', 'after'))
    const state = DiamondCore.reactive({ mode: 'a' })
    DiamondCore.switch(anchor, () => state.mode, [
      { match: (v) => v === 'a', make: () => frag(el('b', 'A1'), el('b', 'A2')) },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    host.querySelectorAll('b')[1].remove() // foreign code takes the range's last node

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<h1>before</h1><i>B</i><!--switch--><h2>after</h2>')
    expect(errors).not.toHaveBeenCalled()
  })

  it('the #15 shape: [whitespace, if-anchor, whitespace] is fully removed, with no marker', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'a', show: false })
    DiamondCore.switch(anchor, () => state.mode, [
      {
        match: (v) => v === 'a',
        make: () => {
          const ifAnchor = document.createComment('if')
          const root = frag(
            document.createTextNode('\n  '),
            ifAnchor,
            document.createTextNode('\n')
          )
          DiamondCore.if(ifAnchor, [{ when: () => state.show, make: () => el('p', 'X') }])
          return root
        },
      },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    state.show = true // the branch inserts before the if-anchor, after mount
    await tick()
    expect(host.innerHTML).toBe('\n  <p>X</p><!--if-->\n<!--switch-->')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<i>B</i><!--switch-->')
    expect(errors).not.toHaveBeenCalled()
  })

  it('a placeholder comment root (empty case, dead switch) gets no start marker', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'a' })
    DiamondCore.switch(anchor, () => state.mode, [
      { match: (v) => v === 'a', make: () => document.createComment('empty') },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    expect(host.innerHTML).toBe('<!--empty--><!--switch-->')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<i>B</i><!--switch-->')
  })

  it('single-root bodies keep their output: no marker nodes', async () => {
    const { host, anchor } = mountAnchor('switch')
    const state = DiamondCore.reactive({ mode: 'a' })
    DiamondCore.switch(anchor, () => state.mode, [
      { match: (v) => v === 'a', make: () => el('b', 'A') },
      { match: (v) => v === 'b', make: () => el('i', 'B') },
    ])
    expect(host.innerHTML).toBe('<b>A</b><!--switch-->')
    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<i>B</i><!--switch-->')
  })
})

describe('if(): the same mounted-range mechanism (#17)', () => {
  it('a two-root branch is fully removed when toggled off and rebuilt when toggled on', async () => {
    const { host, anchor } = mountAnchor('if')
    const state = DiamondCore.reactive({ on: true })
    DiamondCore.if(anchor, [
      { when: () => state.on, make: () => frag(el('b', '1'), el('b', '2')) },
    ])
    expect(host.innerHTML).toBe('<b>1</b><b>2</b><!--if-->')

    state.on = false
    await tick()
    expect(host.innerHTML).toBe('<!--if-->')
    expect(errors).not.toHaveBeenCalled()

    state.on = true
    await tick()
    expect(host.innerHTML).toBe('<b>1</b><b>2</b><!--if-->')
  })
})

describe('Component: multi-root templates (#17)', () => {
  const cleanup = vi.fn()
  afterEach(() => cleanup.mockClear())

  class TwoRoots extends Component {
    createTemplate(): HTMLElement {
      this.registerCleanup(cleanup)
      return frag(el('h1', 'Title'), el('p', 'Body')) as unknown as HTMLElement
    }
  }

  it('mount then unmount leaves the host empty and runs cleanups once', () => {
    const host = document.createElement('div')
    const c = new TwoRoots()
    c.mount(host)
    expect(host.innerHTML).toBe('<h1>Title</h1><p>Body</p>')

    expect(() => c.unmount()).not.toThrow()
    expect(host.innerHTML).toBe('')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('can be mounted again after unmount', () => {
    const host = document.createElement('div')
    const c = new TwoRoots()
    c.mount(host)
    c.unmount()
    expect(() => c.mount(host)).not.toThrow()
    expect(host.innerHTML).toBe('<h1>Title</h1><p>Body</p>')
    c.unmount()
    expect(host.innerHTML).toBe('')
  })

  it("removes only its own nodes from a host it shares with other content", () => {
    const host = document.createElement('div')
    host.appendChild(el('header', 'H'))
    const c = new TwoRoots()
    c.mount(host)
    host.appendChild(el('footer', 'F'))

    c.unmount()
    expect(host.innerHTML).toBe('<header>H</header><footer>F</footer>')
  })

  it('removes a root-level if branch that rendered before its anchor', async () => {
    class RootIf extends Component {
      state = DiamondCore.reactive({ a: true })
      createTemplate(): HTMLElement {
        const ifAnchor = document.createComment('if')
        const root = frag(ifAnchor, el('span', 'tail'))
        DiamondCore.if(ifAnchor, [{ when: () => this.state.a, make: () => el('p', 'A') }])
        return root as unknown as HTMLElement
      }
    }
    const host = document.createElement('div')
    const c = new RootIf()
    c.mount(host)
    await tick()
    expect(host.textContent).toBe('Atail')

    c.unmount()
    expect(host.innerHTML).toBe('')
  })
})
