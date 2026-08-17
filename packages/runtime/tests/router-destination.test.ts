/**
 * @vitest-environment happy-dom
 *
 * v2.2.1 — the Destination tagged union (work order §4). One executor for
 * route redirects AND guard denials; arms are declared, never inferred.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Router, type RouteMap, type Destination } from '../src/router'
import { Guard } from '../src/guard'
import { Component } from '../src/component'
import { configure, addSink, type LogRecord } from '@diamondjs/primafacie'

configure({ console: false })

class SlugConverter {
  static parse(raw: string): { valid: boolean; value: unknown | null } {
    return /^[a-z][a-z0-9-]*$/.test(raw)
      ? { valid: true, value: raw }
      : { valid: false, value: null }
  }
}

function page(name: string) {
  return class Page extends Component {
    params: Record<string, unknown> | undefined
    constructor(params?: Record<string, unknown>) {
      super()
      this.params = params
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      div.className = name
      div.textContent = `${name}:${JSON.stringify(this.params ?? {})}`
      return div
    }
  }
}

let router: Router | null = null
let assignSpy: ReturnType<typeof vi.fn>
let originalAssign: typeof location.assign

beforeEach(() => {
  document.body.innerHTML = ''
  const outlet = document.createElement('outlet')
  outlet.setAttribute('name', 'main')
  document.body.appendChild(outlet)
  history.replaceState(null, '', '/')
  assignSpy = vi.fn()
  originalAssign = location.assign.bind(location)
  Object.defineProperty(location, 'assign', { value: assignSpy, configurable: true })
})
afterEach(() => {
  Object.defineProperty(location, 'assign', { value: originalAssign, configurable: true })
  router?.stop()
  router = null
})

const classes = (): string[] =>
  Array.from(document.body.querySelectorAll('div')).map((d) => d.className)

describe('redirect execution per arm (§2)', () => {
  const routes = (): RouteMap => ({
    'corpus-list': { path: '/corpora', component: page('corpus-list'), outlet: 'main' },
    workspace: {
      path: '/corpora/:corpusId',
      component: page('workspace'),
      outlet: 'main',
      params: { corpusId: SlugConverter },
    },
    'root-redirect': { path: '/', redirect: { type: 'route-id', target: 'corpus-list' } },
    'legacy-corpus': {
      path: '/c/:corpusId',
      redirect: { type: 'route-path', target: '/corpora/:corpusId' }, // params carry through
      params: { corpusId: SlugConverter },
    },
    support: { path: '/support', redirect: { type: 'site-path', target: '/support/wiki' } },
    archive: {
      path: '/archive',
      redirect: { type: 'external-url', target: 'https://archive.example.org/details/diamondjs' },
    },
    'not-found': { path: '*', component: page('nf'), outlet: 'main' },
  })

  it('route-id: resolves the ID and navigates internally', async () => {
    router = new Router(routes())
    await router.start() // initial '/' hits root-redirect
    expect(classes()).toContain('corpus-list')
    expect(location.pathname).toBe('/corpora')
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('route-path: substitutes :params from the matched route (/c/abc → /corpora/abc)', async () => {
    router = new Router(routes())
    await router.start()
    await router.navigate('/c/abc-corpus')
    expect(document.querySelector('.workspace')?.textContent).toBe(
      'workspace:{"corpusId":"abc-corpus"}'
    )
    expect(location.pathname).toBe('/corpora/abc-corpus')
  })

  it('site-path: narrated hard load, never pushState', async () => {
    router = new Router(routes())
    await router.start()
    const pushSpy = vi.spyOn(history, 'pushState')
    pushSpy.mockClear()
    await router.navigate('/support')
    expect(assignSpy).toHaveBeenCalledWith('/support/wiki')
    const pushed = pushSpy.mock.calls.map((c) => String(c[2]))
    expect(pushed).not.toContain('/support')
    expect(pushed).not.toContain('/support/wiki') // leaving the SPA writes no SPA history
    pushSpy.mockRestore()
  })

  it('external-url: identical hard-departure path, off origin', async () => {
    router = new Router(routes())
    await router.start()
    const pushSpy = vi.spyOn(history, 'pushState')
    pushSpy.mockClear()
    await router.navigate('/archive')
    expect(assignSpy).toHaveBeenCalledWith('https://archive.example.org/details/diamondjs')
    expect(pushSpy.mock.calls.map((c) => String(c[2]))).not.toContain('/archive')
    pushSpy.mockRestore()
  })

  it('route-id param carry-through: target path needs the matched param by name', async () => {
    const withIdCarry: RouteMap = {
      workspace: {
        path: '/corpora/:corpusId',
        component: page('workspace'),
        outlet: 'main',
        params: { corpusId: SlugConverter },
      },
      'legacy-id-form': {
        path: '/w/:corpusId',
        redirect: { type: 'route-id', target: 'workspace' },
        params: { corpusId: SlugConverter },
      },
      'not-found': { path: '*', component: page('nf'), outlet: 'main' },
    }
    router = new Router(withIdCarry)
    await router.start()
    await router.navigate('/w/deep-archive')
    expect(location.pathname).toBe('/corpora/deep-archive')
    expect(classes()).toContain('workspace')
  })
})

describe('guard denial to each arm (§4.3)', () => {
  const denialRoutes = (deny: Destination): RouteMap => {
    class DenyTo extends Guard {
      static override check(): boolean {
        return false
      }
      static override deny(): Destination {
        return deny
      }
    }
    return {
      home: { path: '', component: page('home'), outlet: 'main' },
      login: { path: 'login', component: page('login'), outlet: 'main' },
      locked: { path: 'locked', component: page('locked'), outlet: 'main', guard: DenyTo },
      'not-found': { path: '*', component: page('nf'), outlet: 'main' },
    }
  }

  it('route-id denial with query: returnTo rides the history write', async () => {
    router = new Router(
      denialRoutes({ type: 'route-id', target: 'login', query: { returnTo: '/locked' } })
    )
    await router.start()
    await router.navigate('/locked')
    expect(classes()).toContain('login')
    expect(location.pathname).toBe('/login')
    expect(location.search).toBe('?returnTo=%2Flocked')
  })

  it('site-path denial: hard load off the SPA', async () => {
    router = new Router(denialRoutes({ type: 'site-path', target: '/auth/legacy-login' }))
    await router.start()
    await router.navigate('/locked')
    expect(assignSpy).toHaveBeenCalledWith('/auth/legacy-login')
    expect(classes()).not.toContain('locked')
  })

  it('external-url denial: the OAuth IdP handoff, through the envelope', async () => {
    router = new Router(
      denialRoutes({ type: 'external-url', target: 'https://idp.example.com/authorize' })
    )
    await router.start()
    await router.navigate('/locked')
    expect(assignSpy).toHaveBeenCalledWith('https://idp.example.com/authorize')
  })
})

describe('mixed-arm cycle backstop (§4.5)', () => {
  it('a route-id/route-path cycle hits the hop cap and gives up loudly', async () => {
    const records: LogRecord[] = []
    const detach = addSink((r) => records.push(r))
    const cyclic: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-path', target: '/b' } },
      b: { path: 'b', redirect: { type: 'route-id', target: 'a' } },
      home: { path: '', component: page('home'), outlet: 'main' },
      'not-found': { path: '*', component: page('nf'), outlet: 'main' },
    }
    router = new Router(cyclic)
    await router.start()
    await router.navigate('/a') // terminates via the 10-hop cap, no hang
    expect(
      records.some(
        (r) => r.logType === 'CRITICAL' && r.message.includes('destination chain exceeded')
      )
    ).toBe(true)
    detach()
  })
})
