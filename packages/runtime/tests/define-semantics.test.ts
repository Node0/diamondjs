/**
 * @vitest-environment happy-dom
 *
 * Issue #11 — @reactive must survive [[Define]] class-field semantics.
 *
 * With `useDefineForClassFields: true` (TypeScript's default for ES2022+
 * targets; what Parcel 2.16 / SWC emit) a decorated field is DEFINED on the
 * instance as an own data property after super() returns, shadowing the
 * accessor the legacy decorator installed on the prototype. Bindings then read
 * a plain property and nothing ever re-renders — silently. The runtime now
 * records decorated keys and Component.mount() re-routes shadowed values
 * through their accessors.
 *
 * The tests reproduce the toolchain's output directly with
 * Object.defineProperty in the constructor, so they are independent of how
 * vitest/esbuild happen to lower class fields.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DiamondCore } from '../src/core'
import { Component } from '../src/component'
import { reactive } from '../src/decorators'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** What `class X { count = 0 }` compiles to under [[Define]] semantics. */
function defineField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

class Counter extends Component {
  declare count: number
  declare label: string
  constructor() {
    super()
    defineField(this, 'count', 0) // ← [[Define]]: shadows the prototype accessor
    defineField(this, 'label', 'n')
  }
  createTemplate(): HTMLElement {
    const div = document.createElement('div')
    DiamondCore.bind(div, 'textContent', () => `${this.label}=${this.count}`)
    return div
  }
}
// What `__decorate([reactive], Counter.prototype, 'count', void 0)` does:
;(reactive as (t: object, k: string) => void)(Counter.prototype, 'count')
;(reactive as (t: object, k: string) => void)(Counter.prototype, 'label')

afterEach(() => {
  delete (globalThis as { __DIAMOND_DEV__?: unknown }).__DIAMOND_DEV__
})

describe('legacy @reactive + [[Define]] fields', () => {
  it('is inert WITHOUT the mount() repair (the bug, pinned)', async () => {
    const c = new Counter()
    // Before mount the own data property shadows the accessor…
    const own = Object.getOwnPropertyDescriptor(c, 'count')
    expect(own && 'value' in own).toBe(true)
    // …so an effect reading it tracks nothing.
    const fn = vi.fn(() => c.count)
    DiamondCore.effect(fn)
    c.count = 5
    await tick()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('renders and re-renders after mount() (the repair)', async () => {
    const host = document.createElement('div')
    const c = new Counter()
    c.mount(host)
    expect(host.textContent).toBe('n=0')

    c.count = 5
    await tick()
    expect(host.textContent).toBe('n=5')

    c.label = 'count'
    await tick()
    expect(host.textContent).toBe('count=5')
    c.unmount()
  })

  it('preserves a value written before mount()', async () => {
    const host = document.createElement('div')
    const c = new Counter()
    c.count = 42
    c.mount(host)
    expect(host.textContent).toBe('n=42')
    expect(c.count).toBe(42)
    c.unmount()
  })

  it('leaves the field an accessor afterwards (no own data property remains)', () => {
    const c = new Counter()
    c.mount(document.createElement('div'))
    const own = Object.getOwnPropertyDescriptor(c, 'count')
    expect(own === undefined || 'value' in own === false).toBe(true)
    c.unmount()
  })

  it('is a no-op for a toolchain that already emits [[Set]] assignments', async () => {
    class SetCounter extends Component {
      declare count: number
      constructor() {
        super()
        ;(this as { count: number }).count = 1 // ← [[Set]]: goes through the accessor
      }
      createTemplate(): HTMLElement {
        const div = document.createElement('div')
        DiamondCore.bind(div, 'textContent', () => String(this.count))
        return div
      }
    }
    ;(reactive as (t: object, k: string) => void)(SetCounter.prototype, 'count')
    const host = document.createElement('div')
    const c = new SetCounter()
    c.mount(host)
    expect(host.textContent).toBe('1')
    c.count = 2
    await tick()
    expect(host.textContent).toBe('2')
    c.unmount()
  })

  it('repairs fields decorated on a PARENT class of the mounted instance', async () => {
    class Child extends Counter {
      constructor() {
        super()
        defineField(this, 'extra', 'e')
      }
    }
    const host = document.createElement('div')
    const c = new Child()
    c.mount(host)
    c.count = 9
    await tick()
    expect(host.textContent).toBe('n=9')
    c.unmount()
  })
})

describe('TC39 field decorator path', () => {
  // Simulate `@reactive count = 0` under standard decorators: the decorator
  // receives (undefined, context), may register per-instance initializers,
  // and returns an initializer that produces the field's value; the field is
  // then DEFINED on the instance.
  function decorateField(key: string) {
    const initializers: Array<(this: unknown) => void> = []
    const context = {
      kind: 'field',
      name: key,
      static: false,
      private: false,
      access: { get: () => undefined, set: () => {}, has: () => true },
      addInitializer: (fn: (this: unknown) => void) => initializers.push(fn),
      metadata: {},
    } as unknown as ClassFieldDecoratorContext
    const init = (reactive as (t: undefined, c: ClassFieldDecoratorContext) => (v: unknown) => unknown)(
      undefined,
      context
    )
    return { initializers, init }
  }

  it('records the key via addInitializer and mount() installs an instance accessor', async () => {
    const { initializers, init } = decorateField('count')
    class Tc39 extends Component {
      declare count: number
      constructor() {
        super()
        for (const fn of initializers) fn.call(this)
        defineField(this, 'count', init(0))
      }
      createTemplate(): HTMLElement {
        const div = document.createElement('div')
        DiamondCore.bind(div, 'textContent', () => String(this.count))
        return div
      }
    }
    const host = document.createElement('div')
    const c = new Tc39()
    c.mount(host)
    expect(host.textContent).toBe('0')
    c.count = 3
    await tick()
    expect(host.textContent).toBe('3')
    c.unmount()
  })
})

describe('dev-build report', () => {
  it('warns ONCE per class in dev builds, naming the fields and the tsconfig fix', () => {
    ;(globalThis as { __DIAMOND_DEV__?: unknown }).__DIAMOND_DEV__ = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      class DevCounter extends Counter {}
      const a = new DevCounter()
      a.mount(document.createElement('div'))
      const b = new DevCounter()
      b.mount(document.createElement('div'))
      const messages = warn.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('[[Define]]'))
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain('DevCounter')
      expect(messages[0]).toContain('count')
      expect(messages[0]).toContain('label')
      expect(messages[0]).toContain('useDefineForClassFields')
      a.unmount()
      b.unmount()
    } finally {
      warn.mockRestore()
    }
  })

  it('is silent outside dev builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      class ProdCounter extends Counter {}
      const c = new ProdCounter()
      c.mount(document.createElement('div'))
      expect(warn.mock.calls.some((c) => c.join(' ').includes('[[Define]]'))).toBe(false)
      c.unmount()
    } finally {
      warn.mockRestore()
    }
  })
})
