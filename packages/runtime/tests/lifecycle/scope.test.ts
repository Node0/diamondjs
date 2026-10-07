/**
 * @vitest-environment happy-dom
 *
 * Lifecycle Contract, Phase 1 — the scope object (§5.1): LIFO dispose with
 * failure collection, captureScope disposing on throw (P-2), and the one
 * placement path that still runs on a microtask (L-37).
 */
import { describe, it, expect, vi } from 'vitest'
import { DiamondCore, Scope } from '../../src/core'
import { Component } from '../../src/component'
import { connectedHost, detachedHost, listenerCount, liveEffects, tick } from './harness'

const span = (text: string): HTMLElement => {
  const el = document.createElement('span')
  el.textContent = text
  return el
}

describe('Scope.dispose() (LC-7, LC-10)', () => {
  it('runs LIFO, each cleanup in its own try, returns failures by index, and empties every list', () => {
    const scope = new Scope()
    const order: number[] = []
    const boom = new Error('cleanup #1 boom')
    scope.add(() => order.push(0))
    scope.add(() => {
      order.push(1)
      throw boom
    })
    scope.add(() => order.push(2))
    scope.children.push({} as Component)
    scope.scopes.push(new Scope())
    scope.pending.push(() => {})

    const failures = scope.dispose()

    expect(order).toEqual([2, 1, 0]) // the throw at #1 did not stop #0
    expect(failures).toEqual([{ index: 1, error: boom }])
    expect(scope.list).toHaveLength(0)
    expect(scope.children).toHaveLength(0)
    expect(scope.scopes).toHaveLength(0)
    expect(scope.pending).toHaveLength(0)
  })

  it('a second dispose() runs nothing and reports nothing', () => {
    const scope = new Scope()
    const fn = vi.fn()
    scope.add(fn)
    scope.dispose()
    expect(scope.dispose()).toEqual([])
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('captureScope (P-2)', () => {
  it('disposes what was acquired before a throw and rethrows the error unchanged', () => {
    const listeners = listenerCount()
    const effects = liveEffects()
    const el = document.createElement('button')
    const state = DiamondCore.reactive({ n: 0 })
    const boom = new Error('template boom')
    let caught: unknown = null
    try {
      DiamondCore.captureScope(() => {
        DiamondCore.on(el, 'click', () => {})
        DiamondCore.effect(() => void state.n)
        throw boom
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBe(boom)
    expect(listenerCount() - listeners).toBe(0)
    expect(liveEffects() - effects).toBe(0)
  })

  it('returns the scope and one cleanup that disposes it', () => {
    const listeners = listenerCount()
    const el = document.createElement('button')
    const { value, scope, cleanup } = DiamondCore.captureScope(() => {
      DiamondCore.on(el, 'click', () => {})
      return 42
    })
    expect(value).toBe(42)
    expect(scope).toBeInstanceOf(Scope)
    expect(scope.list).toHaveLength(1)
    cleanup()
    expect(scope.list).toHaveLength(0)
    expect(listenerCount() - listeners).toBe(0)
  })
})

describe('placeBefore: the deferred path (L-37)', () => {
  it('with NO scope — a hand-written template — a structural wired before its anchor is appended still places on the next microtask', async () => {
    const host = detachedHost()
    const anchor = document.createComment('if')
    DiamondCore.if(anchor, [{ when: () => true, make: () => span('X') }])
    host.appendChild(anchor) // after the call, as a hand-written template might
    expect(host.innerHTML).toBe('<!--if-->')
    await tick()
    expect(host.innerHTML).toBe('<span>X</span><!--if-->')
  })

  class RootIf extends Component {
    createTemplate(): HTMLElement {
      const anchor = document.createComment('if')
      DiamondCore.if(anchor, [{ when: () => true, make: () => span('ROOT') }])
      return anchor as unknown as HTMLElement
    }
  }

  it('inside a component the placement waits for the connection drain: synchronous into a connected host', () => {
    const host = connectedHost()
    const c = new RootIf()
    c.mount(host)
    expect(host.innerHTML).toBe('<!----><span>ROOT</span><!--if-->')
    expect(c.phase).toBe('mounted')
    c.unmount()
    expect(host.innerHTML).toBe('')
  })

  it('inside a component the placement waits for the connection drain: a detached root never drains', async () => {
    const host = detachedHost()
    const c = new RootIf()
    c.mount(host)
    await tick()
    expect(host.innerHTML).toBe('<!----><!--if-->') // no microtask fallback inside a scope
    expect(c.phase).toBe('mounting')
    c.unmount()
    expect(host.innerHTML).toBe('')
  })
})
