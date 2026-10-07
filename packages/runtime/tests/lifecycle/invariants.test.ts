/**
 * @vitest-environment happy-dom
 *
 * Lifecycle Contract §10.4 — invariants: rollback by inventory under random
 * acquisition sequences (L-30), stale callbacks (L-31), ring ⇔ snapshot
 * (L-32), terminal phases (L-33), conformance across remounts (L-34) and
 * Print emission (L-38).
 */
import { describe, it, expect, vi } from 'vitest'
import { Component, fold, type LifecycleRecord } from '../../src/component'
import { DiamondCore } from '../../src/core'
import { connectedHost, listenerCount, liveEffects, records } from './harness'

const noop = (): void => {}
const el = (tag: string, text = ''): HTMLElement => {
  const e = document.createElement(tag)
  e.textContent = text
  return e
}

/** A leaf child: one listener, one binding. */
class Leaf extends Component {
  createTemplate(): HTMLElement {
    const b = el('b')
    DiamondCore.on(b, 'click', noop)
    DiamondCore.bind(b, 'textContent', () => 'leaf')
    return b
  }
}

// ── L-30 ────────────────────────────────────────────────────────────────────

type Kind = 'bind' | 'on' | 'effect' | 'if' | 'repeat' | 'child'
const KINDS: Kind[] = ['bind', 'on', 'effect', 'if', 'repeat', 'child']

/** Tiny LCG — deterministic sequences, no dependency. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const BOOM = new Error('injected at acquisition N')

/** Acquires `plan` in order inside createTemplate(); throws before acquisition `throwAt`. */
class Probe extends Component {
  state = DiamondCore.reactive({ on: true, items: [1, 2, 3] })
  constructor(
    private readonly plan: Kind[],
    private readonly throwAt: number
  ) {
    super()
  }
  createTemplate(): HTMLElement {
    const root = el('div')
    this.plan.forEach((kind, i) => {
      if (i === this.throwAt) throw BOOM
      this.acquire(kind, root)
    })
    if (this.throwAt === this.plan.length) throw BOOM
    return root
  }
  private acquire(kind: Kind, root: HTMLElement): void {
    switch (kind) {
      case 'bind': {
        const p = root.appendChild(el('p'))
        DiamondCore.bind(p, 'textContent', () => String(this.state.on))
        break
      }
      case 'on':
        DiamondCore.on(root.appendChild(el('button')), 'click', noop)
        break
      case 'effect':
        DiamondCore.effect(() => void this.state.on)
        break
      case 'if': {
        const anchor = root.appendChild(document.createComment('if'))
        DiamondCore.if(anchor, [
          {
            when: () => this.state.on,
            make: () => {
              const s = el('span', 'on')
              DiamondCore.on(s, 'click', noop)
              return s
            },
          },
        ])
        break
      }
      case 'repeat': {
        const anchor = root.appendChild(document.createComment('repeat'))
        DiamondCore.repeat(anchor, () => this.state.items, (n) => {
          const li = el('li')
          DiamondCore.bind(li, 'textContent', () => String(n))
          return li
        })
        break
      }
      case 'child':
        DiamondCore.child(new Leaf(), root.appendChild(el('div')))
        break
    }
  }
}

describe('L-30 — rollback by inventory under random acquisition sequences', () => {
  it('1,000 random (sequence, throw index) pairs all leave L-20’s post-condition', () => {
    const rnd = lcg(0x5eed)
    const host = connectedHost()
    for (let iteration = 0; iteration < 1000; iteration++) {
      const length = 1 + Math.floor(rnd() * 6)
      const plan = Array.from({ length }, () => KINDS[Math.floor(rnd() * KINDS.length)])
      const throwAt = Math.floor(rnd() * (length + 1)) // 0..length: before any, between, or after all
      const listeners = listenerCount()
      const effects = liveEffects()
      const c = new Probe(plan, throwAt)

      let caught: unknown = null
      try {
        c.mount(host)
      } catch (e) {
        caught = e
      }

      const label = `#${iteration} [${plan.join(',')}] throw@${throwAt}`
      expect(caught, label).toBe(BOOM)
      expect(listenerCount() - listeners, label).toBe(0)
      expect(liveEffects() - effects, label).toBe(0)
      expect(host.childNodes.length, label).toBe(0)
      expect(c.phase, label).toBe('constructed')
      expect(c.getElement(), label).toBeNull()
      const last = c.history()[c.history().length - 1]
      expect(last, label).toMatchObject({ from: 'mounting', to: 'constructed', cause: 'mount', outcome: 'failed', error: BOOM })
    }
  })
})

// ── L-31 ────────────────────────────────────────────────────────────────────

class Timed extends Component {
  createTemplate(): HTMLElement {
    return el('div')
  }
  later(fn: () => void): () => void {
    return this.whileMounted(fn)
  }
}

describe('L-31 — a callback bound to generation g runs in g+1 as a no-op and records stale', () => {
  it('declines after unmount() and appends a stale record', () => {
    const c = new Timed()
    c.mount(connectedHost())
    const g = c.generation
    const spy = vi.fn()
    const cb = c.later(spy)

    cb()
    expect(spy).toHaveBeenCalledTimes(1)

    c.unmount()
    expect(c.generation).toBe(g + 1)
    const before = c.history().length
    cb()
    expect(spy).toHaveBeenCalledTimes(1) // declined
    expect(c.history()).toHaveLength(before + 1)
    const last = c.history()[c.history().length - 1]
    expect(last).toMatchObject({ cause: 'stale', outcome: 'stale', from: 'unmounted', to: 'unmounted', generation: g + 1 })
    expect(records().filter((r) => r.logType === 'WARNING' && /stale/.test(r.message))).toHaveLength(1)
  })

  it('still runs in the generation it captured, remount or not', () => {
    const c = new Timed()
    c.mount(connectedHost())
    c.unmount()
    c.mount(connectedHost())
    const spy = vi.fn()
    const cb = c.later(spy)
    cb()
    expect(spy).toHaveBeenCalledTimes(1)
    c.unmount()
  })
})

// ── L-32 ────────────────────────────────────────────────────────────────────

class Plain extends Component {
  createTemplate(): HTMLElement {
    return el('div')
  }
}
class Bomb extends Component {
  createTemplate(): HTMLElement {
    throw new Error('mount boom')
  }
}
class BadCleanup extends Component {
  createTemplate(): HTMLElement {
    this.registerCleanup(() => {
      throw new Error('cleanup boom')
    })
    return el('div')
  }
}

const snapshot = (c: Component): { phase: string; generation: number } => ({ phase: c.phase, generation: c.generation })

describe('L-32 — fold(history()) equals the snapshot after any transition sequence', () => {
  it('a fresh instance (no records)', () => {
    const c = new Plain()
    expect(fold(c.history())).toEqual({ phase: 'constructing', generation: 0 })
    expect(fold(c.history())).toEqual(snapshot(c))
  })

  it('construct → mount → unmount → mount → unmount → dispose, checked at every step', () => {
    const c = new Plain()
    const host = connectedHost()
    const steps: Array<() => void> = [
      () => c.ensureConstructed(),
      () => c.mount(host),
      () => c.unmount(),
      () => c.mount(host),
      () => c.unmount(),
      () => c.dispose(),
    ]
    for (const step of steps) {
      step()
      expect(fold(c.history())).toEqual(snapshot(c))
    }
    expect(snapshot(c)).toEqual({ phase: 'disposed', generation: 4 })
  })

  it('a failed mount and a faulted unmount', () => {
    const b = new Bomb()
    expect(() => b.mount(connectedHost())).toThrow('mount boom')
    expect(fold(b.history())).toEqual(snapshot(b))
    expect(snapshot(b)).toEqual({ phase: 'constructed', generation: 1 })

    const f = new BadCleanup()
    f.mount(connectedHost())
    f.unmount()
    expect(fold(f.history())).toEqual(snapshot(f))
    expect(f.phase).toBe('faulted')
  })
})

// ── L-33 ────────────────────────────────────────────────────────────────────

describe('L-33 — faulted and disposed are terminal', () => {
  const attempts = (c: Component, host: HTMLElement): void => {
    expect(() => c.mount(host)).toThrow(new RegExp(c.phase))
    expect(() => c.unmount()).toThrow(/not mounted/)
    c.dispose()
    c.ensureConstructed()
  }

  it('nothing leaves faulted, and the ring gains no record pointing elsewhere', () => {
    const c = new BadCleanup()
    const host = connectedHost()
    c.mount(host)
    c.unmount()
    expect(c.phase).toBe('faulted')
    const ring = [...c.history()]
    attempts(c, host)
    expect(c.phase).toBe('faulted')
    expect(c.history().slice(ring.length).filter((r) => r.to !== 'faulted')).toEqual([])
    expect(host.childNodes).toHaveLength(0)
  })

  it('nothing leaves disposed, and the ring gains no record pointing elsewhere', () => {
    const c = new Plain()
    const host = connectedHost()
    c.mount(host)
    c.dispose()
    expect(c.phase).toBe('disposed')
    const ring = [...c.history()]
    attempts(c, host)
    expect(c.phase).toBe('disposed')
    expect(c.history().slice(ring.length).filter((r) => r.to !== 'disposed')).toEqual([])
    expect(host.childNodes).toHaveLength(0)
  })
})

// ── L-34 ────────────────────────────────────────────────────────────────────

/** bind / on / effect / if */
class Alpha extends Component {
  state = DiamondCore.reactive({ on: true, label: 'a' })
  createTemplate(): HTMLElement {
    const root = el('div')
    const p = root.appendChild(el('p'))
    DiamondCore.bind(p, 'textContent', () => this.state.label)
    DiamondCore.on(root, 'click', () => (this.state.on = !this.state.on))
    DiamondCore.effect(() => void this.state.on)
    const anchor = root.appendChild(document.createComment('if'))
    DiamondCore.if(anchor, [{ when: () => this.state.on, make: () => el('i', 'on') }])
    return root
  }
}

/** repeat / switch / delegate */
class Beta extends Component {
  state = DiamondCore.reactive({ mode: 'list', items: [{ id: 1 }, { id: 2 }] })
  createTemplate(): HTMLElement {
    const root = el('div')
    const ul = root.appendChild(el('ul'))
    const ra = ul.appendChild(document.createComment('repeat'))
    DiamondCore.repeat(ra, () => this.state.items, (item) => el('li', String(item.id)))
    DiamondCore.delegate(ul, 'click', 'li', noop)
    const sa = root.appendChild(document.createComment('switch'))
    DiamondCore.switch(sa, () => this.state.mode, [{ match: (v) => v === 'list', make: () => el('em', 'list') }], () => el('em', '?'))
    return root
  }
}

/** debounce in a field initializer (P-4) and a D8 child */
class Gamma extends Component {
  calls = 0
  ping = this.debounce(() => this.calls++, 50)
  createTemplate(): HTMLElement {
    const root = el('div')
    DiamondCore.child(new Leaf(), root.appendChild(el('div')))
    return root
  }
}

interface Measure {
  listeners: number
  effects: number
  nodes: number
  instanceScope: number
}

const measure = (c: Component): Measure => ({
  listeners: listenerCount(),
  effects: liveEffects(),
  nodes: document.body.querySelectorAll('*').length,
  instanceScope: (c as unknown as { instanceScope: { list: unknown[] } }).instanceScope.list.length,
})

describe('L-34 — conformance: two mount/unmount cycles leave what one leaves', () => {
  // The examples/ and Turbine sweeps run elsewhere; these three cover every acquisition kind.
  for (const Ctor of [Alpha, Beta, Gamma]) {
    it(`${Ctor.name}: listener, effect, node and instance-scope counts are identical after one and two cycles`, () => {
      const host = connectedHost()
      const c = new Ctor()
      const baseline = measure(c)

      c.mount(host)
      expect(c.phase).toBe('mounted')
      c.unmount()
      const once = measure(c)

      c.mount(host)
      c.unmount()
      c.mount(host)
      c.unmount()
      const thrice = measure(c)

      expect(thrice).toEqual(once)
      expect(once.listeners - baseline.listeners).toBe(0)
      expect(once.effects - baseline.effects).toBe(0)
      expect(host.childNodes).toHaveLength(0)
    })
  }
})

// ── L-38 ────────────────────────────────────────────────────────────────────

const byType = (type: LifecycleRecord['outcome'] | string): number =>
  records().filter((r) => r.logType === type).length

describe('L-38 — Print emission (LC-14)', () => {
  it('a failed transition emits exactly one FAILURE', () => {
    const b = new Bomb()
    expect(() => b.mount(connectedHost())).toThrow('mount boom')
    expect(byType('FAILURE')).toBe(1)
    expect(byType('CRITICAL')).toBe(0)
  })

  it('a fault emits CRITICAL', () => {
    const f = new BadCleanup()
    f.mount(connectedHost())
    f.unmount()
    expect(byType('CRITICAL')).toBe(1)
  })

  it('an ok transition emits STATE in dev builds only', () => {
    const c = new Plain()
    c.mount(connectedHost())
    const dev = byType('STATE')
    expect(dev).toBeGreaterThanOrEqual(3) // constructed, mounting, mounted
    expect(records().some((r) => r.logType === 'STATE' && /mounting → mounted/.test(r.message))).toBe(true)

    delete (globalThis as { __DIAMOND_DEV__?: unknown }).__DIAMOND_DEV__
    c.unmount()
    expect(byType('STATE')).toBe(dev) // unmounting, unmounted: silent
    expect(byType('FAILURE')).toBe(0)
  })
})
