/**
 * Lifecycle Contract acceptance (§10.5), against real Chromium. The app under
 * test is tests/acceptance/app: hand-written components mirroring the shapes
 * the record inventories from Turbine, driven through the router.
 */
import { test, expect, type Page } from '@playwright/test'

type Win = Window & {
  app: { router: { navigate(url: string): Promise<void> }; logs: Array<{ logType: string; message: string }>; listeners(): number; faulty: unknown; ready: boolean }
  __measure: number
  __afterUnmount: { raf: number; fetch: number }
}

async function app(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await page.waitForFunction(() => (window as unknown as Win).app?.ready === true)
}
const go = (page: Page, url: string): Promise<void> => page.evaluate((u) => (window as unknown as Win).app.router.navigate(u), url)
/** The element's box lies inside the viewport (the page scrolled to it, clamped at the bottom). */
const inViewport = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight
  }, selector)
const logs = (page: Page, type: string): Promise<string[]> =>
  page.evaluate((t) => (window as unknown as Win).app.logs.filter((l) => l.logType === t).map((l) => l.message), type)

let uncaught: string[]
let consoleErrors: string[]
test.beforeEach(({ page }) => {
  uncaught = []
  consoleErrors = []
  page.on('pageerror', (e) => uncaught.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
})

test('A-1 a child three levels deep, under a root-level if, focuses its knob in mounted() with no rAF', async ({ page }) => {
  await app(page)
  await go(page, '/knob')
  expect(await page.evaluate(() => document.activeElement?.className)).toBe('knob')
})

test('A-2 scrollTop set in mounted() during a route commit holds after navigation', async ({ page }) => {
  await app(page)
  await go(page, '/scroll')
  expect(await page.evaluate(() => document.querySelector('.scroller')!.scrollTop)).toBe(250)
})

test('A-3 clientWidth read in mounted() under a visible parent is nonzero', async ({ page }) => {
  await app(page)
  await go(page, '/measure')
  expect(await page.evaluate(() => (window as unknown as Win).__measure)).toBe(240)
})

test('A-4 clientWidth read in mounted() under a display:none ancestor is zero — the documented boundary: mounted means connected, not visible', async ({ page }) => {
  await app(page)
  await go(page, '/hidden')
  expect(await page.evaluate(() => (window as unknown as Win).__measure)).toBe(0)
})

test('A-5 an IntersectionObserver rooted at the scroller and created in mounted() renders the first batch without a manual trigger', async ({ page }) => {
  await app(page)
  await go(page, '/viewer')
  await expect(page.locator('.viewer .list p')).toHaveCount(20)
})

test('A-6 navigating to a page whose template root is a structural scrolls to the hash target (P-3)', async ({ page }) => {
  await app(page)
  await go(page, '/about#x')
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
  expect(await inViewport(page, '#x')).toBe(true)
})

test('A-6 (direct load) /about#x scrolls to the hash target', async ({ page }) => {
  await app(page, '/about#x')
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
  expect(await inViewport(page, '#x')).toBe(true)
})

test("A-7 a child's mounted() throws on a live page: page clickable, failed branch absent, exactly one FAILURE line, zero uncaught errors", async ({ page }) => {
  await app(page)
  await go(page, '/boom')
  await expect(page.locator('.branch')).toHaveCount(0)
  await expect(page.locator('.boom-child')).toHaveCount(0)
  await page.locator('.clicker').click()
  await expect(page.locator('.clicker')).toHaveText('clicks 1')
  const failures = await logs(page, 'FAILURE')
  expect(failures).toHaveLength(1)
  expect(failures[0]).toContain('BoomChild')
  expect(uncaught).toEqual([])
})

test('A-8 navigating away during an in-flight rAF and fetch: no callback runs after unmount(), no console error', async ({ page }) => {
  await app(page)
  // Both navigations in one evaluate: no frame can fire between mounted() and the departure.
  await page.evaluate(async () => {
    const w = window as unknown as Win
    w.__afterUnmount = { raf: 0, fetch: 0 }
    await w.app.router.navigate('/inflight')
    await w.app.router.navigate('/')
  })
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => (window as unknown as Win).__afterUnmount)).toEqual({ raf: 0, fetch: 0 })
  expect(uncaught).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(await logs(page, 'WARNING')).toHaveLength(2) // the two declined callbacks recorded `stale`
})

test('A-9 three pages cycled 50 times: DOM node count, listener count and JS heap within tolerance of cycle 1; departed pages are collected', async ({ page }) => {
  await app(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')
  const measure = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    const { metrics } = await cdp.send('Performance.getMetrics')
    const heap = metrics.find((m) => m.name === 'JSHeapUsedSize')!.value
    const dom = await page.evaluate(() => {
      const w = window as unknown as Win & { app: { refs: Array<WeakRef<object>> } }
      return { nodes: document.getElementsByTagName('*').length, listeners: w.app.listeners(), alive: w.app.refs.filter((r) => r.deref()).length }
    })
    return { ...dom, heap }
  }
  const cycle = async () => {
    await go(page, '/p1')
    await go(page, '/p2')
    await go(page, '/p3')
  }
  for (let i = 0; i < 5; i++) await cycle() // warm-up: JIT and caches settle before the baseline
  const first = await measure()
  for (let i = 0; i < 50; i++) await cycle()
  const last = await measure()
  console.log(`A-9 cycle 1: ${JSON.stringify(first)} — cycle 50: ${JSON.stringify(last)} (heap ${((last.heap / first.heap - 1) * 100).toFixed(1)}%)`)
  expect(last.nodes).toBe(first.nodes)
  expect(last.listeners).toBe(first.listeners)
  expect(last.alive).toBeLessThanOrEqual(2) // the occupant, at most one more awaiting a later GC
  // Tolerance set from the first run and recorded in impl_docs/working_notes.md.
  expect(last.heap).toBeLessThan(first.heap * 1.2)
  expect(uncaught).toEqual([])
})

test('A-10 a cleanup that throws on departure faults the instance and names the cleanup; returning mounts a fresh instance', async ({ page }) => {
  await app(page)
  await go(page, '/faulty')
  const first = await page.evaluate(() => (window as unknown as Win).app.faulty)
  await go(page, '/')
  const state = await page.evaluate(() => {
    const f = (window as unknown as Win).app.faulty as { phase: string; history(): Array<{ failures?: Array<{ index: number; error: unknown }> }> }
    const last = f.history().at(-1)!
    return { phase: f.phase, failures: last.failures?.map((x) => `#${x.index} ${String(x.error)}`) }
  })
  expect(state.phase).toBe('faulted')
  expect(state.failures).toEqual(['#0 Error: cleanup boom'])
  const critical = await logs(page, 'CRITICAL')
  expect(critical.some((m) => m.includes('FaultyPage'))).toBe(true)
  await expect(page.locator('.home')).toHaveCount(1) // the navigation stood
  await go(page, '/faulty')
  await expect(page.locator('.faulty')).toHaveCount(1) // a fresh instance
  expect(await page.evaluate(() => (window as unknown as Win).app.faulty)).not.toBe(first)
  expect(uncaught).toEqual([])
})
