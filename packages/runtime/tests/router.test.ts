/**
 * @vitest-environment happy-dom
 *
 * v2.2 Phase 4 — router test suite. Priority order = risk order:
 * 1 disposal, 2 transaction atomicity & races, 3 recognition table,
 * 4 links, 5 mount failure. (Pending has its own file.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Router, type RouteMap } from '../src/router'
import { Guard, type GuardContext } from '../src/guard'
import type { Destination } from '../src/router'
import { Component } from '../src/component'
import { DiamondCore } from '../src/core'
import { configure } from '@diamondjs/primafacie'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

configure({ console: false })

// ── fixtures ───────────────────────────────────────────────────────────────

/** Shared reactive state for effect-fire counting across route components. */
const shared = DiamondCore.reactive({ label: 'x' })
let effectFires = 0

function makePage(name: string, opts: { bindShared?: boolean } = {}) {
  return class Page extends Component {
    params: Record<string, unknown> | undefined
    constructor(params?: Record<string, unknown>) {
      super()
      this.params = params
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      div.className = name
      if (opts.bindShared) {
        DiamondCore.bind(div, 'textContent', () => {
          effectFires++
          return `${name}:${shared.label}`
        })
      } else {
        div.textContent = `${name}:${JSON.stringify(this.params ?? {})}`
      }
      return div
    }
  }
}

/** A page whose template declares a child outlet. */
function makeShellPage(name: string, childOutlet: string) {
  return class ShellPage extends Component {
    constructor(_params?: Record<string, unknown>) {
      super()
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

class IntConverter {
  static parse(raw: string): { valid: boolean; value: unknown | null } {
    const n = Number(raw)
    return Number.isInteger(n) && raw.trim() !== ''
      ? { valid: true, value: n }
      : { valid: false, value: null }
  }
}

class AllowGuard extends Guard {
  static override check(_ctx: GuardContext): boolean {
    return true
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

function activeClasses(): string[] {
  return Array.from(document.body.querySelectorAll('div')).map((d) => d.className)
}

let router: Router | null = null
afterEach(() => {
  router?.stop()
  router = null
  history.replaceState(null, '', '/')
})

// ── 1. disposal ────────────────────────────────────────────────────────────

describe('router disposal (priority 1)', () => {
  beforeEach(() => {
    effectFires = 0
    shared.label = 'x'
  })

  it('N navigations accumulate zero orphaned effects', async () => {
    rootShell('main')
    const routes: RouteMap = {
      a: { path: 'a', component: makePage('page-a', { bindShared: true }), outlet: 'main' },
      b: { path: 'b', component: makePage('page-b', { bindShared: true }), outlet: 'main' },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()

    for (let i = 0; i < 4; i++) {
      await router.navigate(i % 2 === 0 ? '/a' : '/b')
    }
    await tick()
    const baseline = effectFires

    shared.label = 'y' // only the ONE live component's effect may fire
    await tick()
    expect(effectFires).toBe(baseline + 1)
  })

  it('mutate-then-navigate in the same tick leaks nothing (D-7 shape at router level)', async () => {
    rootShell('main')
    const routes: RouteMap = {
      a: { path: 'a', component: makePage('page-a', { bindShared: true }), outlet: 'main' },
      b: { path: 'b', component: makePage('page-b'), outlet: 'main' },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/a')
    await tick()
    const baseline = effectFires

    shared.label = 'mutated' // queues page-a's effect...
    await router.navigate('/b') // ...and unmounts it in the same tick
    await tick()
    expect(effectFires).toBe(baseline) // dropped, not flushed into a dead effect

    shared.label = 'again'
    await tick()
    expect(effectFires).toBe(baseline) // and permanently unsubscribed
  })
})

// ── 2. transaction atomicity & races ───────────────────────────────────────

describe('transaction atomicity & races (priority 2)', () => {
  it('multi-outlet plan: child guard rejects ⇒ zero DOM mutation anywhere', async () => {
    rootShell('main')
    class DenyGuard extends Guard {
      static override check(): boolean {
        return false
      }
      static override deny(): Destination {
        return { type: 'route-id', target: 'start' }
      }
    }
    const routes: RouteMap = {
      start: { path: 'start', component: makePage('start'), outlet: 'main' },
      parent: {
        path: 'parent',
        component: makeShellPage('parent', 'child'),
        outlet: 'main',
        children: {
          kid: {
            path: 'kid',
            component: makePage('kid'),
            outlet: 'child',
            guard: DenyGuard,
          },
        },
      },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/start')
    expect(activeClasses()).toContain('start')

    await router.navigate('/parent/kid') // child guard denies the WHOLE plan
    expect(activeClasses()).toContain('start') // untouched
    expect(activeClasses()).not.toContain('parent') // parent never mounted
    expect(activeClasses()).not.toContain('kid')
  })

  it('async guard resolving after a newer nav is discarded silently', async () => {
    rootShell('main')
    let resolveSlow!: (v: boolean) => void
    class SlowGuard extends Guard {
      static override check(): Promise<boolean> {
        return new Promise((r) => (resolveSlow = r))
      }
    }
    const routes: RouteMap = {
      slow: { path: 'slow', component: makePage('slow'), outlet: 'main', guard: SlowGuard },
      fast: { path: 'fast', component: makePage('fast'), outlet: 'main' },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()

    const slowNav = router.navigate('/slow') // parks in the guard phase
    await router.navigate('/fast')
    expect(activeClasses()).toContain('fast')

    resolveSlow(true) // stale nav resolves AFTER the newer one
    await slowNav
    await tick()
    expect(activeClasses()).toContain('fast') // still fast — stale discarded
    expect(activeClasses()).not.toContain('slow')
    expect(location.pathname).toBe('/fast')
  })

  it('pushState never fires on a rejected navigation', async () => {
    rootShell('main')
    class DenyFlat extends Guard {
      static override check(): boolean {
        return false
      }
      static override deny(): Destination {
        return { type: 'route-id', target: 'open' }
      }
    }
    const routes: RouteMap = {
      open: { path: 'open', component: makePage('open'), outlet: 'main' },
      locked: { path: 'locked', component: makePage('locked'), outlet: 'main', guard: DenyFlat },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/open')

    const pushSpy = vi.spyOn(history, 'pushState')
    pushSpy.mockClear()
    await router.navigate('/locked')
    // The denied path itself must never be written; only the deny target may be.
    const pushedPaths = pushSpy.mock.calls.map((c) => String(c[2]))
    expect(pushedPaths).not.toContain('/locked')
    pushSpy.mockRestore()
  })

  it('guard throw and guard timeout both deny (envelope, fail closed)', async () => {
    rootShell('main')
    class ThrowGuard extends Guard {
      static override check(): boolean {
        throw new Error('boom')
      }
      static override deny(): Destination {
        return { type: 'route-id', target: 'safe' }
      }
    }
    class HangGuard extends Guard {
      static override timeoutMs = 20
      static override check(): Promise<boolean> {
        return new Promise(() => {}) // never settles
      }
      static override deny(): Destination {
        return { type: 'route-id', target: 'safe' }
      }
    }
    const routes: RouteMap = {
      safe: { path: 'safe', component: makePage('safe'), outlet: 'main' },
      throws: { path: 'throws', component: makePage('throws'), outlet: 'main', guard: ThrowGuard },
      hangs: { path: 'hangs', component: makePage('hangs'), outlet: 'main', guard: HangGuard },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()

    await router.navigate('/throws')
    expect(activeClasses()).toContain('safe')
    expect(activeClasses()).not.toContain('throws')

    await router.navigate('/hangs')
    expect(activeClasses()).toContain('safe')
    expect(activeClasses()).not.toContain('hangs')
  })

  it('external Deny executes location.assign (data the router executes)', async () => {
    rootShell('main')
    const assign = vi.fn()
    const original = location.assign.bind(location)
    Object.defineProperty(location, 'assign', { value: assign, configurable: true })
    class SsoGuard extends Guard {
      static override check(): boolean {
        return false
      }
      static override deny(): Destination {
        return { type: 'external-url', target: 'https://idp.example.com/login' }
      }
    }
    const routes: RouteMap = {
      home: { path: '', component: makePage('home'), outlet: 'main' },
      admin: { path: 'admin', component: makePage('admin'), outlet: 'main', guard: SsoGuard },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/admin')
    expect(assign).toHaveBeenCalledWith('https://idp.example.com/login')
    Object.defineProperty(location, 'assign', { value: original, configurable: true })
  })

  it('guards run on the initial-load vector too (deny resolves via replaceState)', async () => {
    rootShell('main')
    class DenyGuard extends Guard {
      static override check(): boolean {
        return false
      }
      static override deny(): Destination {
        return { type: 'route-id', target: 'public' }
      }
    }
    const routes: RouteMap = {
      public: { path: 'public', component: makePage('public'), outlet: 'main' },
      secret: { path: 'secret', component: makePage('secret'), outlet: 'main', guard: DenyGuard },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    history.replaceState(null, '', '/secret') // land directly on the guarded URL
    router = new Router(routes)
    await router.start()
    expect(activeClasses()).toContain('public')
    expect(activeClasses()).not.toContain('secret')
    expect(location.pathname).toBe('/public') // no lingering denied entry
  })
})

// ── 3. recognition table (reference cases; Joe's trees gated on sketches) ──

describe('recognition table (priority 3 — reference cases)', () => {
  function recognitionRoutes(): RouteMap {
    return {
      home: { path: '', component: makePage('home'), outlet: 'main' },
      'users-list': { path: 'users/list', component: makePage('users-list'), outlet: 'main' },
      'user-detail': {
        path: 'users/:id',
        component: makePage('user-detail'),
        outlet: 'main',
        params: { id: IntConverter },
      },
      legacy: { path: 'old-home', redirect: { type: 'route-id', target: 'home' } },
      'legacy-two': { path: 'older-home', redirect: { type: 'route-path', target: '/old-home' } },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
  }

  it('static beats param at the same depth (specificity, never order)', async () => {
    rootShell('main')
    router = new Router(recognitionRoutes())
    await router.start()
    await router.navigate('/users/list')
    expect(activeClasses()).toContain('users-list')
    expect(activeClasses()).not.toContain('user-detail')
  })

  it('param routes parse through converters; the value is a constructor constant', async () => {
    rootShell('main')
    router = new Router(recognitionRoutes())
    await router.start()
    await router.navigate('/users/42')
    const el = document.querySelector('.user-detail')
    expect(el?.textContent).toBe('user-detail:{"id":42}') // number 42, not "42"
  })

  it('a failed ParseResult is a failed match — falls through toward not-found', async () => {
    rootShell('main')
    router = new Router(recognitionRoutes())
    await router.start()
    await router.navigate('/users/abc') // IntConverter rejects 'abc'
    expect(activeClasses()).toContain('nf')
    expect(activeClasses()).not.toContain('user-detail')
  })

  it('redirect chains resolve to the terminal target', async () => {
    rootShell('main')
    router = new Router(recognitionRoutes())
    await router.start()
    await router.navigate('/older-home') // legacy-two → legacy → home
    expect(activeClasses()).toContain('home')
  })

  it('* matches last regardless of declaration position', async () => {
    rootShell('main')
    const routes: RouteMap = {
      'catch-all': { path: '*', component: makePage('catch-all'), outlet: 'main' },
      about: { path: 'about', component: makePage('about'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/about')
    expect(activeClasses()).toContain('about') // wildcard declared FIRST, still loses
    await router.navigate('/missing')
    expect(activeClasses()).toContain('catch-all')
  })

  it('depth-3 chains mount parent-first into ancestor-declared outlets', async () => {
    rootShell('main')
    const routes: RouteMap = {
      l1: {
        path: 'a',
        component: makeShellPage('level-1', 'l2-outlet'),
        outlet: 'main',
        children: {
          l2: {
            path: 'b',
            component: makeShellPage('level-2', 'l3-outlet'),
            outlet: 'l2-outlet',
            children: {
              l3: { path: 'c', component: makePage('level-3'), outlet: 'l3-outlet' },
            },
          },
        },
      },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/a/b/c')
    const l1 = document.querySelector('.level-1')
    const l2 = l1?.querySelector('.level-2')
    const l3 = l2?.querySelector('.level-3')
    expect(l3).toBeTruthy() // nested containment proves parent-first mounting
  })

  it('matching is trailing-slash-insensitive and static-segment case-sensitive', async () => {
    rootShell('main')
    const routes: RouteMap = {
      about: { path: 'about', component: makePage('about'), outlet: 'main' },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/about/')
    expect(activeClasses()).toContain('about')
    await router.navigate('/About')
    expect(activeClasses()).toContain('nf') // case-sensitive statics
  })

  it('unchanged parent survives a child-only navigation (no remount)', async () => {
    rootShell('main')
    const routes: RouteMap = {
      shell: {
        path: 's',
        component: makeShellPage('shell', 'sub'),
        outlet: 'main',
        children: {
          one: { path: 'one', component: makePage('one'), outlet: 'sub' },
          two: { path: 'two', component: makePage('two'), outlet: 'sub' },
        },
      },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/s/one')
    const shellEl = document.querySelector('.shell')
    await router.navigate('/s/two')
    expect(document.querySelector('.shell')).toBe(shellEl) // same node — kept
    expect(activeClasses()).toContain('two')
    expect(activeClasses()).not.toContain('one')
  })

  it('param change = unmount + remount, always (params are constructor constants)', async () => {
    rootShell('main')
    router = new Router(recognitionRoutes())
    await router.start()
    await router.navigate('/users/1')
    const first = document.querySelector('.user-detail')
    await router.navigate('/users/2')
    const second = document.querySelector('.user-detail')
    expect(second).not.toBe(first)
    expect(second?.textContent).toBe('user-detail:{"id":2}')
  })
})

// ── 4. links ───────────────────────────────────────────────────────────────

describe('link interception (priority 4)', () => {
  function linkSetup(): { anchor: HTMLAnchorElement } {
    rootShell('main')
    const anchor = document.createElement('a')
    anchor.setAttribute('href', '/about')
    anchor.textContent = 'About'
    document.body.appendChild(anchor)
    return { anchor }
  }
  const linkRoutes = (): RouteMap => ({
    home: { path: '', component: makePage('home'), outlet: 'main' },
    about: { path: 'about', component: makePage('about'), outlet: 'main' },
    'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
  })

  function click(el: Element, init: MouseEventInit = {}): MouseEvent {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    el.dispatchEvent(e)
    return e
  }

  it('same-origin primary click is intercepted (preventDefault + navigate)', async () => {
    const { anchor } = linkSetup()
    router = new Router(linkRoutes())
    await router.start()
    const e = click(anchor)
    expect(e.defaultPrevented).toBe(true)
    await tick()
    expect(activeClasses()).toContain('about')
  })

  it('modifier clicks pass through untouched', async () => {
    const { anchor } = linkSetup()
    router = new Router(linkRoutes())
    await router.start()
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      const e = click(anchor, init)
      expect(e.defaultPrevented).toBe(false)
    }
  })

  it('middle-click passes through untouched', async () => {
    const { anchor } = linkSetup()
    router = new Router(linkRoutes())
    await router.start()
    const e = click(anchor, { button: 1 })
    expect(e.defaultPrevented).toBe(false)
  })

  it('external hrefs pass through untouched', async () => {
    rootShell('main')
    const anchor = document.createElement('a')
    anchor.setAttribute('href', 'https://example.com/elsewhere')
    document.body.appendChild(anchor)
    router = new Router(linkRoutes())
    await router.start()
    const e = click(anchor)
    expect(e.defaultPrevented).toBe(false)
  })

  // #14 — anchors that are not navigation pass through and never route.
  // The window listener runs after the router's document listener: it records
  // whether the router claimed the click, then cancels happy-dom's own default
  // navigation so a passed-through click cannot move the test document.
  async function expectPassThrough(attrs: Record<string, string>): Promise<void> {
    const { anchor } = linkSetup()
    for (const [name, value] of Object.entries(attrs)) anchor.setAttribute(name, value)
    router = new Router(linkRoutes())
    await router.start()
    let claimed: boolean | null = null
    const afterRouter = (e: Event): void => {
      claimed = e.defaultPrevented
      e.preventDefault()
    }
    window.addEventListener('click', afterRouter, { once: true })
    click(anchor)
    expect(claimed).toBe(false)
    await tick()
    expect(activeClasses()).toEqual(['home'])
    expect(location.pathname).toBe('/')
  }

  it('download anchors pass through untouched', async () => {
    await expectPassThrough({ download: 'about.txt' })
  })

  it('blob: hrefs pass through untouched (same origin, never a route)', async () => {
    const href = `blob:${location.origin}/9f2c1e0a-6b7d-4c3e-8a51-0d2f4b6c8e10`
    expect(new URL(href).origin).toBe(location.origin) // the trap the origin test fell into
    await expectPassThrough({ href })
  })

  it.each(['mailto:someone@example.com', 'tel:+15550100', 'data:text/plain,hi'])(
    'non-http(s) href %s passes through untouched',
    async (href) => {
      await expectPassThrough({ href })
    }
  )

  it('target other than _self passes through untouched', async () => {
    await expectPassThrough({ target: '_blank' })
  })

  it('target="_self" is still intercepted', async () => {
    const { anchor } = linkSetup()
    anchor.setAttribute('target', '_self')
    router = new Router(linkRoutes())
    await router.start()
    expect(click(anchor).defaultPrevented).toBe(true)
    await tick()
    expect(activeClasses()).toContain('about')
  })

  it('rel="external" passes through untouched (token match, any position)', async () => {
    await expectPassThrough({ rel: 'noopener external' })
  })
})

// ── 4b. query and hash (#20) ───────────────────────────────────────────────

describe('query and hash', () => {
  let guardRuns = 0
  class CountingGuard extends Guard {
    static override check(_ctx: GuardContext): boolean {
      guardRuns++
      return true
    }
  }
  class Exploding extends Component {
    constructor(_params?: Record<string, unknown>) {
      super()
      throw new Error('constructor boom')
    }
  }
  const routes = (): RouteMap => ({
    home: { path: '', component: makePage('home'), outlet: 'main' },
    about: {
      path: 'about',
      component: makePage('about'),
      outlet: 'main',
      query: { tab: IntConverter },
      guard: CountingGuard,
    },
    broken: { path: 'broken', component: Exploding as never, outlet: 'main' },
    'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
  })

  const here = (): string => location.pathname + location.search + location.hash
  const aboutText = (): string | null | undefined => document.querySelector('.about')?.textContent
  /** happy-dom delivers history.back() / forward() asynchronously. */
  const traversed = () => new Promise<void>((r) => setTimeout(r, 10))

  async function startAt(url: string, options?: { basePath?: string }): Promise<void> {
    rootShell('main')
    history.replaceState(null, '', url)
    router = new Router(routes(), options)
    await router.start()
    guardRuns = 0
  }

  /**
   * Click a link; true when the router claimed it. An unclaimed fragment
   * link keeps its default action (happy-dom sets the hash, as a browser
   * does); any other unclaimed link is cancelled so it cannot move the test
   * document.
   */
  function clickLink(href: string): boolean {
    const a = document.createElement('a')
    a.setAttribute('href', href)
    document.body.appendChild(a)
    let claimed = false
    const afterRouter = (e: Event): void => {
      claimed = e.defaultPrevented
      if (!href.startsWith('#')) e.preventDefault()
    }
    window.addEventListener('click', afterRouter, { once: true })
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    return claimed
  }

  it('a hash-only link is left to the browser', async () => {
    await startAt('/about?tab=2')
    expect(clickLink('#section')).toBe(false)
    await tick()
    expect(here()).toBe('/about?tab=2#section') // the browser's own fragment navigation
    expect(guardRuns).toBe(0)
    expect(aboutText()).toBe('about:{"tab":2}')
  })

  it('a link to the same path and query with a new hash is left to the browser', async () => {
    await startAt('/about?tab=2#one')
    expect(clickLink('/about?tab=2#two')).toBe(false)
    await tick()
    expect(guardRuns).toBe(0)
  })

  it('a link carries its query and hash into the URL; matching uses the path only', async () => {
    await startAt('/')
    expect(clickLink('/about?tab=2#x')).toBe(true)
    await tick()
    expect(here()).toBe('/about?tab=2#x')
    expect(aboutText()).toBe('about:{"tab":2}') // the LINK's query, not the page being left
  })

  it('the same path with a different query is a navigation', async () => {
    await startAt('/about?tab=2')
    expect(clickLink('/about?tab=3#x')).toBe(true)
    await tick()
    expect(here()).toBe('/about?tab=3#x')
    expect(aboutText()).toBe('about:{"tab":3}')
  })

  it("a link's query that fails its converter fails the match", async () => {
    await startAt('/')
    expect(clickLink('/about?tab=abc')).toBe(true)
    await tick()
    expect(activeClasses()).toEqual(['nf'])
    expect(here()).toBe('/about?tab=abc')
  })

  it('initial load keeps the query and hash', async () => {
    await startAt('/about?tab=2#x')
    expect(here()).toBe('/about?tab=2#x')
    expect(aboutText()).toBe('about:{"tab":2}')
  })

  it('Back and Forward restore the query and hash', async () => {
    await startAt('/?from=1#top')
    clickLink('/about?tab=2#x')
    await tick()
    expect(here()).toBe('/about?tab=2#x')

    history.back()
    await traversed()
    expect(here()).toBe('/?from=1#top')
    expect(activeClasses()).toEqual(['home'])

    // happy-dom's replaceState on a back entry discards its forward history
    // (a browser keeps it), so Forward is the entry re-created + a popstate.
    history.pushState(null, '', '/about?tab=2#x')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await tick()
    expect(here()).toBe('/about?tab=2#x')
    expect(aboutText()).toBe('about:{"tab":2}')
  })

  it('a popstate that only changes the hash does not route or re-guard', async () => {
    await startAt('/about?tab=2')
    history.pushState(null, '', '/about?tab=2#x') // what a fragment navigation leaves behind
    window.dispatchEvent(new PopStateEvent('popstate'))
    await tick()
    expect(guardRuns).toBe(0)
    expect(here()).toBe('/about?tab=2#x')

    history.pushState(null, '', '/?q=1#y') // a different path still routes, tail kept
    window.dispatchEvent(new PopStateEvent('popstate'))
    await tick()
    expect(activeClasses()).toEqual(['home'])
    expect(here()).toBe('/?q=1#y')
  })

  it('a failed mount restores the previous query and hash', async () => {
    await startAt('/about?tab=2#x')
    await router!.navigate('/broken')
    expect(here()).toBe('/about?tab=2#x')
    expect(aboutText()).toBe('about:{"tab":2}')
  })

  it('navigate(path) is path-only: no query or hash is carried over', async () => {
    await startAt('/?from=1#top')
    await router!.navigate('/about')
    expect(here()).toBe('/about')
  })

  it('under a basePath the prefix, query and hash all survive', async () => {
    await startAt('/tools/reports/', { basePath: '/tools/reports' })
    expect(clickLink('/tools/reports/about?tab=2#x')).toBe(true)
    await tick()
    expect(here()).toBe('/tools/reports/about?tab=2#x')
    expect(aboutText()).toBe('about:{"tab":2}')
  })
})

// ── 5. mount failure ───────────────────────────────────────────────────────

describe('mount failure (priority 5)', () => {
  it('constructor throw during commit preserves the previous route', async () => {
    rootShell('main')
    class Exploding extends Component {
      constructor(_params?: Record<string, unknown>) {
        super()
        throw new Error('constructor boom')
      }
    }
    const routes: RouteMap = {
      stable: { path: 'stable', component: makePage('stable'), outlet: 'main' },
      broken: { path: 'broken', component: Exploding as never, outlet: 'main' },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/stable')

    await router.navigate('/broken') // contained: narrated, previous preserved
    expect(activeClasses()).toContain('stable')
    expect(location.pathname).toBe('/stable') // URL restored too
  })

  it('mount() throw rolls back to the previous route', async () => {
    rootShell('main')
    class MountBomb extends Component {
      constructor(_params?: Record<string, unknown>) {
        super()
      }
      override createTemplate(): HTMLElement {
        throw new Error('mount boom')
      }
    }
    const routes: RouteMap = {
      stable: { path: 'stable', component: makePage('stable'), outlet: 'main' },
      bomb: { path: 'bomb', component: MountBomb, outlet: 'main' },
      'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
    }
    router = new Router(routes)
    await router.start()
    await router.navigate('/stable')

    await router.navigate('/bomb')
    expect(activeClasses()).toContain('stable') // remounted by rollback
  })
})

// ── startup table ──────────────────────────────────────────────────────────

describe('dev startup route table', () => {
  it('prints one STATE row per route in dev, nothing in prod', async () => {
    const { addSink } = await import('@diamondjs/primafacie')
    const lines: string[] = []
    const detach = addSink((r) => {
      if (r.message.includes('|')) lines.push(r.message)
    })

    rootShell('main')
    ;(globalThis as { __DIAMOND_DEV__?: boolean }).__DIAMOND_DEV__ = true
    router = new Router({
      home: { path: '', component: makePage('home'), outlet: 'main' },
      about: { path: 'about', component: makePage('about'), outlet: 'main' },
    })
    await router.start()
    expect(lines.some((l) => l.includes('about | /about | main'))).toBe(true)
    router.stop()
    router = null

    lines.length = 0
    ;(globalThis as { __DIAMOND_DEV__?: boolean }).__DIAMOND_DEV__ = false
    rootShell('main')
    router = new Router({
      home: { path: '', component: makePage('home'), outlet: 'main' },
    })
    await router.start()
    expect(lines).toHaveLength(0)
    detach()
    delete (globalThis as { __DIAMOND_DEV__?: boolean }).__DIAMOND_DEV__
  })
})

// ── basePath (nested / reverse-proxied deployment) ─────────────────────────

describe('basePath (deploy N levels below the domain root)', () => {
  const baseRoutes = (): RouteMap => ({
    home: { path: '', component: makePage('home'), outlet: 'main' },
    about: { path: 'about', component: makePage('about'), outlet: 'main' },
    'not-found': { path: '*', component: makePage('nf'), outlet: 'main' },
  })

  it('history writes carry the public prefix; app code speaks app-relative paths', async () => {
    rootShell('main')
    history.replaceState(null, '', '/tools/reports/')
    router = new Router(baseRoutes(), { basePath: '/tools/reports' })
    await router.start()
    expect(activeClasses()).toContain('home')

    await router.navigate('/about') // app-relative
    expect(activeClasses()).toContain('about')
    expect(location.pathname).toBe('/tools/reports/about') // public URL prefixed
  })

  it('initial load N levels deep recognizes the app-relative remainder', async () => {
    rootShell('main')
    history.replaceState(null, '', '/tools/reports/about')
    router = new Router(baseRoutes(), { basePath: '/tools/reports' })
    await router.start()
    expect(activeClasses()).toContain('about')
  })

  it('links under the prefix are intercepted; sibling-app links pass through', async () => {
    rootShell('main')
    history.replaceState(null, '', '/tools/reports/')
    const inside = document.createElement('a')
    inside.setAttribute('href', '/tools/reports/about')
    const sibling = document.createElement('a')
    sibling.setAttribute('href', '/tools/other-app/page')
    document.body.append(inside, sibling)

    router = new Router(baseRoutes(), { basePath: '/tools/reports' })
    await router.start()

    const clickOn = (el: Element): MouseEvent => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      el.dispatchEvent(e)
      return e
    }
    expect(clickOn(inside).defaultPrevented).toBe(true)
    await tick()
    expect(activeClasses()).toContain('about')
    expect(clickOn(sibling).defaultPrevented).toBe(false) // not ours
  })

  it('a location outside basePath narrates the misconfiguration WARNING', async () => {
    const { addSink } = await import('@diamondjs/primafacie')
    const warns: string[] = []
    const detach = addSink((r) => {
      if (r.logType === 'WARNING') warns.push(r.message)
    })
    rootShell('main')
    history.replaceState(null, '', '/somewhere/else')
    router = new Router(baseRoutes(), { basePath: '/tools/reports' })
    await router.start()
    expect(warns.some((w) => w.includes("outside basePath '/tools/reports'"))).toBe(true)
    detach()
  })

  it('trailing-slash and bare-prefix forms of basePath are equivalent', async () => {
    rootShell('main')
    history.replaceState(null, '', '/deep/')
    router = new Router(baseRoutes(), { basePath: 'deep/' }) // sloppy form
    await router.start()
    expect(activeClasses()).toContain('home')
    await router.navigate('/about')
    expect(location.pathname).toBe('/deep/about')
  })
})
