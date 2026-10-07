/**
 * @vitest-environment happy-dom
 *
 * Lifecycle Contract §10.2 — the hooks (L-1 … L-15). Each phase callback's
 * promise, pinned where it runs. mounted() needs a connected host; D8 children
 * are built by hand with DiamondCore.child(), exactly as compiled output will.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Component } from '../../src/component'
import { DiamondCore } from '../../src/core'
import { reactive } from '../../src/decorators'
import { Router, type RouteMap } from '../../src/router'
import { connectedHost, detachedHost, listenerCount, liveEffects, tick } from './harness'

/** Shared order log — reset per test. */
let log: string[] = []
beforeEach(() => {
  log = []
})

const el = (tag: string, cls?: string): HTMLElement => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

/** A leaf component that reports where it is when each callback runs. */
class Leaf extends Component {
  static constructions = 0
  constructor(readonly tag = 'leaf') {
    super()
    Leaf.constructions++
  }
  createTemplate(): HTMLElement {
    return el('p', `leaf-${this.tag}`)
  }
  override constructed(): void {
    log.push(`constructed:${this.tag}`)
  }
  override mounting(): void {
    log.push(`mounting:${this.tag}`)
  }
  override mounted(): void {
    log.push(`mounted:${this.tag}:${this.getElement()!.isConnected}`)
  }
}

/** A parent that hosts one Leaf as a D8 child, built into its own detached template. */
class Parent extends Component {
  child = new Leaf('child')
  createTemplate(): HTMLElement {
    const div = el('div', 'parent')
    const slot = el('section')
    div.appendChild(slot)
    DiamondCore.child(this.child, slot)
    return div
  }
  override mounted(): void {
    log.push(`mounted:parent:${this.getElement()!.isConnected}`)
  }
}

/** <outlet name="main"> in the document (what Router.start() discovers). */
function rootShell(...names: string[]): void {
  document.body.innerHTML = ''
  for (const name of names) {
    const outlet = document.createElement('outlet')
    outlet.setAttribute('name', name)
    document.body.appendChild(outlet)
  }
}

async function withRouter(routes: RouteMap, run: (router: Router) => Promise<void>): Promise<void> {
  history.replaceState(null, '', '/')
  const router = new Router(routes)
  await router.start()
  try {
    await run(router)
  } finally {
    router.stop()
  }
}

// ── constructed ────────────────────────────────────────────────────────────

describe('constructed()', () => {
  it('L-1 constructed: an effect created inside tracks a @reactive field (both tsconfig runs)', async () => {
    class Counter extends Component {
      @reactive count = 0
      runs = 0
      override constructed(): void {
        DiamondCore.effect(() => {
          void this.count
          this.runs++
        })
      }
      createTemplate(): HTMLElement {
        return el('div')
      }
    }
    const c = new Counter()
    c.ensureConstructed()
    expect(c.runs).toBe(1)
    c.count = 1
    await tick()
    expect(c.runs).toBe(2) // the write re-ran the effect: the field was reactive when constructed() ran
    c.dispose()
  })

  it('L-2 constructed: getElement() is null, phase is constructed, and it runs exactly once across construct → mount → unmount → mount', () => {
    class Once extends Component {
      calls = 0
      seenElement: HTMLElement | null = el('div') // sentinel: must be overwritten with null
      seenPhase = ''
      override constructed(): void {
        this.calls++
        this.seenElement = this.getElement()
        this.seenPhase = this.phase
      }
      createTemplate(): HTMLElement {
        return el('div')
      }
    }
    const host = connectedHost()
    const c = new Once()
    c.mount(host)
    c.unmount()
    c.mount(host)
    expect(c.calls).toBe(1)
    expect(c.seenElement).toBeNull()
    expect(c.seenPhase).toBe('constructed')
    c.unmount()
  })

  it('L-3 constructed: runs at first mount() when hand-constructed, before any mount() when router-constructed, inside DiamondCore.child() for a D8 child', async () => {
    // Hand-constructed: nothing runs until the first framework entry.
    const hand = new Leaf('hand')
    expect(hand.phase).toBe('constructing')
    expect(log).toEqual([])
    hand.mount(connectedHost())
    expect(log).toEqual(['constructed:hand', 'mounting:hand', 'mounted:hand:true'])
    hand.unmount()

    // Router-constructed: every incoming component is constructed before any mounts.
    log = []
    class Shell extends Leaf {
      constructor(_params?: Record<string, unknown>) {
        super('shell')
      }
      override createTemplate(): HTMLElement {
        const div = el('div', 'shell')
        const outlet = document.createElement('outlet')
        outlet.setAttribute('name', 'sub')
        div.appendChild(outlet)
        return div
      }
    }
    class Sub extends Leaf {
      constructor(_params?: Record<string, unknown>) {
        super('sub')
      }
    }
    class Home extends Leaf {
      constructor(_params?: Record<string, unknown>) {
        super('home')
      }
    }
    rootShell('main')
    await withRouter(
      {
        home: { path: '', component: Home, outlet: 'main' },
        shell: {
          path: 's',
          component: Shell,
          outlet: 'main',
          children: { sub: { path: 'one', component: Sub, outlet: 'sub' } },
        },
      },
      async (router) => {
        log = []
        await router.navigate('/s/one') // one commit, two incoming components
        expect(log.slice(0, 2).sort()).toEqual(['constructed:shell', 'constructed:sub'])
        expect(log.findIndex((l) => l.startsWith('mounting:'))).toBe(2) // both constructed before either mounts
        expect(log).toContain('mounted:shell:true')
        expect(log).toContain('mounted:sub:true')
      }
    )

    // D8 child: constructed() runs inside DiamondCore.child(), before the child's mounting().
    log = []
    const p = new Parent()
    expect(p.child.phase).toBe('constructing')
    p.mount(connectedHost())
    expect(log.slice(0, 2)).toEqual(['constructed:child', 'mounting:child'])
    p.unmount()
  })
})

// ── mounted ────────────────────────────────────────────────────────────────

describe('mounted()', () => {
  it('L-4 mounted: getElement().isConnected is true for a root, a D8 child, a child inside if, a repeat row, a route component and a root-structural page', async () => {
    // root
    const root = new Leaf('root')
    root.mount(connectedHost())
    root.unmount()

    // D8 child (and its parent)
    const parent = new Parent()
    parent.mount(connectedHost())
    parent.unmount()

    // child inside an if branch, and a repeat row
    class Structurals extends Component {
      rows = DiamondCore.reactive(['r1', 'r2'])
      createTemplate(): HTMLElement {
        const div = el('div')
        const ifAnchor = document.createComment('if')
        div.appendChild(ifAnchor)
        DiamondCore.if(ifAnchor, [
          {
            when: () => true,
            make: () => {
              const section = el('section')
              DiamondCore.child(new Leaf('in-if'), section)
              return section
            },
          },
        ])
        const ul = el('ul')
        const repeatAnchor = document.createComment('repeat')
        ul.appendChild(repeatAnchor)
        DiamondCore.repeat(repeatAnchor, () => this.rows, (row) => {
          const li = el('li')
          DiamondCore.child(new Leaf(row), li)
          return li
        })
        div.appendChild(ul)
        return div
      }
    }
    const s = new Structurals()
    s.mount(connectedHost())
    s.unmount()

    // route component, and a page whose template root is a structural
    class RootIfPage extends Component {
      show = true
      constructor(_params?: Record<string, unknown>) {
        super()
      }
      createTemplate(): HTMLElement {
        const anchor = document.createComment('if')
        DiamondCore.if(anchor, [{ when: () => this.show, make: () => el('h2', 'branch') }])
        return anchor as unknown as HTMLElement
      }
      override mounted(): void {
        log.push(`mounted:root-if-page:${this.getElement()!.isConnected}`)
      }
    }
    class Page extends Leaf {
      constructor(_params?: Record<string, unknown>) {
        super('route')
      }
    }
    rootShell('main')
    await withRouter(
      {
        home: { path: '', component: Page, outlet: 'main' },
        rootif: { path: 'rootif', component: RootIfPage, outlet: 'main' },
      },
      async (router) => {
        await router.navigate('/rootif')
      }
    )

    expect(log.filter((l) => l.startsWith('mounted:'))).toEqual([
      'mounted:root:true',
      'mounted:child:true',
      'mounted:parent:true',
      'mounted:in-if:true',
      'mounted:r1:true',
      'mounted:r2:true',
      'mounted:route:true',
      'mounted:root-if-page:true',
    ])
  })

  it('L-5 mounted: a page whose template root is <if> has the branch nodes in the document when mounted() runs (P-3)', async () => {
    let branchInDocument: boolean | null = null
    let previous: string | null = null
    class RootIfPage extends Component {
      show = true
      constructor(_params?: Record<string, unknown>) {
        super()
      }
      createTemplate(): HTMLElement {
        const anchor = document.createComment('if')
        DiamondCore.if(anchor, [{ when: () => this.show, make: () => el('h2', 'target') }])
        return anchor as unknown as HTMLElement
      }
      override mounted(): void {
        branchInDocument = document.querySelector('.target')?.isConnected ?? false
        previous = (this.getElement()!.previousSibling as Element | null)?.className ?? null
      }
    }
    rootShell('main')
    await withRouter({ home: { path: '', component: RootIfPage, outlet: 'main' } }, async () => {
      expect(branchInDocument).toBe(true)
      expect(previous).toBe('target') // placed before its anchor, synchronously, before the hook
    })
  })

  it('L-6 mounted: a parent with two children delivers child A, child B, then the parent', () => {
    class TwoChildren extends Component {
      a = new Leaf('A')
      b = new Leaf('B')
      createTemplate(): HTMLElement {
        const div = el('div')
        const slotA = el('section')
        const slotB = el('section')
        div.append(slotA, slotB)
        DiamondCore.child(this.a, slotA)
        DiamondCore.child(this.b, slotB)
        return div
      }
      override mounted(): void {
        log.push('mounted:two')
      }
    }
    const t = new TwoChildren()
    t.mount(connectedHost())
    expect(log.filter((l) => l.startsWith('mounted:'))).toEqual(['mounted:A:true', 'mounted:B:true', 'mounted:two'])
    t.unmount()
  })

  it('L-7 mounted: a child built into a detached parent waits for the parent to connect; a child in an if branch is delivered on placement, not on build', async () => {
    // (a) The parent never connects: the child stays `mounting`, no mounted() for either.
    const detached = new Parent()
    detached.mount(detachedHost())
    expect(detached.phase).toBe('mounting')
    expect(detached.child.phase).toBe('mounting')
    expect(log.filter((l) => l.startsWith('mounted:'))).toEqual([])
    detached.dispose()
    expect(detached.child.phase).toBe('disposed') // the child left with the parent's inventory

    // (b) The same shape into a connected host: delivered child-first, in the drain.
    log = []
    const connected = new Parent()
    connected.mount(connectedHost())
    expect(log.filter((l) => l.startsWith('mounted:'))).toEqual(['mounted:child:true', 'mounted:parent:true'])
    connected.unmount()

    // (c) A branch toggled on under a mounted component: inside make() the child
    // has been built but not delivered; the placement that follows delivers it.
    log = []
    let phaseAfterBuild = ''
    let mountedAfterBuild = -1
    class Toggle extends Component {
      state = DiamondCore.reactive({ show: false })
      createTemplate(): HTMLElement {
        const div = el('div')
        const anchor = document.createComment('if')
        div.appendChild(anchor)
        DiamondCore.if(anchor, [
          {
            when: () => this.state.show,
            make: () => {
              const section = el('section')
              const leaf = new Leaf('late')
              DiamondCore.child(leaf, section)
              phaseAfterBuild = leaf.phase
              mountedAfterBuild = log.filter((l) => l.startsWith('mounted:late')).length
              return section
            },
          },
        ])
        return div
      }
    }
    const t = new Toggle()
    t.mount(connectedHost())
    expect(log.filter((l) => l.startsWith('mounted:late'))).toEqual([])
    t.state.show = true
    await tick()
    expect(phaseAfterBuild).toBe('mounting')
    expect(mountedAfterBuild).toBe(0)
    expect(log.filter((l) => l.startsWith('mounted:late'))).toEqual(['mounted:late:true'])
    t.unmount()
  })

  it('L-8 mounted: bindings are applied — a bound textContent reads the field inside the hook', () => {
    let seen: string | null = null
    class Bound extends Component {
      @reactive label = 'hello'
      createTemplate(): HTMLElement {
        const div = el('div')
        DiamondCore.bind(div, 'textContent', () => this.label)
        return div
      }
      override mounted(): void {
        seen = this.getElement()!.textContent
      }
    }
    const b = new Bound()
    b.mount(connectedHost())
    expect(seen).toBe('hello')
    b.unmount()
  })
})

// ── mounting / unmounting / unmounted ─────────────────────────────────────

describe('mounting(), unmounting(), unmounted()', () => {
  it('L-9 mounting: no element, no child constructed yet, generation already incremented, and its effect is disposed by unmount()', async () => {
    const state = DiamondCore.reactive({ n: 0 })
    let runs = 0
    const before = Leaf.constructions
    class P extends Component {
      elementInHook: HTMLElement | null = el('div') // sentinel
      constructionsInHook = -1
      generationInHook = -1
      override mounting(): void {
        this.elementInHook = this.getElement()
        this.constructionsInHook = Leaf.constructions
        this.generationInHook = this.generation
        DiamondCore.effect(() => {
          void state.n
          runs++
        })
      }
      createTemplate(): HTMLElement {
        const div = el('div')
        const slot = el('section')
        div.appendChild(slot)
        DiamondCore.child(new Leaf('l9'), slot) // the child is constructed here, after mounting()
        return div
      }
    }
    const p = new P()
    expect(p.generation).toBe(0)
    p.mount(connectedHost())
    expect(p.elementInHook).toBeNull()
    expect(p.constructionsInHook).toBe(before)
    expect(p.generationInHook).toBe(1)
    expect(runs).toBe(1)
    p.unmount()
    state.n = 1
    await tick()
    expect(runs).toBe(1) // disposed with the mount scope
  })

  it('L-10 unmounting: still connected inside, generation incremented past mounted, and its effect is disposed by the time unmount() returns', async () => {
    const state = DiamondCore.reactive({ n: 0 })
    let runs = 0
    let connectedInHook: boolean | null = null
    let mountedGeneration = -1
    let unmountingGeneration = -1
    class P extends Component {
      createTemplate(): HTMLElement {
        return el('div')
      }
      override mounted(): void {
        mountedGeneration = this.generation
      }
      override unmounting(): void {
        connectedInHook = this.getElement()!.isConnected
        unmountingGeneration = this.generation
        DiamondCore.effect(() => {
          void state.n
          runs++
        })
      }
    }
    const effectsBefore = liveEffects()
    const p = new P()
    p.mount(connectedHost())
    p.unmount()
    expect(connectedInHook).toBe(true)
    expect(unmountingGeneration).toBe(mountedGeneration + 1)
    expect(runs).toBe(1)
    state.n = 1
    await tick()
    expect(runs).toBe(1)
    expect(liveEffects() - effectsBefore).toBe(0)
  })

  it('L-11 unmounting: a throw does not stop teardown — range removed, inventory empty, phase unmounted, ring records callback-failed', () => {
    class Throws extends Component {
      createTemplate(): HTMLElement {
        const div = el('div')
        DiamondCore.bind(div, 'textContent', () => 'x')
        DiamondCore.on(div, 'click', () => {})
        return div
      }
      override unmounting(): void {
        throw new Error('unmounting boom')
      }
    }
    const host = connectedHost()
    const listenersBefore = listenerCount()
    const effectsBefore = liveEffects()
    const t = new Throws()
    t.mount(host)
    expect(() => t.unmount()).not.toThrow()
    expect(host.innerHTML).toBe('')
    expect(listenerCount() - listenersBefore).toBe(0)
    expect(liveEffects() - effectsBefore).toBe(0)
    expect(t.phase).toBe('unmounted')
    const failed = t.history().find((r) => r.cause === 'callback-failed')
    expect(failed).toMatchObject({ from: 'unmounting', to: 'unmounting', outcome: 'failed' })
    expect(String(failed!.error)).toContain('unmounting boom')
  })

  it('L-12 unmounted: range nodes detached, inventory empty (listener and effect deltas 0), @reactive values preserved, remount at generation + 2', () => {
    let phaseInHook = ''
    let elementInHook: HTMLElement | null = el('div') // sentinel
    class TwoRoots extends Component {
      @reactive label = 'initial'
      createTemplate(): HTMLElement {
        const frag = document.createDocumentFragment()
        const h1 = el('h1')
        DiamondCore.bind(h1, 'textContent', () => this.label)
        const p = el('p')
        DiamondCore.on(p, 'click', () => {})
        frag.append(h1, p)
        return frag as unknown as HTMLElement
      }
      override unmounted(): void {
        phaseInHook = this.phase
        elementInHook = this.getElement()
      }
    }
    const host = connectedHost()
    const listenersBefore = listenerCount()
    const effectsBefore = liveEffects()
    const c = new TwoRoots()
    c.mount(host)
    const mountedGeneration = c.generation
    const nodes = Array.from(host.childNodes)
    expect(nodes).toHaveLength(2)
    c.label = 'changed'

    c.unmount()
    for (const n of nodes) expect(n.parentNode).toBeNull()
    expect(phaseInHook).toBe('unmounted')
    expect(elementInHook).toBeNull()
    expect(listenerCount() - listenersBefore).toBe(0)
    expect(liveEffects() - effectsBefore).toBe(0)
    expect(c.label).toBe('changed')

    expect(() => c.mount(host)).not.toThrow()
    expect(c.generation).toBe(mountedGeneration + 2)
    expect(host.querySelector('h1')!.textContent).toBe('changed')
    c.unmount()
  })

  it('L-13 unmounted: the instance scope survives — a field-initializer debounce still cancels after unmount → remount → unmount (P-4)', () => {
    vi.useFakeTimers()
    try {
      class Debounced extends Component {
        calls = 0
        handler = this.debounce(() => this.calls++, 100)
        createTemplate(): HTMLElement {
          return el('div')
        }
      }
      const host = connectedHost()
      const d = new Debounced()
      d.mount(host)
      d.unmount()
      d.mount(host)
      d.handler()
      vi.advanceTimersByTime(200)
      expect(d.calls).toBe(1) // the debounce still works after a remount
      d.handler()
      d.unmount() // must cancel the pending timer — on the SECOND unmount
      vi.advanceTimersByTime(200)
      expect(d.calls).toBe(1)
      d.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── dispose / guard ────────────────────────────────────────────────────────

describe('dispose() and the override guard', () => {
  it('L-14 dispose: instance scope closed, phase disposed, a later mount() throws without a transition', () => {
    vi.useFakeTimers()
    try {
      const state = DiamondCore.reactive({ n: 0 })
      let runs = 0
      class Disposable extends Component {
        calls = 0
        handler = this.debounce(() => this.calls++, 100)
        override constructed(): void {
          DiamondCore.effect(() => {
            void state.n
            runs++
          })
        }
        createTemplate(): HTMLElement {
          return el('div')
        }
      }
      const effectsBefore = liveEffects()
      const d = new Disposable()
      d.mount(connectedHost())
      d.handler()
      d.dispose()
      expect(d.phase).toBe('disposed')
      expect(liveEffects() - effectsBefore).toBe(0) // the constructed() effect left with the instance scope
      vi.advanceTimersByTime(200)
      expect(d.calls).toBe(0) // the timer cancel in the instance scope ran
      state.n = 1
      const records = d.history().length
      expect(() => d.mount(connectedHost())).toThrow(/disposed/)
      expect(d.history().length).toBe(records)
      expect(d.phase).toBe('disposed')
      expect(runs).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('L-15 guard: overriding mount() or unmount() throws at construction, naming mounted()/unmounting()', () => {
    class OverridesMount extends Component {
      override mount(host: HTMLElement): void {
        super.mount(host)
      }
      createTemplate(): HTMLElement {
        return el('div')
      }
    }
    class OverridesUnmount extends Component {
      override unmount(): void {
        super.unmount()
      }
      createTemplate(): HTMLElement {
        return el('div')
      }
    }
    expect(() => new OverridesMount()).toThrow(/mounted\(\)/)
    expect(() => new OverridesMount()).toThrow(/unmounting\(\)/)
    expect(() => new OverridesUnmount()).toThrow(/mounted\(\)/)
    expect(() => new OverridesUnmount()).toThrow(/final/)
  })
})
