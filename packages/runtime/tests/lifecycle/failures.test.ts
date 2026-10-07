/**
 * @vitest-environment happy-dom
 *
 * Lifecycle Contract §10.3 — failure paths (L-20 … L-28). Every failed
 * transaction is recovered by inventory (LC-7): what was acquired is disposed,
 * nothing is journaled, and the instance lands on the destination §4 names.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Component } from '../../src/component'
import { DiamondCore } from '../../src/core'
import { Router, type RouteMap } from '../../src/router'
import { connectedHost, liveInstances, liveEffects, listenerCount } from './harness'

const boom = new Error('boom')


/** Expect `fn` to throw exactly `error` (identity, not message). */
function thrown(fn: () => void): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return undefined
}

/** A D8 leaf: one listener and one binding of its own. */
class Leaf extends Component {
  state = DiamondCore.reactive({ n: 0 })
  createTemplate(): HTMLElement {
    const el = document.createElement('span')
    DiamondCore.on(el, 'click', () => this.state.n++)
    DiamondCore.bind(el, 'textContent', () => String(this.state.n))
    return el
  }
}

// ── L-20 ───────────────────────────────────────────────────────────────────

/** createTemplate() makes k acquisitions and throws at the Nth (0 = before any). */
class ThrowsAt extends Component {
  state = DiamondCore.reactive({ label: 'x', items: [1, 2] })
  constructor(private readonly at: number) {
    super()
  }
  static readonly K = 6
  createTemplate(): HTMLElement {
    const root = document.createElement('div')
    const steps: Array<() => void> = [
      () => void DiamondCore.bind(root, 'textContent', () => this.state.label),
      () => void DiamondCore.on(root, 'click', () => {}),
      () => void DiamondCore.effect(() => void this.state.label),
      () => {
        const a = document.createComment('if')
        root.appendChild(a)
        DiamondCore.if(a, [
          {
            when: () => true,
            make: () => {
              const p = document.createElement('p')
              DiamondCore.on(p, 'click', () => {})
              return p
            },
          },
        ])
      },
      () => {
        const a = document.createComment('repeat')
        root.appendChild(a)
        DiamondCore.repeat(a, () => this.state.items, (item) => {
          const li = document.createElement('li')
          DiamondCore.bind(li, 'textContent', () => String(item))
          return li
        })
      },
      () => {
        const slot = document.createElement('section')
        root.appendChild(slot)
        DiamondCore.child(new Leaf(), slot)
      },
    ]
    for (let i = 0; i < steps.length; i++) {
      if (i === this.at) throw boom
      steps[i]()
    }
    if (this.at === steps.length) throw boom
    return root
  }
}

describe('L-20 createTemplate() throws at acquisition N', () => {
  it.each(Array.from({ length: ThrowsAt.K + 1 }, (_, n) => n))(
    'L-20 N=%i: inventory disposed, nothing connected, back to constructed, error unchanged',
    (n) => {
      const host = connectedHost()
      const c = new ThrowsAt(n)
      const listeners = listenerCount()
      const effects = liveEffects()

      expect(thrown(() => c.mount(host))).toBe(boom)

      expect(listenerCount() - listeners).toBe(0)
      expect(liveEffects() - effects).toBe(0)
      expect(host.childNodes.length).toBe(0)
      expect(c.getElement()).toBeNull()
      expect(c.phase).toBe('constructed')
      const last = c.history().at(-1)!
      expect(last).toMatchObject({ from: 'mounting', to: 'constructed', cause: 'mount', outcome: 'failed' })
      expect(last.error).toBe(boom)
    }
  )
})

// ── L-21 ───────────────────────────────────────────────────────────────────

describe('L-21 mounting() throws', () => {
  it('L-21: only the hook’s own acquisitions were in the inventory; all disposed; back to constructed', () => {
    const host = connectedHost()
    let listenersAtThrow = -1
    let effectsAtThrow = -1
    let listenersBeforeHook = -1
    let effectsBeforeHook = -1
    const probe = document.createElement('i')
    class M extends Component {
      override mounting(): void {
        listenersBeforeHook = listenerCount()
        effectsBeforeHook = liveEffects()
        expect(this.getElement()).toBeNull()
        DiamondCore.on(probe, 'click', () => {})
        DiamondCore.effect(() => {})
        listenersAtThrow = listenerCount()
        effectsAtThrow = liveEffects()
        throw boom
      }
      createTemplate(): HTMLElement {
        throw new Error('never built')
      }
    }
    const c = new M()
    const listeners = listenerCount()
    const effects = liveEffects()

    expect(thrown(() => c.mount(host))).toBe(boom)

    // The inventory at the throw held exactly the hook's two acquisitions…
    expect(listenersAtThrow - listenersBeforeHook).toBe(1)
    expect(effectsAtThrow - effectsBeforeHook).toBe(1)
    // …and all of it is gone.
    expect(listenerCount() - listeners).toBe(0)
    expect(liveEffects() - effects).toBe(0)
    expect(listenerCount(probe)).toBe(0)
    expect(host.childNodes.length).toBe(0)
    expect(c.getElement()).toBeNull()
    expect(c.phase).toBe('constructed')
    expect(c.history().at(-1)).toMatchObject({ from: 'mounting', to: 'constructed', cause: 'mount', outcome: 'failed' })
  })
})

// ── L-22 ───────────────────────────────────────────────────────────────────

describe('L-22 mounted() throws', () => {
  class MountedBomb extends Component {
    mounts = 0
    seen: HTMLElement | null = null
    constructor(private readonly failOn: number) {
      super()
    }
    override mounted(): void {
      this.mounts++
      this.seen = this.getElement()
      expect(this.seen?.isConnected).toBe(true)
      DiamondCore.on(this.seen!, 'click', () => {})
      DiamondCore.effect(() => {})
      if (this.mounts === this.failOn) throw boom
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      DiamondCore.on(div, 'keydown', () => {})
      return div
    }
  }

  it('L-22 first mount: range removed, hook acquisitions disposed, back to constructed, error rethrown', () => {
    const host = connectedHost()
    const c = new MountedBomb(1)
    const listeners = listenerCount()
    const effects = liveEffects()

    expect(thrown(() => c.mount(host))).toBe(boom)

    expect(c.seen!.isConnected).toBe(false)
    expect(host.childNodes.length).toBe(0)
    expect(listenerCount(c.seen!)).toBe(0)
    expect(listenerCount() - listeners).toBe(0)
    expect(liveEffects() - effects).toBe(0)
    expect(c.phase).toBe('constructed')
    expect(c.history().at(-1)).toMatchObject({ from: 'mounted', to: 'constructed', cause: 'connect', outcome: 'failed' })
  })

  it('L-22 remount: a failed remount returns to unmounted', () => {
    const host = connectedHost()
    const c = new MountedBomb(2)
    c.mount(host)
    expect(c.phase).toBe('mounted')
    c.unmount()
    const listeners = listenerCount()
    const effects = liveEffects()

    expect(thrown(() => c.mount(host))).toBe(boom)

    expect(host.childNodes.length).toBe(0)
    expect(listenerCount() - listeners).toBe(0)
    expect(liveEffects() - effects).toBe(0)
    expect(c.phase).toBe('unmounted')
    expect(c.history().at(-1)).toMatchObject({ from: 'mounted', to: 'unmounted', cause: 'connect', outcome: 'failed' })
  })
})

// ── L-23 ───────────────────────────────────────────────────────────────────

describe('L-23 a child’s mounted() throws under a parent', () => {
  let childEl: HTMLElement | null = null
  let child: BadChild | null = null

  class BadChild extends Component {
    override mounted(): void {
      throw boom
    }
    createTemplate(): HTMLElement {
      childEl = document.createElement('em')
      DiamondCore.on(childEl, 'click', () => {})
      return childEl
    }
  }

  class Parent extends Component {
    clicks = 0
    createTemplate(): HTMLElement {
      const root = document.createElement('div')
      const btn = document.createElement('button')
      DiamondCore.on(btn, 'click', () => this.clicks++)
      root.appendChild(btn)
      const a = document.createComment('if')
      root.appendChild(a)
      DiamondCore.if(a, [
        {
          when: () => true,
          make: () => {
            const section = document.createElement('section')
            child = new BadChild()
            DiamondCore.child(child, section)
            return section
          },
        },
      ])
      return root
    }
  }

  it('L-23: parent stays mounted and interactive; the owning branch is gone; no child listeners; child ring says failed', () => {
    const host = connectedHost()
    const p = new Parent()
    const listeners = listenerCount()

    expect(() => p.mount(host)).not.toThrow()

    expect(p.phase).toBe('mounted')
    const root = p.getElement()!
    expect(root.isConnected).toBe(true)
    root.querySelector('button')!.click()
    expect(p.clicks).toBe(1)

    expect(root.querySelector('section')).toBeNull() // the branch left with its inventory
    expect(childEl!.isConnected).toBe(false)
    expect(listenerCount(childEl!)).toBe(0)
    expect(listenerCount() - listeners).toBe(1) // only the parent's button listener remains

    const failed = child!.history().find((r) => r.outcome === 'failed')
    expect(failed).toMatchObject({ from: 'mounted', to: 'constructed', cause: 'connect' })
    expect(failed!.error).toBe(boom)
    expect(child!.phase).toBe('disposed') // disposed with the branch
  })
})

// ── L-24 ───────────────────────────────────────────────────────────────────

/** Three cleanups in the mount inventory; the middle one throws. */
class CleanupBomb extends Component {
  readonly order: string[] = []
  createTemplate(): HTMLElement {
    this.registerCleanup(() => void this.order.push('a')) // index 0
    this.registerCleanup(() => {
      throw boom // index 1
    })
    this.registerCleanup(() => void this.order.push('c')) // index 2
    return document.createElement('div') // range.remove is index 3
  }
}

describe('L-24 a cleanup throws during dispose', () => {
  it('L-24: remaining cleanups still run (LIFO), instance faults, mount() names the index, failures recorded', () => {
    const host = connectedHost()
    const c = new CleanupBomb()
    c.mount(host)

    expect(() => c.unmount()).not.toThrow()

    expect(c.order).toEqual(['c', 'a']) // LIFO: c ran before the throw, a after it
    expect(host.childNodes.length).toBe(0) // the range (last entry) left first
    expect(c.phase).toBe('faulted')
    const last = c.history().at(-1)!
    expect(last).toMatchObject({ from: 'unmounting', to: 'faulted', cause: 'unmount', outcome: 'faulted' })
    expect(last.failures).toEqual([{ index: 1, error: boom }])
    expect(() => c.mount(host)).toThrow(/cleanup #1/)
  })
})

// ── L-25 ───────────────────────────────────────────────────────────────────

class Plain extends Component {
  createTemplate(): HTMLElement {
    return document.createElement('div')
  }
}

describe('L-25 mount() on a terminal or occupied phase', () => {
  function refused(c: Component, host: HTMLElement, pattern: RegExp): void {
    const before = [...c.history()]
    expect(() => c.mount(host)).toThrow(pattern)
    expect(c.history()).toEqual(before) // no transition, ring unchanged
  }

  it('L-25 mounted: throws before any transition', () => {
    const host = connectedHost()
    const c = new Plain()
    c.mount(host)
    refused(c, host, /already mounted/)
    expect(c.phase).toBe('mounted')
    expect(host.childNodes.length).toBe(1)
  })

  it('L-25 faulted: throws before any transition', () => {
    const host = connectedHost()
    const c = new CleanupBomb()
    c.mount(host)
    c.unmount()
    expect(c.phase).toBe('faulted')
    refused(c, host, /faulted/)
    expect(c.phase).toBe('faulted')
  })

  it('L-25 disposed: throws before any transition', () => {
    const host = connectedHost()
    const c = new Plain()
    c.mount(host)
    c.dispose()
    expect(c.phase).toBe('disposed')
    refused(c, host, /disposed/)
    expect(c.phase).toBe('disposed')
  })
})

// ── L-26 ───────────────────────────────────────────────────────────────────

class Exploding extends Component {
  constructor(_params?: Record<string, unknown>) {
    super()
    throw boom
  }
}

describe('L-26 a subclass constructor throws', () => {
  let router: Router | null = null
  afterEach(() => {
    router?.stop()
    router = null
  })

  class Stable extends Component {
    clicks = 0
    constructor(_params?: Record<string, unknown>) {
      super()
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      div.className = 'stable'
      DiamondCore.on(div, 'click', () => this.clicks++)
      DiamondCore.bind(div, 'textContent', () => `clicks:${this.clicks}`)
      return div
    }
  }

  let shell: Shell | null = null
  /** Constructed fine (and acquires in constructed()); its child route explodes. */
  class Shell extends Component {
    constructor(_params?: Record<string, unknown>) {
      super()
      shell = this
    }
    override constructed(): void {
      DiamondCore.effect(() => {})
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      div.className = 'shell'
      const outlet = document.createElement('outlet')
      outlet.setAttribute('name', 'sub')
      div.appendChild(outlet)
      return div
    }
  }

  it('L-26 via router: no instance registered, nothing leaked, previous route fully intact', async () => {
    const outlet = document.createElement('outlet')
    outlet.setAttribute('name', 'main')
    document.body.appendChild(outlet)
    const routes: RouteMap = {
      stable: { path: 'stable', component: Stable, outlet: 'main' },
      broken: { path: 'broken', component: Exploding as never, outlet: 'main' },
      parent: {
        path: 'p',
        component: Shell,
        outlet: 'main',
        children: { kid: { path: 'kid', component: Exploding as never, outlet: 'sub' } },
      },
      'not-found': { path: '*', component: Stable, outlet: 'main' },
    }
    history.replaceState(null, '', '/stable')
    router = new Router(routes)
    await router.start()
    const stable = liveInstances().find((c) => c instanceof Stable)!
    expect(stable.phase).toBe('mounted')
    const html = outlet.innerHTML
    const listeners = listenerCount()
    const effects = liveEffects()

    // A constructor throw with nothing else incoming.
    await router.navigate('/broken')
    expect(outlet.innerHTML).toBe(html)
    expect(stable.phase).toBe('mounted')
    expect(location.pathname).toBe('/stable')
    expect(listenerCount() - listeners).toBe(0)
    expect(liveEffects() - effects).toBe(0)
    expect(liveInstances().some((c) => c instanceof Exploding)).toBe(false)

    // A constructor throw AFTER a sibling of the plan was constructed (P-5):
    // the sibling's constructed() acquisitions are disposed with it.
    await router.navigate('/p/kid')
    expect(outlet.innerHTML).toBe(html)
    expect(stable.phase).toBe('mounted')
    expect(location.pathname).toBe('/stable')
    expect(listenerCount() - listeners).toBe(0)
    expect(liveEffects() - effects).toBe(0)
    expect(shell!.phase).toBe('disposed')
    expect(liveInstances().some((c) => c instanceof Exploding)).toBe(false)

    // Still interactive.
    ;(outlet.querySelector('.stable') as HTMLElement).click()
    expect((stable as Stable).clicks).toBe(1)
  })

  it('L-26 via D8: the parent’s mount fails and rolls back fully', () => {
    const host = connectedHost()
    class Parent extends Component {
      createTemplate(): HTMLElement {
        const root = document.createElement('div')
        DiamondCore.on(root, 'click', () => {})
        DiamondCore.bind(root, 'title', () => 't')
        const slot = document.createElement('section')
        root.appendChild(slot)
        DiamondCore.child(new Exploding(), slot)
        return root
      }
    }
    const p = new Parent()
    const listeners = listenerCount()
    const effects = liveEffects()

    expect(thrown(() => p.mount(host))).toBe(boom)

    expect(host.childNodes.length).toBe(0)
    expect(listenerCount() - listeners).toBe(0)
    expect(liveEffects() - effects).toBe(0)
    expect(p.phase).toBe('constructed')
    expect(p.history().at(-1)).toMatchObject({ from: 'mounting', to: 'constructed', cause: 'mount', outcome: 'failed' })
    expect(liveInstances().some((c) => c instanceof Exploding)).toBe(false)
  })
})

// ── L-27 ───────────────────────────────────────────────────────────────────

describe('L-27 constructed() throws', () => {
  class ConstructedBomb extends Component {
    override constructed(): void {
      DiamondCore.effect(() => {})
      throw boom
    }
    createTemplate(): HTMLElement {
      return document.createElement('div')
    }
  }

  it('L-27 via mount(): instance scope disposed, faulted, mount() refused', () => {
    const host = connectedHost()
    const c = new ConstructedBomb()
    const effects = liveEffects()

    expect(thrown(() => c.mount(host))).toBe(boom)

    expect(liveEffects() - effects).toBe(0)
    expect(host.childNodes.length).toBe(0)
    expect(c.phase).toBe('faulted')
    expect(c.history().at(-1)).toMatchObject({ from: 'constructed', to: 'faulted', cause: 'construct', outcome: 'faulted' })
    const before = [...c.history()]
    expect(() => c.mount(host)).toThrow(/faulted/)
    expect(c.history()).toEqual(before)
  })

  it('L-27 via ensureConstructed(): same destination', () => {
    const c = new ConstructedBomb()
    const effects = liveEffects()
    expect(thrown(() => c.ensureConstructed())).toBe(boom)
    expect(liveEffects() - effects).toBe(0)
    expect(c.phase).toBe('faulted')
    expect(() => c.mount(connectedHost())).toThrow(/faulted/)
  })
})

// ── L-28 ───────────────────────────────────────────────────────────────────

describe('L-28 unmounted() throws', () => {
  class UnmountedBomb extends Component {
    unmounts = 0
    override unmounted(): void {
      this.unmounts++
      throw boom
    }
    createTemplate(): HTMLElement {
      return document.createElement('div')
    }
  }

  it('L-28: recorded as callback-failed, phase unmounted, remount permitted', () => {
    const host = connectedHost()
    const c = new UnmountedBomb()
    c.mount(host)

    expect(() => c.unmount()).not.toThrow()

    expect(c.unmounts).toBe(1)
    expect(c.phase).toBe('unmounted')
    expect(host.childNodes.length).toBe(0)
    const last = c.history().at(-1)!
    expect(last).toMatchObject({ from: 'unmounted', to: 'unmounted', cause: 'callback-failed', outcome: 'failed' })
    expect(last.error).toBe(boom)

    expect(() => c.mount(host)).not.toThrow()
    expect(c.phase).toBe('mounted')
    expect(host.childNodes.length).toBe(1)
    c.unmount()
    expect(c.unmounts).toBe(2)
  })
})
