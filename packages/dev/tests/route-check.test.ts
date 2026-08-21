/**
 * @vitest-environment happy-dom
 *
 * route-check rule suite — each rule with a PASS and a FAIL fixture.
 * Drives the pure checkRoutes() engine directly (the bin only assembles
 * the outlet inventory and prints).
 */
import { describe, it, expect } from 'vitest'
import { checkRoutes, type OutletInventory } from '../src/route-check'
import { Component, Guard, type RouteMap } from '@diamondjs/runtime'

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

describe('unknown-redirect-target (route-id arm)', () => {
  it('fails a route-id target that is not in the flattened map', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-id', target: 'ghost' } },
    }
    expect(rules(routes)).toContain('unknown-redirect-target')
  })
  it('passes a known route-id target', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-id', target: 'c' } },
      c: { path: 'c', component: Page, outlet: 'main' },
    }
    expect(rules(routes)).not.toContain('unknown-redirect-target')
  })
  it("did-you-mean: unknown ID whose '/'-form matches a route suggests route-path", () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-id', target: 'corpora' } },
      // the route at path '/corpora' exists — under a DIFFERENT id
      'corpus-list': { path: 'corpora', component: Page, outlet: 'main' },
    }
    const e = checkRoutes(routes, inv()).find((x) => x.rule === 'unknown-redirect-target')
    expect(e?.message).toContain(`unknown route ID 'corpora'`)
    expect(e?.message).toContain(`Did you mean { type: 'route-path', target: '/corpora' }?`)
  })
})

describe('unresolvable-route-path', () => {
  it('fails a route-path matching no route', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-path', target: '/no/such/place' } },
      b: { path: 'b', component: Page, outlet: 'main' },
    }
    expect(rules(routes)).toContain('unresolvable-route-path')
  })
  it('passes a route-path with :param placeholders matching a param route', () => {
    const routes: RouteMap = {
      legacy: { path: 'c/:id', redirect: { type: 'route-path', target: '/corpora/:id' } },
      workspace: {
        path: 'corpora/:id',
        component: Page,
        outlet: 'main',
        params: { id: IntConverter },
      },
    }
    expect(rules(routes)).not.toContain('unresolvable-route-path')
  })
})

describe('site-path-shadows-route', () => {
  it('fails a site-path that matches an SPA route (mislabeling → hard reload)', () => {
    const routes: RouteMap = {
      oops: { path: 'go', redirect: { type: 'site-path', target: '/corpora' } },
      corpora: { path: 'corpora', component: Page, outlet: 'main' },
    }
    const errors = checkRoutes(routes, inv())
    const e = errors.find((x) => x.rule === 'site-path-shadows-route')
    expect(e?.message).toContain(`Did you mean type: 'route-path'?`)
  })
  it('passes a site-path beyond the SPA (only the bare catch-all would match)', () => {
    const routes: RouteMap = {
      support: { path: 'support', redirect: { type: 'site-path', target: '/support/wiki' } },
      home: { path: '', component: Page, outlet: 'main' },
      'not-found': { path: '*', component: Page, outlet: 'main' },
    }
    expect(rules(routes)).not.toContain('site-path-shadows-route')
  })
})

describe('external-redirect-invalid', () => {
  it('fails non-https schemes (http, mailto, javascript, protocol-relative)', () => {
    for (const target of [
      'http://x.example.com',
      'mailto:a@b.c',
      'javascript:alert(1)',
      '//cdn.example.com/x',
    ]) {
      const routes = {
        a: { path: 'a', redirect: { type: 'external-url', target } },
      } as unknown as RouteMap
      expect(rules(routes), target).toContain('external-redirect-invalid')
    }
  })
  it('passes an https target', () => {
    const routes: RouteMap = {
      a: {
        path: 'a',
        redirect: { type: 'external-url', target: 'https://archive.example.org/x' },
      },
    }
    expect(rules(routes)).not.toContain('external-redirect-invalid')
  })
})

describe('static-target-has-params', () => {
  it('fails :param in a site-path target (static-only, open-redirect rail)', () => {
    const routes: RouteMap = {
      a: { path: 'a/:id', redirect: { type: 'site-path', target: '/wiki/:id' } },
    }
    expect(rules(routes)).toContain('static-target-has-params')
  })
  it('fails :param in an external-url target', () => {
    const routes = {
      a: {
        path: 'a/:id',
        redirect: { type: 'external-url', target: 'https://x.example.com/:id' },
      },
    } as unknown as RouteMap
    expect(rules(routes)).toContain('static-target-has-params')
  })
  it('passes :param in a route-path target (substitution is legal there)', () => {
    const routes: RouteMap = {
      legacy: { path: 'c/:id', redirect: { type: 'route-path', target: '/corpora/:id' } },
      workspace: {
        path: 'corpora/:id',
        component: Page,
        outlet: 'main',
        params: { id: IntConverter },
      },
    }
    expect(rules(routes)).not.toContain('static-target-has-params')
  })
})

describe('redirect-cycle (across both internal arms)', () => {
  it('fails a pure route-id cycle', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-id', target: 'b' } },
      b: { path: 'b', redirect: { type: 'route-id', target: 'a' } },
    }
    expect(rules(routes)).toContain('redirect-cycle')
  })
  it('fails a mixed route-id → route-path cycle', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-path', target: '/b' } },
      b: { path: 'b', redirect: { type: 'route-id', target: 'a' } },
    }
    expect(rules(routes)).toContain('redirect-cycle')
  })
  it('passes chains terminated by site-path or external-url (exempt by definition)', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-id', target: 'b' } },
      b: { path: 'b', redirect: { type: 'site-path', target: '/wiki/home' } },
    }
    expect(rules(routes)).not.toContain('redirect-cycle')
  })
  it('passes an internal chain that terminates at a component route', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-id', target: 'b' } },
      b: { path: 'b', redirect: { type: 'route-path', target: '/c' } },
      c: { path: 'c', component: Page, outlet: 'main' },
    }
    expect(rules(routes)).not.toContain('redirect-cycle')
  })
})

describe('destination-arm-mismatch (cross-arm did-you-means)', () => {
  it("route-id target starting with '/' → suggests route-path", () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-id', target: '/corpora' } },
      corpora: { path: 'corpora', component: Page, outlet: 'main' },
    }
    const e = checkRoutes(routes, inv()).find((x) => x.rule === 'destination-arm-mismatch')
    expect(e?.message).toContain(`route IDs never start with '/'. Did you mean type: 'route-path'?`)
  })
  it('route-path target carrying a scheme → suggests external-url', () => {
    const routes = {
      a: { path: 'a', redirect: { type: 'route-path', target: 'https://x.example.com/y' } },
    } as unknown as RouteMap
    const e = checkRoutes(routes, inv()).find((x) => x.rule === 'destination-arm-mismatch')
    expect(e?.message).toContain(`paths never carry a scheme. Did you mean type: 'external-url'?`)
  })
  it('site-path target carrying a scheme → suggests external-url', () => {
    const routes = {
      a: { path: 'a', redirect: { type: 'site-path', target: 'https://x.example.com/y' } },
    } as unknown as RouteMap
    const e = checkRoutes(routes, inv()).find((x) => x.rule === 'destination-arm-mismatch')
    expect(e?.message).toContain(`Did you mean type: 'external-url'?`)
  })
  it('well-formed arms produce no mismatch errors', () => {
    const routes: RouteMap = {
      a: { path: 'a', redirect: { type: 'route-id', target: 'c' } },
      c: { path: 'c', component: Page, outlet: 'main' },
    }
    expect(rules(routes)).not.toContain('destination-arm-mismatch')
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
