/**
 * @vitest-environment happy-dom
 *
 * v2.2 Phase 4 item 3 — the normative reference route map, exercised as a
 * full application tree ("Conveyor", a generic ingest-pipeline app —
 * ideation fixture ratified in place of the withdrawn project sketches;
 * deliberately agnostic of any real consuming project).
 *
 * The tree exercises every structural shape the RouteMap grammar offers:
 *   - single child               (sources → source-detail)
 *   - multiple sibling children  (pipeline → stage-list | stage-detail |
 *                                 run-latest | run-monitor, one outlet)
 *   - children nested in children(admin → tenants → tenant-quotas, depth 3)
 *   - static-beats-param         (runs/latest vs runs/:runId)
 *   - converter parse-fail       (slug + int converters)
 *   - redirect chains            (legacy-dashboard → dashboard → home)
 *   - guard chains + subtree coverage ([OperatorGuard, AdminGuard])
 *   - terminal wildcard          (not-found)
 *
 * This file also carries the release exit criterion: the reference SPA
 * (app shell + reference map) navigates ALL vectors — push, initial,
 * popstate — leak-free.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Router, type RouteMap } from '../src/router'
import { Guard } from '../src/guard'
import { Component } from '../src/component'
import { DiamondCore } from '../src/core'
import { configure } from '@diamondjs/primafacie'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
configure({ console: false })

// ── converters (app tier) ──────────────────────────────────────────────────

class IntConverter {
  static parse(raw: string): { valid: boolean; value: unknown | null } {
    const n = Number(raw)
    return Number.isInteger(n) && raw.trim() !== ''
      ? { valid: true, value: n }
      : { valid: false, value: null }
  }
}
class SlugConverter {
  static parse(raw: string): { valid: boolean; value: unknown | null } {
    return /^[a-z][a-z0-9-]*$/.test(raw)
      ? { valid: true, value: raw }
      : { valid: false, value: null }
  }
}

// ── guards (app tier) ──────────────────────────────────────────────────────

const guardCalls: string[] = []
class OperatorGuard extends Guard {
  static override check(): boolean {
    guardCalls.push('OperatorGuard')
    return true
  }
}
class AdminGuard extends Guard {
  static override check(): boolean {
    guardCalls.push('AdminGuard')
    return true
  }
}

// ── components (app tier) ──────────────────────────────────────────────────

const shared = DiamondCore.reactive({ tickcount: 0 })
let liveEffectFires = 0

function page(name: string) {
  return class Page extends Component {
    params: Record<string, unknown> | undefined
    constructor(params?: Record<string, unknown>) {
      super()
      this.params = params
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      div.className = name
      DiamondCore.bind(div, 'textContent', () => {
        liveEffectFires++
        return `${name}:${JSON.stringify(this.params ?? {})}:${shared.tickcount}`
      })
      return div
    }
  }
}
function shell(name: string, childOutlet: string) {
  return class Shell extends Component {
    constructor(_p?: Record<string, unknown>) {
      super()
    }
    createTemplate(): HTMLElement {
      const div = document.createElement('div')
      div.className = name
      const outlet = document.createElement('outlet')
      outlet.setAttribute('name', childOutlet)
      div.appendChild(outlet)
      return div
    }
  }
}

const HomePage = page('home')
const SourcesShell = shell('sources', 'source-body')
const SourceDetailPage = page('source-detail')
const PipelineShell = shell('pipeline', 'pipeline-body')
const StageListPage = page('stage-list')
const StageDetailPage = page('stage-detail')
const RunLatestPage = page('run-latest')
const RunMonitorPage = page('run-monitor')
const RunInspectorPage = page('run-inspector')
const AdminShell = shell('admin', 'admin-body')
const TenantShell = shell('tenants', 'tenant-body')
const QuotaPage = page('tenant-quotas')
const NotFoundPage = page('not-found')

// ── THE NORMATIVE REFERENCE ROUTE MAP (spec §13 carries this verbatim) ─────

const routes = {
  home: { path: '', component: HomePage, outlet: 'main' },

  // redirect chain: legacy-dashboard → dashboard → home
  dashboard: { path: 'dashboard', redirect: { type: 'route-id', target: 'home' } },
  'legacy-dashboard': { path: 'legacy/dashboard', redirect: { type: 'route-path', target: '/dashboard' } },

  // single child
  sources: {
    path: 'sources',
    component: SourcesShell,
    outlet: 'main',
    children: {
      'source-detail': {
        path: ':sourceId',
        component: SourceDetailPage,
        outlet: 'source-body',
        params: { sourceId: SlugConverter },
      },
    },
  },

  // multiple sibling children alternating in one parent outlet
  pipeline: {
    path: 'pipeline',
    component: PipelineShell,
    outlet: 'main',
    guard: OperatorGuard,
    children: {
      'stage-list': { path: 'stages', component: StageListPage, outlet: 'pipeline-body' },
      'stage-detail': {
        path: 'stages/:stageIndex',
        component: StageDetailPage,
        outlet: 'pipeline-body',
        params: { stageIndex: IntConverter },
      },
      'run-latest': { path: 'runs/latest', component: RunLatestPage, outlet: 'pipeline-body' },
      'run-monitor': {
        path: 'runs/:runId',
        component: RunMonitorPage,
        outlet: 'pipeline-body',
        params: { runId: IntConverter },
        children: {
          // deep child targeting a ROOT-declared outlet ('panel') — a
          // URL-addressable inspector: multi-outlet plan from one URL
          // (main + pipeline-body + panel simultaneously)
          'run-inspector': {
            path: 'notes/:noteId',
            component: RunInspectorPage,
            outlet: 'panel',
            params: { noteId: IntConverter },
          },
        },
      },
    },
  },

  // children nested inside children (depth 3)
  admin: {
    path: 'admin',
    component: AdminShell,
    outlet: 'main',
    guard: [OperatorGuard, AdminGuard],
    children: {
      tenants: {
        path: 'tenants',
        component: TenantShell,
        outlet: 'admin-body',
        children: {
          'tenant-quotas': {
            path: ':tenantId/quotas',
            component: QuotaPage,
            outlet: 'tenant-body',
            params: { tenantId: SlugConverter },
          },
        },
      },
    },
  },

  'not-found': { path: '*', component: NotFoundPage, outlet: 'main' },
} satisfies RouteMap

// ── harness ────────────────────────────────────────────────────────────────

let router: Router
beforeEach(() => {
  document.body.innerHTML = ''
  for (const name of ['main', 'panel']) {
    const outlet = document.createElement('outlet')
    outlet.setAttribute('name', name)
    document.body.appendChild(outlet)
  }
  history.replaceState(null, '', '/')
  guardCalls.length = 0
  liveEffectFires = 0
  router = new Router(routes)
})
afterEach(() => router.stop())

const classes = (): string[] =>
  Array.from(document.body.querySelectorAll('div')).map((d) => d.className)

// ── recognition table over the reference tree ──────────────────────────────

describe('reference map — recognition table', () => {
  const table: Array<{ url: string; expect: string[]; absent?: string[] }> = [
    { url: '/', expect: ['home'] },
    { url: '/legacy/dashboard', expect: ['home'] }, // 2-hop redirect chain
    { url: '/sources/kafka-orders', expect: ['sources', 'source-detail'] }, // single child
    { url: '/sources/Bad!Slug', expect: ['not-found'], absent: ['source-detail'] },
    { url: '/pipeline/stages', expect: ['pipeline', 'stage-list'] },
    { url: '/pipeline/stages/3', expect: ['pipeline', 'stage-detail'] },
    { url: '/pipeline/runs/latest', expect: ['pipeline', 'run-latest'], absent: ['run-monitor'] }, // static beats :runId
    { url: '/pipeline/runs/1042', expect: ['pipeline', 'run-monitor'] },
    { url: '/pipeline/runs/oops', expect: ['not-found'], absent: ['run-monitor'] }, // int parse fail
    { url: '/admin/tenants/acme-corp/quotas', expect: ['admin', 'tenants', 'tenant-quotas'] },
    { url: '/absolutely/nowhere', expect: ['not-found'] },
  ]

  for (const row of table) {
    it(`${row.url} → [${row.expect.join(', ')}]`, async () => {
      await router.start()
      await router.navigate(row.url)
      for (const c of row.expect) expect(classes()).toContain(c)
      for (const c of row.absent ?? []) expect(classes()).not.toContain(c)
    })
  }

  it('depth-3 chain mounts with nested containment (parent-first)', async () => {
    await router.start()
    await router.navigate('/admin/tenants/acme-corp/quotas')
    const admin = document.querySelector('.admin')
    const tenants = admin?.querySelector('.tenants')
    const quotas = tenants?.querySelector('.tenant-quotas')
    expect(quotas?.textContent).toContain('"tenantId":"acme-corp"')
  })

  it('converter output is typed: stageIndex arrives as a number', async () => {
    await router.start()
    await router.navigate('/pipeline/stages/7')
    expect(document.querySelector('.stage-detail')?.textContent).toContain('"stageIndex":7')
  })

  it('deep child targeting a ROOT outlet: multi-outlet plan from one URL', async () => {
    await router.start()
    await router.navigate('/pipeline/runs/1042/notes/7')
    // main + pipeline-body from the chain…
    const pipelineShell = document.querySelector('.pipeline')
    const monitor = pipelineShell?.querySelector('.run-monitor')
    expect(monitor).toBeTruthy()
    // …plus the inspector in the root-declared 'panel' outlet, OUTSIDE the
    // pipeline subtree (root outlets are always a legal target).
    const inspector = document.querySelector('.run-inspector')
    expect(inspector?.textContent).toContain('"noteId":7')
    expect(pipelineShell?.contains(inspector!)).toBe(false)

    // Navigating away tears the panel occupant down with the plan diff.
    await router.navigate('/pipeline/runs/1042')
    expect(document.querySelector('.run-inspector')).toBeNull()
  })

  it('leading slashes on path strings are cosmetic (position-relative equivalence)', async () => {
    const slashed: RouteMap = {
      home: { path: '/', component: HomePage, outlet: 'main' },
      about: { path: '/about', component: StageListPage, outlet: 'main' },
      'not-found': { path: '*', component: NotFoundPage, outlet: 'main' },
    }
    router.stop()
    router = new Router(slashed)
    await router.start()
    await router.navigate('/about')
    expect(classes()).toContain('stage-list') // '/about' ≡ 'about'
  })
})

// ── sibling swaps + guard subtree coverage ─────────────────────────────────

describe('reference map — siblings and guards', () => {
  it('sibling children swap within one outlet; the parent shell survives untouched', async () => {
    await router.start()
    await router.navigate('/pipeline/stages')
    const shellEl = document.querySelector('.pipeline')

    await router.navigate('/pipeline/stages/3')
    expect(document.querySelector('.pipeline')).toBe(shellEl)
    await router.navigate('/pipeline/runs/latest')
    expect(document.querySelector('.pipeline')).toBe(shellEl)
    await router.navigate('/pipeline/runs/1042')
    expect(document.querySelector('.pipeline')).toBe(shellEl)
    expect(classes()).toContain('run-monitor')
    expect(classes()).not.toContain('stage-list')
  })

  it('a parent guard covers its subtree — evaluated once per navigation into it', async () => {
    await router.start()
    guardCalls.length = 0
    await router.navigate('/pipeline/stages')
    expect(guardCalls).toEqual(['OperatorGuard'])
    await router.navigate('/pipeline/stages/3') // still inside the subtree
    expect(guardCalls).toEqual(['OperatorGuard', 'OperatorGuard'])
  })

  it('guard arrays run in chain order: parent-declared order, first non-true wins', async () => {
    await router.start()
    guardCalls.length = 0
    await router.navigate('/admin/tenants/acme-corp/quotas')
    expect(guardCalls).toEqual(['OperatorGuard', 'AdminGuard'])
  })
})

// ── exit criterion: all vectors, leak-free ─────────────────────────────────

describe('reference SPA — all vectors leak-free (release exit criterion)', () => {
  it('push + popstate + initial vectors leave zero orphaned effects', async () => {
    await router.start() // initial vector ('/' → home)

    // Push vector: wander the whole tree
    const tour = [
      '/sources/kafka-orders',
      '/pipeline/stages',
      '/pipeline/stages/3',
      '/pipeline/runs/latest',
      '/pipeline/runs/1042',
      '/admin/tenants/acme-corp/quotas',
      '/',
    ]
    for (const url of tour) await router.navigate(url)
    await tick()

    // Popstate vector: jump back to a deep URL and fire the handler
    history.replaceState(null, '', '/pipeline/runs/1042')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await tick()
    expect(classes()).toContain('run-monitor')

    // Leak probe: after 9 navigations across every shape in the tree,
    // exactly ONE bound leaf is live — a shared mutation fires exactly once.
    await tick()
    const baseline = liveEffectFires
    shared.tickcount++
    await tick()
    expect(liveEffectFires).toBe(baseline + 1)
  })
})
