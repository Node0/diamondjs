/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiamondCore, Component } from '@diamondjs/runtime'

/**
 * Counter component matching the v1.5.1 compiled output pattern.
 *
 * In production, @reactive generates getter/setter pairs backed by
 * reactive state. Here we wire that up manually to test the component
 * behavior without needing the compiler transform.
 */
class Counter extends Component {
  private _state = DiamondCore.reactive({ count: 0 })

  get count() { return this._state.count }
  set count(v: number) { this._state.count = v }

  increment(): void {
    this.count++
  }

  decrement(): void {
    this.count--
  }

  // [Diamond] Compiler-generated instance template method
  createTemplate() {
    const div = document.createElement('div')
    div.className = 'counter'

    const decrementBtn = document.createElement('button')
    // [Diamond] Event binding: click → this.decrement()
    DiamondCore.on(decrementBtn, 'click', () => this.decrement())
    decrementBtn.textContent = '-'

    const span = document.createElement('span')
    // [Diamond] Text interpolation binding: textContent ← this.count
    DiamondCore.bind(span, 'textContent', () => `${this.count}`)

    const incrementBtn = document.createElement('button')
    // [Diamond] Event binding: click → this.increment()
    DiamondCore.on(incrementBtn, 'click', () => this.increment())
    incrementBtn.textContent = '+'

    div.appendChild(decrementBtn)
    div.appendChild(span)
    div.appendChild(incrementBtn)

    return div
  }
}

describe('Counter component', () => {
  let host: HTMLElement

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mounts and renders initial count of 0', () => {
    const counter = new Counter()
    counter.mount(host)

    const el = counter.getElement()!
    expect(el.className).toBe('counter')
    expect(el.querySelector('span')!.textContent).toBe('0')
  })

  it('renders increment and decrement buttons', () => {
    const counter = new Counter()
    counter.mount(host)

    const buttons = counter.getElement()!.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toBe('-')
    expect(buttons[1].textContent).toBe('+')
  })

  it('increments count and updates DOM', async () => {
    const counter = new Counter()
    counter.mount(host)

    counter.increment()
    expect(counter.count).toBe(1)

    await vi.runAllTimersAsync()
    expect(counter.getElement()!.querySelector('span')!.textContent).toBe('1')
  })

  it('decrements count and updates DOM', async () => {
    const counter = new Counter()
    counter.mount(host)

    counter.decrement()
    expect(counter.count).toBe(-1)

    await vi.runAllTimersAsync()
    expect(counter.getElement()!.querySelector('span')!.textContent).toBe('-1')
  })

  it('handles multiple increments', async () => {
    const counter = new Counter()
    counter.mount(host)

    counter.increment()
    counter.increment()
    counter.increment()
    expect(counter.count).toBe(3)

    await vi.runAllTimersAsync()
    expect(counter.getElement()!.querySelector('span')!.textContent).toBe('3')
  })

  it('handles click events on buttons', async () => {
    const counter = new Counter()
    counter.mount(host)

    const buttons = counter.getElement()!.querySelectorAll('button')

    // Click increment (+)
    buttons[1].click()
    await vi.runAllTimersAsync()
    expect(counter.getElement()!.querySelector('span')!.textContent).toBe('1')

    // Click decrement (-)
    buttons[0].click()
    await vi.runAllTimersAsync()
    expect(counter.getElement()!.querySelector('span')!.textContent).toBe('0')
  })

  it('unmounts cleanly', () => {
    const counter = new Counter()
    counter.mount(host)
    expect(host.children.length).toBe(1)

    counter.unmount()
    expect(host.children.length).toBe(0)
    expect(counter.getElement()).toBeNull()
  })

  it('pre-set count is reflected on mount', () => {
    const counter = new Counter()
    counter.count = 42
    counter.mount(host)

    expect(counter.getElement()!.querySelector('span')!.textContent).toBe('42')
  })
})
