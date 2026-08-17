/**
 * @vitest-environment happy-dom
 *
 * route-check rule suite — each rule with a PASS and a FAIL fixture.
 * Drives the pure checkRoutes() engine directly (the bin only assembles
 * the outlet inventory and prints).
 */
import { describe, it, expect } from 'vitest'
import { checkRoutes, type OutletInventory } from './route-check'
import type { RouteMap } from '../packages/runtime/src/router'
import { Component } from '../packages/runtime/src/component'
import { Guard } from '../packages/runtime/src/guard'

class Page extends Component {
  constructor(_p?: Record<string, unknown>) {
    super()
  }
  createTemplate(): HTMLElement {
    return document.createElement('div')
  }
}
class ShellPage extends Component {
  constructor(_p?: Record<string, unknown>) {
    super()
  }
  createTemplate(): HTMLElement {
    return document.createElement('div')
  }
}
class IntConverter {
  static parse(raw: string): { valid: boolean; value: unknown | null } {
    const n = Number(raw)
    return Number.isInteger(n) ? { valid: true, value: n } : { valid: false, value: null }
  }
}

const inv = (overrides: Partial<OutletInventory> = {}): OutletInventory => ({
  root: ['main'],
  byComponent: { ShellPage: ['sub'] },
  byTemplate: { 'shell.html': ['sub'] },
  ...overrides,
})

const rules = (routes: RouteMap, inventory = inv()): string[] =>
  checkRoutes(routes, inventory).map((e) => e.rule)

describe('invalid-route-id', () => {
  it('fails camelCase / snake_case / uppercase / integer-like keys with the canonical message', () => {
    const routes = {
      querySettings: { path: 'q', component: Page, outlet: 'main' },
      snake_case: { path: 's', component: Page, outlet: 'main' },
      Upper: { path: 'u', component: Page, outlet: 'main' },
      '1st': { path: 'o', component: Page, outlet: 'main' },
    } as unknown as RouteMap
    const errors = checkRoutes(routes, inv())
    const bad = errors.filter((e) => e.rule === 'invalid-route-id')
    expect(bad).toHaveLength(4)
    const canonical = bad.find((e) => e.routeId === 'querySettings')!
    expect(canonical.message).toContain('Invalid route ID `querySettings`.')
    expect(canonical.message).toContain('Route IDs must be quoted lowercase kebab-case strings.')
    expect(canonical.message).toContain(`'query-settings': { ... }`)
  })

  it('passes quoted lowercase kebab-case with leading letter', () => {
    const routes: RouteMap = {
      'query-settings': { path: 'q', component: Page, outlet: 'main' },
      home2: { path: 'h', component: Page, outlet: 'main' },
    }
    expect(rules(routes)).not.toContain('invalid-route-id')
  })
})

describe('duplicate-route-id', () => {
  it('fails a duplicate across the flattened tree (IDs are global)', () => {
    const routes: RouteMap = {
      shell: {
        path: 's',
        component: ShellPage,
        outlet: 'main',
        children: { home: { path: 'x', component: Page, outlet: 'sub' } },
      },
      home: { path: 'h', component: Page, outlet: 'main' },
    }
    expect(rules(routes)).toContain('duplicate-route-id')
  })

  it('passes globally-unique IDs', () => {
    const routes: RouteMap = {
      a: { path: 'a', component: Page, outlet: 'main' },
      b: { path: 'b', component: Page, outlet: 'main' },
    }
    expect(rules(routes)).not.toContain('duplicate-route-id')
  })
})

describe('unknown-outlet', () => {
  it('fails an outlet no template declares', () => {
    const routes: RouteMap = { a: { path: 'a', component: Page, outlet: 'sidebar' } }
    expect(rules(routes)).toContain('unknown-outlet')
  })
  it('passes a root-declared outlet', () => {
    const routes: RouteMap = { a: { path: 'a', component: Page, outlet: 'main' } }
    expect(rules(routes)).not.toContain('unknown-outlet')
  })
})

describe('outlet-not-ancestor-owned', () => {
  it("fails when the outlet's owner is not an ancestor route's component", () => {
    const routes: RouteMap = {
      // 'sub' is declared by ShellPage, but 'lost' has no ShellPage ancestor
      lost: { path: 'l', component: Page, outlet: 'sub' },
    }
    expect(rules(routes)).toContain('outlet-not-ancestor-owned')
  })

  it('passes when an ancestor component declares the outlet', () => {
    const routes: RouteMap = {
      shell: {
        path: 's',
        component: ShellPage,
        outlet: 'main',
        children: { kid: { path: 'k', component: Page, outlet: 'sub' } },
      },
    }
    expect(rules(routes)).not.toContain('outlet-not-ancestor-owned')
  })
})

describe('duplicate-outlet-name', () => {
  it('fails the same name twice within one template', () => {
    const routes: RouteMap = { a: { path: 'a', component: Page, outlet: 'main' } }
    const inventory = inv({ byTemplate: { 'shell.html': ['sub', 'sub'] } })
    expect(rules(routes, inventory)).toContain('duplicate-outlet-name')
  })
  it('passes the same name in different templates', () => {
    const routes: RouteMap = { a: { path: 'a', component: Page, outlet: 'main' } }
    const inventory = inv({ byTemplate: { 'x.html': ['sub'], 'y.html': ['sub'] } })
    expect(rules(routes, inventory)).not.toContain('duplicate-outlet-name')
  })
})

describe('param-missing-converter', () => {
  it('fails a :segment without a params entry', () => {
    const routes: RouteMap = { u: { path: 'users/:id', component: Page, outlet: 'main' } }
    expect(rules(routes)).toContain('param-missing-converter')
  })
  it('passes when every :segment has a converter', () => {
    const routes: RouteMap = {
      u: { path: 'users/:id', component: Page, outlet: 'main', params: { id: IntConverter } },
    }
    expect(rules(routes)).not.toContain('param-missing-converter')
  })
})

describe('redirect-cycle / unknown-redirect-target', () => {
  it('fails a redirect cycle', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: 'b' },
      b: { path: 'b', redirect: 'a' },
    }
    expect(rules(routes)).toContain('redirect-cycle')
  })
  it('fails an unknown redirect target', () => {
    const routes: RouteMap = { a: { path: 'a', redirect: 'ghost' } }
    expect(rules(routes)).toContain('unknown-redirect-target')
  })
  it('passes a redirect chain that terminates', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: 'b' },
      b: { path: 'b', redirect: 'c' },
      c: { path: 'c', component: Page, outlet: 'main' },
    }
    const r = rules(routes)
    expect(r).not.toContain('redirect-cycle')
    expect(r).not.toContain('unknown-redirect-target')
  })
})

describe('wildcard-not-terminal', () => {
  it('fails * followed by more segments', () => {
    const routes: RouteMap = { w: { path: '*/tail', component: Page, outlet: 'main' } }
    expect(rules(routes)).toContain('wildcard-not-terminal')
  })
  it('fails * on a route with children', () => {
    const routes: RouteMap = {
      w: {
        path: '*',
        component: ShellPage,
        outlet: 'main',
        children: { kid: { path: 'k', component: Page, outlet: 'sub' } },
      },
    }
    expect(rules(routes)).toContain('wildcard-not-terminal')
  })
  it('passes a terminal *', () => {
    const routes: RouteMap = { 'not-found': { path: '*', component: Page, outlet: 'main' } }
    expect(rules(routes)).not.toContain('wildcard-not-terminal')
  })
})

describe('ambiguous-routes', () => {
  it('fails equal specificity over the same URL shape', () => {
    const routes: RouteMap = {
      'user-by-id': {
        path: 'users/:id',
        component: Page,
        outlet: 'main',
        params: { id: IntConverter },
      },
      'user-by-slug': {
        path: 'users/:slug',
        component: Page,
        outlet: 'main',
        params: { slug: IntConverter },
      },
    }
    expect(rules(routes)).toContain('ambiguous-routes')
  })
  it('passes static-vs-param at the same depth (specificity decides)', () => {
    const routes: RouteMap = {
      'users-list': { path: 'users/list', component: Page, outlet: 'main' },
      'user-detail': {
        path: 'users/:id',
        component: Page,
        outlet: 'main',
        params: { id: IntConverter },
      },
    }
    expect(rules(routes)).not.toContain('ambiguous-routes')
  })
})

describe('guard-check-not-overridden', () => {
  it('fails a guard class using the base check (denies everything)', () => {
    class ForgotCheck extends Guard {
      static override deny(): { path: string } {
        return { path: '/login' }
      }
    }
    const routes: RouteMap = {
      a: { path: 'a', component: Page, outlet: 'main', guard: ForgotCheck },
    }
    expect(rules(routes)).toContain('guard-check-not-overridden')
  })
  it('passes a guard that overrides check', () => {
    class RealGuard extends Guard {
      static override check(): boolean {
        return true
      }
    }
    const routes: RouteMap = {
      a: { path: 'a', component: Page, outlet: 'main', guard: RealGuard },
    }
    expect(rules(routes)).not.toContain('guard-check-not-overridden')
  })
})
