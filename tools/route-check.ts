/**
 * DiamondJS route-check (v2.2 Phase 5) — standalone build-time gate for
 * RouteMaps (stink-check posture: red output, nonzero exit, no partial
 * passes). Errors speak ROUTE IDS, not file offsets.
 *
 * Usage:
 *   tsx tools/route-check.ts <routes-module.ts>   # module exporting `routes`
 *                                                 # (or default export)
 *
 * The outlet inventory is assembled by scanning the repo's .html templates
 * for <outlet name="..."> declarations: templates paired with a component
 * class contribute to that component's inventory; unpaired shells (e.g.
 * index.html) contribute root-declared outlets.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { pathToFileURL } from 'url'
import { Guard } from '../packages/runtime/src/guard'
import type { RouteMap, RouteDefinition } from '../packages/runtime/src/router'
import { Print } from '../packages/primafacie/src/primafacie'

// ── rule engine (pure — the test suite drives this directly) ───────────────

export interface OutletInventory {
  /** Outlets declared by unpaired shell templates (root-declared). */
  root: string[]
  /** componentClassName → outlet names its template declares. */
  byComponent: Record<string, string[]>
  /** templateFile → outlet names (for duplicate-outlet-name). */
  byTemplate: Record<string, string[]>
}

export interface RouteCheckError {
  rule: string
  routeId: string | null
  message: string
}

const ROUTE_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

const kebabify = (id: string): string =>
  id
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')

interface Flat {
  id: string
  def: RouteDefinition
  parentIds: string[]
  segments: string[]
}

function flatten(routes: RouteMap, parents: Flat[] = [], out: Flat[] = []): Flat[] {
  for (const [id, def] of Object.entries(routes)) {
    const own = def.path.split('/').filter(Boolean)
    const parent = parents[parents.length - 1]
    const flat: Flat = {
      id,
      def,
      parentIds: parents.map((p) => p.id),
      segments: parent ? [...parent.segments, ...own] : own,
    }
    out.push(flat)
    if ('children' in def && def.children) flatten(def.children, [...parents, flat], out)
  }
  return out
}

export function checkRoutes(
  routes: RouteMap,
  inventory: OutletInventory
): RouteCheckError[] {
  const errors: RouteCheckError[] = []
  const flat = flatten(routes)
  const err = (rule: string, routeId: string | null, message: string): void => {
    errors.push({ rule, routeId, message })
  }

  // invalid-route-id — full kebab grammar, canonical message
  for (const r of flat) {
    if (!ROUTE_ID_RE.test(r.id)) {
      err(
        'invalid-route-id',
        r.id,
        `Invalid route ID \`${r.id}\`.\n` +
          `Route IDs must be quoted lowercase kebab-case strings.\n` +
          `Use:\n  '${kebabify(r.id) || 'route-id'}': { ... }`
      )
    }
  }

  // duplicate-route-id — global, over the flattened tree
  const seen = new Map<string, number>()
  for (const r of flat) seen.set(r.id, (seen.get(r.id) ?? 0) + 1)
  for (const [id, n] of seen) {
    if (n > 1) err('duplicate-route-id', id, `Route ID '${id}' appears ${n} times across the flattened tree; IDs are global.`)
  }

  const byId = new Map(flat.map((r) => [r.id, r]))
  const allDeclaredOutlets = new Set([
    ...inventory.root,
    ...Object.values(inventory.byComponent).flat(),
  ])

  // Structural path resolution for route-path / site-path targets: a target
  // segment matches a pattern ':param' (anything) or an equal static; a
  // target ':param' placeholder matches only a pattern ':param'. The bare
  // catch-all (pattern exactly ['*']) is excluded — matching only the
  // wildcard is unresolvable in intent, and every site-path would "shadow"
  // it. There is NO arm classifier here — validation checks arm/target
  // agreement; it never infers the arm.
  const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
  const resolvePath = (target: string): Flat | null => {
    const segs = target.split('/').filter(Boolean)
    for (const candidate of flat) {
      const pat = candidate.segments
      if (pat.length === 1 && pat[0] === '*') continue // bare catch-all
      let ok = pat.length > 0
      for (let i = 0; i < pat.length && ok; i++) {
        const p = pat[i]
        if (p === '*') break // subtree wildcard consumes the rest
        if (i >= segs.length) ok = false
        else if (p.startsWith(':')) ok = true // accepts static or placeholder
        else ok = p === segs[i]
      }
      if (ok && !pat.includes('*') && pat.length !== segs.length) ok = false
      if (ok) return candidate
    }
    return null
  }

  for (const r of flat) {
    const def = r.def

    if ('redirect' in def) {
      const dest = def.redirect
      switch (dest.type) {
        case 'route-id': {
          if (dest.target.startsWith('/')) {
            err(
              'destination-arm-mismatch',
              r.id,
              `Route '${r.id}': route IDs never start with '/'. Did you mean type: 'route-path'?`
            )
            break
          }
          if (!byId.has(dest.target)) {
            const pathForm = resolvePath('/' + dest.target)
            err(
              'unknown-redirect-target',
              r.id,
              `Route '${r.id}': unknown route ID '${dest.target}'.` +
                (pathForm
                  ? ` Did you mean { type: 'route-path', target: '/${dest.target}' }?`
                  : '')
            )
          }
          break
        }
        case 'route-path': {
          if (SCHEME_RE.test(dest.target)) {
            err(
              'destination-arm-mismatch',
              r.id,
              `Route '${r.id}': paths never carry a scheme. Did you mean type: 'external-url'?`
            )
            break
          }
          if (!resolvePath(dest.target)) {
            err(
              'unresolvable-route-path',
              r.id,
              `Route '${r.id}': route-path '${dest.target}' does not match any route in the map.`
            )
          }
          break
        }
        case 'site-path': {
          if (SCHEME_RE.test(dest.target)) {
            err(
              'destination-arm-mismatch',
              r.id,
              `Route '${r.id}': paths never carry a scheme. Did you mean type: 'external-url'?`
            )
            break
          }
          if (/\/:[^/]/.test(dest.target)) {
            err(
              'static-target-has-params',
              r.id,
              `Route '${r.id}': site-path targets are static-only (open-redirect rail); ':param' is not substituted here.`
            )
          }
          const shadowed = resolvePath(dest.target)
          if (shadowed) {
            err(
              'site-path-shadows-route',
              r.id,
              `Route '${r.id}': site-path '${dest.target}' matches SPA route '${shadowed.id}' — ` +
                `mislabeled; the user would get a hard reload where SPA navigation was intended. ` +
                `Did you mean type: 'route-path'?`
            )
          }
          break
        }
        case 'external-url': {
          if (!/^https:\/\//.test(dest.target)) {
            err(
              'external-redirect-invalid',
              r.id,
              `Route '${r.id}': external-url targets must be https://-schemed; got '${dest.target}'.`
            )
          }
          if (/\/:[^/]/.test(dest.target.replace(/^https:\/\//, ''))) {
            err(
              'static-target-has-params',
              r.id,
              `Route '${r.id}': external-url targets are static-only (open-redirect rail); ':param' is not substituted here.`
            )
          }
          break
        }
      }

      // redirect-cycle — across BOTH internal arms (route-id → route-path →
      // route-id chains). site-path / external-url terminate the graph.
      const visited: string[] = [r.id]
      let cur: Flat | null = r
      for (;;) {
        const curDef = cur.def
        if (!('redirect' in curDef)) break
        const d = curDef.redirect
        let next: Flat | null = null
        if (d.type === 'route-id' && !d.target.startsWith('/')) {
          next = byId.get(d.target) ?? null
        } else if (d.type === 'route-path' && !SCHEME_RE.test(d.target)) {
          next = resolvePath(d.target)
        } else {
          break // site-path / external-url terminate by definition
        }
        if (!next) break // unknown targets already reported above
        if (visited.includes(next.id)) {
          err('redirect-cycle', r.id, `Redirect cycle: ${[...visited, next.id].join(' → ')}.`)
          break
        }
        visited.push(next.id)
        cur = next
      }
      continue
    }

    // unknown-outlet — target not in the template outlet inventory at all
    if (!allDeclaredOutlets.has(def.outlet)) {
      err('unknown-outlet', r.id, `Route '${r.id}' targets outlet '${def.outlet}', which no template declares.`)
    } else if (!inventory.root.includes(def.outlet)) {
      // outlet-not-ancestor-owned — declared, but only by a non-ancestor
      const ancestorComponents = r.parentIds
        .map((pid) => byId.get(pid)?.def)
        .filter((d): d is Extract<RouteDefinition, { component: unknown }> => !!d && 'component' in d)
        .map((d) => d.component.name)
      const owners = Object.entries(inventory.byComponent)
        .filter(([, outlets]) => outlets.includes(def.outlet))
        .map(([name]) => name)
      if (!owners.some((o) => ancestorComponents.includes(o))) {
        err(
          'outlet-not-ancestor-owned',
          r.id,
          `Route '${r.id}' targets outlet '${def.outlet}', declared by [${owners.join(', ')}] — ` +
            `none of which is an ancestor route's component (ancestors: [${ancestorComponents.join(', ') || 'root only'}]).`
        )
      }
    }

    // param-missing-converter — every :segment needs a params entry
    for (const seg of def.path.split('/').filter(Boolean)) {
      if (seg.startsWith(':') && !def.params?.[seg.slice(1)]) {
        err('param-missing-converter', r.id, `Route '${r.id}' has ':${seg.slice(1)}' with no converter in params (required for every :segment).`)
      }
    }

    // wildcard-not-terminal
    const segs = def.path.split('/').filter(Boolean)
    const starIdx = segs.indexOf('*')
    if (starIdx !== -1 && (starIdx !== segs.length - 1 || ('children' in def && def.children && Object.keys(def.children).length > 0))) {
      err('wildcard-not-terminal', r.id, `Route '${r.id}': '*' must be the terminal segment (no trailing segments, no children).`)
    }

    // guard-check-not-overridden — base check is fail-closed; using it verbatim
    // is almost certainly a mistake (the runtime fail-closed remains backstop)
    const guards = def.guard ? (Array.isArray(def.guard) ? def.guard : [def.guard]) : []
    for (const g of guards) {
      if (g.check === Guard.check) {
        err('guard-check-not-overridden', r.id, `Route '${r.id}' guard '${g.name}' does not override check(); the base denies everything (fail closed).`)
      }
    }
  }

  // duplicate-outlet-name — within ONE component's template
  for (const [template, outlets] of Object.entries(inventory.byTemplate)) {
    const counts = new Map<string, number>()
    for (const o of outlets) counts.set(o, (counts.get(o) ?? 0) + 1)
    for (const [name, n] of counts) {
      if (n > 1) err('duplicate-outlet-name', null, `Template '${template}' declares outlet '${name}' ${n} times.`)
    }
  }

  // ambiguous-routes — equal specificity over the same URL shape
  const componentFlats = flat.filter((r) => 'component' in r.def)
  for (let i = 0; i < componentFlats.length; i++) {
    for (let j = i + 1; j < componentFlats.length; j++) {
      const a = componentFlats[i].segments
      const b = componentFlats[j].segments
      if (a.length !== b.length) continue
      const sameShape = a.every((seg, k) => {
        const kb = b[k]
        const kind = (s: string): string => (s === '*' ? '*' : s.startsWith(':') ? ':' : s)
        return kind(seg) === kind(kb)
      })
      if (sameShape) {
        err(
          'ambiguous-routes',
          componentFlats[i].id,
          `Routes '${componentFlats[i].id}' and '${componentFlats[j].id}' have equal specificity over the same URL shape ` +
            `('/${a.join('/')}'); there is no positional tiebreak — restructure the paths.`
        )
      }
    }
  }

  return errors
}

// ── outlet inventory scan ──────────────────────────────────────────────────

const IGNORE = new Set([
  'node_modules', 'dist', '.git', '.parcel-cache', 'coverage',
  'README_files', '.memory', 'reference_files',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.html')) out.push(full)
  }
  return out
}

export function scanOutletInventory(root: string): OutletInventory {
  const inventory: OutletInventory = { root: [], byComponent: {}, byTemplate: {} }
  const OUTLET_RE = /<outlet\s[^>]*name\s*=\s*["']([^"']+)["']/gi
  for (const file of walk(root)) {
    const html = readFileSync(file, 'utf-8')
    const names: string[] = []
    let m: RegExpExecArray | null
    OUTLET_RE.lastIndex = 0
    while ((m = OUTLET_RE.exec(html)) !== null) names.push(m[1])
    if (names.length === 0) continue
    const rel = relative(root, file)
    inventory.byTemplate[rel] = names
    // Pair with a sibling component .ts (class X extends Component) if present
    const sibling = file.replace(/\.html$/, '.ts')
    const cls = existsSync(sibling)
      ? readFileSync(sibling, 'utf-8').match(/class\s+(\w+)\s+extends\s+\w*Component/)?.[1]
      : undefined
    if (cls) inventory.byComponent[cls] = [...(inventory.byComponent[cls] ?? []), ...names]
    else inventory.root.push(...names)
  }
  return inventory
}

// ── bin ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const modulePath = process.argv[2]
  if (!modulePath) {
    Print('FAILURE', 'usage: route-check <routes-module.ts> (module must export `routes` or default)')
    process.exit(2)
  }
  const mod = await import(pathToFileURL(join(process.cwd(), modulePath)).href)
  const routes: RouteMap | undefined = mod.routes ?? mod.default
  if (!routes) {
    Print('FAILURE', `${modulePath} exports neither \`routes\` nor a default RouteMap.`)
    process.exit(2)
  }

  const inventory = scanOutletInventory(process.cwd())
  const errors = checkRoutes(routes, inventory)

  console.log('\n🧭 DiamondJS route-check\n' + '='.repeat(64))
  if (errors.length === 0) {
    Print('SUCCESS', `route-check passed: ${Object.keys(routes).length} top-level route(s), 0 errors.`)
    return
  }
  for (const e of errors) {
    console.log(`\n[${e.rule}]${e.routeId ? ` route '${e.routeId}'` : ''}\n${e.message}`)
  }
  Print('CRITICAL', `route-check FAILED: ${errors.length} error(s).`)
  process.exit(1)
}

if (process.argv[1]?.endsWith('route-check.ts')) {
  void main()
}
