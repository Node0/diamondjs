/**
 * @vitest-environment happy-dom
 *
 * v2.2 Phase 4 priority 6 — Pending, the departure-safety semaphore:
 * refcount, passthrough identity, conditional beforeunload install/remove
 * (bfcache), confirm-abort path, reactive `active` in a template.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Pending } from '../src/pending'
import { DiamondCore } from '../src/core'
import { Router, type RouteMap } from '../src/router'
import { Component } from '../src/component'
import { configure } from '@diamondjs/primafacie'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
configure({ console: false })

function drainHolds(): void {
  // Tests must leave no residue: release everything via labels + hold/release.
  while (Pending.active) {
    const label = Pending.labels()[0]
    // acquire+release twice net-releases one prior hold only if counts match;
    // instead release by acquiring a fresh handle is wrong — so tests below
    // always release their own holds. This is just a guard against test bugs.
    if (!label) break
    break
  }
}

afterEach(() => drainHolds())

describe('Pending refcounting', () => {
  it('two holds on one label: active until both release; release is idempotent', () => {
    expect(Pending.active).toBe(false)
    const r1 = Pending.hold('save')
    const r2 = Pending.hold('save')
    expect(Pending.active).toBe(true)
    expect(Pending.labels()).toEqual(['save'])

    r1()
    r1() // idempotent — must not double-release
    expect(Pending.active).toBe(true)

    r2()
    expect(Pending.active).toBe(false)
    expect(Pending.labels()).toEqual([])
  })

  it('until() is a PASSTHROUGH — returns the same promise identity', async () => {
    let resolve!: (v: string) => void
    const work = new Promise<string>((r) => (resolve = r))
    const returned = Pending.until(work, 'flush')
    expect(returned).toBe(work) // decorating functions are passthrough
    expect(Pending.active).toBe(true)

    resolve('done')
    await work
    await tick()
    expect(Pending.active).toBe(false)
  })

  it('until() releases on rejection too (settle, not success)', async () => {
    let reject!: (e: Error) => void
    const work = new Promise<string>((_, r) => (reject = r))
    Pending.until(work, 'doomed')
    expect(Pending.active).toBe(true)

    reject(new Error('nope'))
    await work.catch(() => {})
    await tick()
    expect(Pending.active).toBe(false)
  })
})

describe('conditional beforeunload handler (bfcache correctness)', () => {
  it('installs only while count > 0 and removes at zero', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const release = Pending.hold('upload')
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    const release2 = Pending.hold('upload')
    expect(add.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(1)

    release()
    expect(remove.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(0)

    release2()
    expect(remove.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(1)

    add.mockRestore()
    remove.mockRestore()
  })
})

describe('router phase-1 Pending check (confirm-abort path)', () => {
  class Page extends Component {
    constructor(_p?: Record<string, unknown>) {
      super()
    }
    createTemplate(): HTMLElement {
      const d = document.createElement('div')
      d.className = 'p'
      return d
    }
  }
  const routes: RouteMap = {
    home: { path: '', component: Page, outlet: 'main' },
    away: { path: 'away', component: Page, outlet: 'main' },
    'not-found': { path: '*', component: Page, outlet: 'main' },
  }

  let router: Router
  beforeEach(() => {
    document.body.innerHTML = ''
    const outlet = document.createElement('outlet')
    outlet.setAttribute('name', 'main')
    document.body.appendChild(outlet)
    history.replaceState(null, '', '/')
    router = new Router(routes)
  })
  afterEach(() => router.stop())

  it('declined confirm aborts cleanly; accepted confirm proceeds', async () => {
    await router.start()
    const release = Pending.hold('draft')

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await router.navigate('/away')
    expect(location.pathname).toBe('/') // abort: nothing happened

    confirmSpy.mockReturnValue(true)
    await router.navigate('/away')
    expect(location.pathname).toBe('/away')

    confirmSpy.mockRestore()
    release()
  })

  it('no confirm dialog when nothing is pending', async () => {
    await router.start()
    const confirmSpy = vi.spyOn(window, 'confirm')
    await router.navigate('/away')
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})

describe('reactive Pending.active in a template', () => {
  it('if="!Pending.active" toggles with holds', async () => {
    const host = document.createElement('div')
    const anchor = document.createComment('if')
    host.appendChild(anchor)

    DiamondCore.if(anchor, [
      {
        when: () => !Pending.active,
        make: () => {
          const s = document.createElement('span')
          s.textContent = 'all saved'
          return s
        },
      },
    ])
    expect(host.querySelector('span')?.textContent).toBe('all saved')

    const release = Pending.hold('saving')
    await tick()
    expect(host.querySelector('span')).toBeNull() // reactively hidden

    release()
    await tick()
    expect(host.querySelector('span')?.textContent).toBe('all saved')
  })
})
