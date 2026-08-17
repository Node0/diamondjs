/**
 * @vitest-environment happy-dom
 *
 * §16 D-7 — scheduler disposed-effect guard (highest severity).
 *
 * Mechanism guarded against: an effect queued by a mutation BEFORE unmount()
 * flushes AFTER it. Without the guard, the flush re-runs the effect, which
 * re-arms dependency tracking and re-inserts the disposed effect into the
 * dependency sets — permanent retention of the component + its detached DOM.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCore } from '../src/core'
import { Component } from '../src/component'
import { reactivityEngine } from '../src/reactivity'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** Peek at the engine's private dependency sets (test-only introspection). */
function depSetSize(raw: object, prop: PropertyKey): number {
  const deps = (
    reactivityEngine as unknown as {
      dependencies: WeakMap<object, Map<PropertyKey, Set<unknown>>>
    }
  ).dependencies
  return deps.get(raw)?.get(prop)?.size ?? 0
}

describe('scheduler disposed-effect guard (D-7)', () => {
  it('mutate + unmount in the same tick: effect is dropped, not re-subscribed', async () => {
    const raw = { label: 'a' }
    const state = DiamondCore.reactive(raw)
    let fires = 0

    class Probe extends Component {
      createTemplate(): HTMLElement {
        const div = document.createElement('div')
        DiamondCore.bind(div, 'textContent', () => {
          fires++
          return state.label
        })
        return div
      }
    }

    const host = document.createElement('div')
    const c = new Probe()
    c.mount(host)
    expect(fires).toBe(1) // initial tracked run
    expect(depSetSize(raw, 'label')).toBe(1)

    // The D-7 shape: mutation queues the effect, unmount disposes it,
    // all in the same synchronous tick — the flush lands after disposal.
    state.label = 'b'
    c.unmount()
    await tick()

    expect(fires).toBe(1) // queued-then-disposed effect was dropped, not run
    expect(depSetSize(raw, 'label')).toBe(0) // not re-subscribed post-flush

    state.label = 'c'
    await tick()
    expect(fires).toBe(1) // zero fires on subsequent mutations
    expect(depSetSize(raw, 'label')).toBe(0)
  })

  it('bare effect cleanup during pending flush also drops the effect', async () => {
    const raw = { n: 0 }
    const state = DiamondCore.reactive(raw)
    let fires = 0
    const cleanup = DiamondCore.effect(() => {
      fires++
      void state.n
    })
    expect(fires).toBe(1)

    state.n = 1 // queue
    cleanup() // dispose before flush
    await tick()

    expect(fires).toBe(1)
    expect(depSetSize(raw, 'n')).toBe(0)
  })
})
