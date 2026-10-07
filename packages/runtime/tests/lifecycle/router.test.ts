/**
 * @vitest-environment happy-dom
 *
 * Lifecycle Contract §6 — the router over the new entry points: a failed
 * commit disposes every instance of the attempt and remounts the previous
 * occupants (L-36); a constructor throw mid-plan disposes what was already
 * constructed (L-26, router half).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Router, type RouteMap } from '../../src/router'
import { Component } from '../../src/component'
import { DiamondCore } from '../../src/core'
import { listenerCount, liveEffects } from './harness'

/** Every instance each page class constructed, for phase assertions. */
const made = new Map<string, Component[]>()
function remember(c: Component): void {
  const list = made.get(c.constructor.name) ?? []
  list.push(c)
  made.set(c.constructor.name, list)
}
const instances = (name: string): Component[] => made.get(name) ?? []

/** A page with one bound click (so "interactive" can be asserted). */
function makePage(name: string) {
  return class Page extends Component {
    clicks = 0
    constructor(_params?: Record<string, unknown>) {
      super()
      remember(this)
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      div.className = name
      DiamondCore.on(div, 'click', () => this.clicks++)
      return div
    }
  }
}

/** A page whose template declares one child outlet. */
function makeShell(name: string, childOutlet: string) {
  return class Shell extends Component {
    constructor(_params?: Record<string, unknown>) {
      super()
      remember(this)
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      div.className = name
      const outlet = document.createElement('outlet')
      outlet.setAttribute('name', childOutlet)
      div.appendChild(outlet)
      return div
    }
  }
}

function rootShell(...outletNames: string[]): void {
  document.body.innerHTML = ''
  for (const name of outletNames) {
    const outlet = document.createElement('outlet')
    outlet.setAttribute('name', name)
    document.body.appendChild(outlet)
  }
}

const internals = (r: Router): { occupancy: Map<string, { routeId: string }>; outlets: Map<string, unknown> } =>
  r as unknown as { occupancy: Map<string, { routeId: string }>; outlets: Map<string, unknown> }

let router: Router | null = null
afterEach(() => {
  router?.stop()
  router = null
  made.clear()
})

describe('L-36 — a commit failing on the third of three incoming components', () => {
  class LeafBomb extends Component {
    constructor(_params?: Record<string, unknown>) {
      super()
      remember(this)
    }
    createTemplate(): HTMLElement {
      throw new Error('leaf boom')
    }
  }

  const routes = (): RouteMap => ({
    stable: { path: 'stable', component: makePage('stable'), outlet: 'main' },
    shell: {
      path: 'shell',
      component: makeShell('shell', 'mid'),
      outlet: 'main',
      children: {
        mid: {
          path: 'mid',
          component: makeShell('mid', 'leaf'),
          outlet: 'mid',
          children: {
            leaf: { path: 'leaf', component: LeafBomb, outlet: 'leaf' },
          },
        },
      },
    },
    'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
  })

  it('leaves occupancy, outlets and the DOM as they were; the two that mounted are disposed with an empty inventory', async () => {
    rootShell('main')
    history.replaceState(null, '', '/stable')
    router = new Router(routes())
    await router.start()
    expect(document.querySelector('.stable')).not.toBeNull()

    const before = {
      html: document.body.innerHTML,
      occupancy: [...internals(router).occupancy.entries()].map(([k, v]) => [k, v.routeId]),
      outlets: [...internals(router).outlets.keys()],
      listeners: listenerCount(),
      effects: liveEffects(),
    }

    await router.navigate('/shell/mid/leaf') // contained: the third mount throws
    expect(location.pathname).toBe('/stable')

    expect(document.body.innerHTML).toBe(before.html)
    expect([...internals(router).occupancy.entries()].map(([k, v]) => [k, v.routeId])).toEqual(before.occupancy)
    expect([...internals(router).outlets.keys()]).toEqual(before.outlets)
    expect(listenerCount() - before.listeners).toBe(0)
    expect(liveEffects() - before.effects).toBe(0)

    // The two that mounted and the one that threw: all disposed, nothing in any scope.
    for (const name of ['Shell', 'LeafBomb']) {
      for (const c of instances(name)) {
        expect(c.phase, name).toBe('disposed')
        expect(c.getElement(), name).toBeNull()
        expect(c.domPing().consistent, name).toBe(true)
      }
    }
    expect(instances('Shell')).toHaveLength(2) // shell + mid
    expect(instances('LeafBomb')).toHaveLength(1)

    // The previous route is interactive and is the SAME instance, remounted.
    const stable = instances('Page')
    expect(stable).toHaveLength(1)
    expect(stable[0].phase).toBe('mounted')
    expect(stable[0].generation).toBe(3) // mount, unmount, remount
    document.querySelector<HTMLElement>('.stable')!.click()
    expect((stable[0] as Component & { clicks: number }).clicks).toBe(1)
  })
})

describe('L-26 (router half) — a constructor throw on the second of two incoming', () => {
  class CtorBomb extends Component {
    constructor(_params?: Record<string, unknown>) {
      super()
      throw new Error('constructor boom')
    }
  }

  const routes = (): RouteMap => ({
    stable: { path: 'stable', component: makePage('stable'), outlet: 'main' },
    shell: {
      path: 'shell',
      component: makeShell('shell', 'sub'),
      outlet: 'main',
      children: {
        broken: { path: 'broken', component: CtorBomb as never, outlet: 'sub' },
      },
    },
    'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
  })

  it('leaves the first one disposed and the previous route fully intact', async () => {
    rootShell('main')
    history.replaceState(null, '', '/stable')
    router = new Router(routes())
    await router.start()
    const html = document.body.innerHTML
    const listeners = listenerCount()
    const effects = liveEffects()

    await router.navigate('/shell/broken')
    expect(location.pathname).toBe('/stable')
    expect(document.body.innerHTML).toBe(html)
    expect(listenerCount() - listeners).toBe(0)
    expect(liveEffects() - effects).toBe(0)

    const shells = instances('Shell')
    expect(shells).toHaveLength(1)
    expect(shells[0].phase).toBe('disposed')
    expect(shells[0].getElement()).toBeNull()
    // The previous occupant was never touched: still generation 1, same instance.
    expect(instances('Page')[0].phase).toBe('mounted')
    expect(instances('Page')[0].generation).toBe(1)
  })

  it('a departed occupant is disposed once the commit stands', async () => {
    rootShell('main')
    history.replaceState(null, '', '/stable')
    router = new Router(routes())
    await router.start()
    const stable = instances('Page')[0]
    await router.navigate('/nowhere') // not-found takes the outlet
    expect(stable.phase).toBe('disposed')
    expect(document.querySelector('.nf')).not.toBeNull()
  })
})
