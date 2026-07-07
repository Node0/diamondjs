/**
 * @vitest-environment happy-dom
 *
 * Binding/handler timing (DDR §4.3): bind() update-on event + self-registering
 * Component debounce/throttle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiamondCore, Component } from '../src/index'

describe('bind() update-on event override', () => {
  it('samples on the custom event, not on input', () => {
    const state = DiamondCore.reactive({ q: '' })
    const input = document.createElement('input')
    DiamondCore.bind(
      input,
      'value',
      undefined,
      (v) => {
        state.q = v as string
      },
      'blur'
    )

    input.value = 'typing'
    input.dispatchEvent(new Event('input'))
    expect(state.q).toBe('') // 'input' does NOT sample when update-on='blur'

    input.dispatchEvent(new Event('blur'))
    expect(state.q).toBe('typing') // 'blur' samples
  })
})

describe('Component debounce / throttle (self-registering cleanup)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  class Debounced extends Component {
    calls = 0
    handler = this.debounce(() => {
      this.calls++
    }, 500)
    createTemplate() {
      return document.createElement('div')
    }
  }

  it('debounces — only the trailing call within the window fires', () => {
    const c = new Debounced()
    c.handler()
    c.handler()
    c.handler()
    expect(c.calls).toBe(0)
    vi.advanceTimersByTime(500)
    expect(c.calls).toBe(1)
  })

  it('self-registers cancel — unmount clears a pending debounce (leak-safe)', () => {
    const c = new Debounced()
    c.mount(document.createElement('div'))
    c.handler() // schedule
    c.unmount() // must cancel the pending timer
    vi.advanceTimersByTime(500)
    expect(c.calls).toBe(0) // never fired
  })

  class Throttled extends Component {
    calls = 0
    handler = this.throttle(() => {
      this.calls++
    }, 500)
    createTemplate() {
      return document.createElement('div')
    }
  }

  it('throttle fires immediately (leading), then coalesces a trailing call', () => {
    const t = new Throttled()
    t.handler()
    expect(t.calls).toBe(1) // leading edge
    t.handler()
    t.handler()
    expect(t.calls).toBe(1) // coalesced
    vi.advanceTimersByTime(500)
    expect(t.calls).toBe(2) // trailing
  })

  it('throttle self-registers cancel for unmount', () => {
    const t = new Throttled()
    t.mount(document.createElement('div'))
    t.handler() // leading fires (calls=1)
    t.handler() // schedules trailing
    t.unmount() // cancels trailing
    vi.advanceTimersByTime(500)
    expect(t.calls).toBe(1) // trailing never fired
  })
})
