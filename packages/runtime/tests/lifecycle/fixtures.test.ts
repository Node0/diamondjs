/**
 * @vitest-environment happy-dom
 *
 * Fixtures as docs (Lifecycle Contract §10.1): every lifecycle code example
 * in the spec and the README is a file under fixtures/, imported here, and
 * the docs must contain it verbatim — docs cannot drift from tests.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { connectedHost, tick } from './harness'
import { MyComponent } from './fixtures/canonical'
import { Ticker } from './fixtures/deferred-work'

const root = resolve(__dirname, '../../../..')
const fixture = (name: string): string => readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8').trim()

/** The lifecycle contract first ships in v2.3.0, so its spec is the one that must match. */
const SPEC = 'docs/spec/v2.3.0/DiamondJS_Architecture_Specification_v2.3.0.md'

function doc(path: string): string {
  const found = resolve(root, path)
  if (!existsSync(found)) throw new Error(`${path} does not exist`)
  return readFileSync(found, 'utf-8')
}

describe('fixtures are the docs', () => {
  it('the spec §4.2 canonical component is fixtures/canonical.ts verbatim', () => {
    const spec = doc(SPEC)
    expect(spec).toContain(fixture('canonical.ts'))
  })

  it('the spec §4.4 deferred-work example is fixtures/deferred-work.ts verbatim', () => {
    const spec = doc(SPEC)
    expect(spec).toContain(fixture('deferred-work.ts'))
  })

  it('the README lifecycle example is fixtures/canonical.ts verbatim', () => {
    expect(doc('README.md')).toContain(fixture('canonical.ts'))
  })
})

describe('the fixtures run', () => {
  it('canonical: the callbacks run in order and mounted() focuses the input', () => {
    const c = new MyComponent()
    c.mount(connectedHost())
    expect(c.count).toBe(1) // constructed()
    expect(c.phase).toBe('mounted')
    expect(document.activeElement).toBe(c.getElement()!.querySelector('input'))
    c.unmount()
    expect(c.count).toBe(2) // unmounted()
    c.mount(connectedHost()) // remount permitted
    expect(c.count).toBe(2) // constructed() ran once
    c.dispose()
  })

  it('deferred-work: the rAF callback declines after unmount() and the debounce survives a remount', async () => {
    vi.useFakeTimers()
    try {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
        setTimeout(() => cb(0), 16)
        return 1
      })
      const t = new Ticker()
      t.mount(connectedHost())
      t.unmount()
      vi.advanceTimersByTime(20)
      expect(scroll).not.toHaveBeenCalled()
      expect(t.history().at(-1)).toMatchObject({ cause: 'stale', outcome: 'stale' })

      t.mount(connectedHost())
      t.getElement()!.click()
      vi.advanceTimersByTime(1000)
      expect(t.seconds).toBe(1) // the debounce still works after a remount
      t.dispose()
      raf.mockRestore()
    } finally {
      vi.useRealTimers()
    }
    await tick()
  })
})
