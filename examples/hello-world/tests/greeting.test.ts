/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiamondCore, Component } from '@diamondjs/runtime'

/**
 * Greeting component matching the v1.5.1 compiled output pattern.
 *
 * In production, @reactive generates getter/setter pairs backed by
 * reactive state. Here we wire that up manually to test the component
 * behavior without needing the compiler transform.
 */
class Greeting extends Component {
  private _state = DiamondCore.reactive({ name: 'World' })

  get name() { return this._state.name }
  set name(v: string) { this._state.name = v }

  // [Diamond] Compiler-generated instance template method
  createTemplate() {
    const div = document.createElement('div')
    div.className = 'greeting'

    const input = document.createElement('input')
    input.placeholder = 'Enter your name'
    // [Diamond] Two-way binding: value ↔ this.name
    DiamondCore.bind(
      input,
      'value',
      () => this.name,
      (v) => (this.name = v as string)
    )

    const p = document.createElement('p')
    // [Diamond] One-way binding: textContent ← this.name
    DiamondCore.bind(p, 'textContent', () => `Hello, ${this.name}!`)

    div.appendChild(input)
    div.appendChild(p)

    return div
  }
}

describe('Greeting component', () => {
  let host: HTMLElement

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mounts and renders default greeting', () => {
    const greeting = new Greeting()
    greeting.mount(host)

    const el = greeting.getElement()!
    expect(el.className).toBe('greeting')
    expect(el.querySelector('p')!.textContent).toBe('Hello, World!')
  })

  it('renders input with placeholder', () => {
    const greeting = new Greeting()
    greeting.mount(host)

    const input = greeting.getElement()!.querySelector('input')!
    expect(input.placeholder).toBe('Enter your name')
  })

  it('sets initial input value from state', () => {
    const greeting = new Greeting()
    greeting.mount(host)

    const input = greeting.getElement()!.querySelector('input')!
    expect(input.value).toBe('World')
  })

  it('updates greeting when name changes programmatically', async () => {
    const greeting = new Greeting()
    greeting.mount(host)

    greeting.name = 'Diamond'
    await vi.runAllTimersAsync()

    expect(greeting.getElement()!.querySelector('p')!.textContent).toBe(
      'Hello, Diamond!'
    )
  })

  it('updates input value when name changes programmatically', async () => {
    const greeting = new Greeting()
    greeting.mount(host)

    greeting.name = 'Alice'
    await vi.runAllTimersAsync()

    expect(greeting.getElement()!.querySelector('input')!.value).toBe('Alice')
  })

  it('updates state from input (two-way binding)', () => {
    const greeting = new Greeting()
    greeting.mount(host)

    const input = greeting.getElement()!.querySelector('input')!
    input.value = 'Bob'
    input.dispatchEvent(new Event('input'))

    expect(greeting.name).toBe('Bob')
  })

  it('propagates input change to greeting text (two-way round-trip)', async () => {
    const greeting = new Greeting()
    greeting.mount(host)

    // Simulate user typing
    const input = greeting.getElement()!.querySelector('input')!
    input.value = 'Claude'
    input.dispatchEvent(new Event('input'))

    await vi.runAllTimersAsync()

    expect(greeting.getElement()!.querySelector('p')!.textContent).toBe(
      'Hello, Claude!'
    )
  })

  it('handles empty name', async () => {
    const greeting = new Greeting()
    greeting.mount(host)

    greeting.name = ''
    await vi.runAllTimersAsync()

    expect(greeting.getElement()!.querySelector('p')!.textContent).toBe(
      'Hello, !'
    )
  })

  it('unmounts cleanly', () => {
    const greeting = new Greeting()
    greeting.mount(host)
    expect(host.children.length).toBe(1)

    greeting.unmount()
    expect(host.children.length).toBe(0)
    expect(greeting.getElement()).toBeNull()
  })
})
