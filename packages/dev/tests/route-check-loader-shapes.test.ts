/**
 * Issue #27 — route-check on Node 22. Two loader-shape differences from Node
 * 20 are pinned here without needing Node 22 itself:
 *
 * 1. tsx's namespaced loader appends `?tsx-namespace=…` to the stub's `data:`
 *    URL. In a `data:` URL everything after the comma is module source, so the
 *    stub has to parse with that tail attached.
 * 2. `tsImport` surfaces a CommonJS routes module as `default` =
 *    `module.exports`, so `routes` sits one level down.
 *
 * The end-to-end check (the real bin on both fixtures) is
 * route-check-template-imports.test.ts, run under both Node versions.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import type { RouteMap } from '@diamondjs/runtime'
import { STUB_MODULE, pickRouteMap } from '../src/route-check'

/** Import a data: module in a child node and report what it exports. */
function importStub(tail: string): { createTemplate: string; def: unknown; thrown: string } {
  const url = 'data:text/javascript,' + encodeURIComponent(STUB_MODULE) + tail
  const script =
    `import(${JSON.stringify(url)}).then((m) => {` +
    `  let thrown = '';` +
    `  try { m.createTemplate() } catch (e) { thrown = String(e.message) }` +
    `  console.log(JSON.stringify({ createTemplate: typeof m.createTemplate, def: m.default, thrown }))` +
    `})`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out.trim())
}

describe('template stub module (#27)', () => {
  it('loads as the inert stub on its own', () => {
    const m = importStub('')
    expect(m.createTemplate).toBe('function')
    expect(m.def).toEqual({})
    expect(m.thrown).toContain('route-check loads templates and styles as inert stubs')
  })

  it('still loads when a loader appends a query to the data: URL', () => {
    const m = importStub('?tsx-namespace=1791320205412')
    expect(m.createTemplate).toBe('function')
    expect(m.def).toEqual({})
  })
})

describe('pickRouteMap (#27)', () => {
  class Page {}
  const map = { home: { path: '/', component: Page, outlet: 'main' } } as unknown as RouteMap

  it('takes a named `routes` export', () => {
    expect(pickRouteMap({ routes: map })).toBe(map)
  })

  it('takes a default export', () => {
    expect(pickRouteMap({ default: map })).toBe(map)
  })

  it('unwraps a CommonJS named export surfaced as default = module.exports (Node 22)', () => {
    expect(pickRouteMap({ default: { routes: map } })).toBe(map)
  })

  it('unwraps a CommonJS default export surfaced as default = module.exports (Node 22)', () => {
    expect(pickRouteMap({ default: { __esModule: true, default: map } })).toBe(map)
  })

  it('does not mistake a route whose id is "routes" for the CommonJS wrapper', () => {
    const only = { routes: { path: '/r', component: Page, outlet: 'main' } } as unknown as RouteMap
    expect(pickRouteMap({ default: only })).toBe(only)
  })

  it('reports nothing when neither export exists', () => {
    expect(pickRouteMap({})).toBeUndefined()
    expect(pickRouteMap({ default: 42 })).toBeUndefined()
  })
})
