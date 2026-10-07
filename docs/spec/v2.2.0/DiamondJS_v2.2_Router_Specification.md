# DiamondJS v2.2 — Router Specification (normative)

**Status:** Ships with v2.2.0, merged alongside the code it governs. Companion to Amendment A3 (which amends the v2.1 spec); this document carries the new-feature normative text: router, guards, Pending, outlets, tooling, meta-rule.
**Authority:** Spec over code. Ambiguities escalate to Joe; implementation agents may not reinterpret.

---

## 1. Meta-rule addition (spec §1): language-first composition

The framework provides **values**; the language provides **control flow**. Nouns for state (`Pending`, `Collection`), single verbs for platform gaps (`hold`, `bind`, `delegate`); JS provides grammar (`await`, `try/finally`, `Promise.all`). Combinators only where the language has no primitive (dependency tracking, `captureScope`).

Corollaries (normative): **no fluent/builder chains in the public API**; **decorating functions are passthrough** — they return what they were given and act by registry side effect (`Pending.until(work, label)` returns `work` itself).

**Explicit discriminants (v2.2.1):** explicit discriminants in authored data; shape-inference only for uncontrolled input. When a field in a spec-governed structure grows a taxonomy, promote it to a tagged union. Canonical example: `Destination` (§5) — the string dual-form was designed, then rejected when `site-path` proved shape-indistinguishable from `route-path`.

## 2. The pipeline (normative order)

Every navigation, on **every** vector (pushState nav, initial load, popstate), runs:

1. **Trigger** — the navigation gets a monotonic ID.
2. **Recognize** — specificity match + converter param parsing. A failed `ParseResult` **is** a failed match and falls through toward `not-found`.
3. **Plan** — `Map<outletName, matchedRoute>` from the matched chain.
4. **Guard phase** — all guards, chain order (parent first), across the whole plan, awaited to completion **before anything mounts or constructs**.
5. **Race check** — nav ID still current, else discard silently.
6. **History write** — `pushState`, stamped `{ diamondNavId, index }` (also stamped on `replaceState`) — canLeave forward-compatibility.
7. **Commit** — diff vs. occupancy; unmount outgoing **deepest-first**, mount incoming **parent-first**, synchronous. Mount failure (constructor or mount throw) leaves the previous route intact — defined behavior, tested.
8. **Settle** — per-nav `Print('STATE', 'nav → <path> [outlets]')`, on by default; `configure()` quiets.

**Transaction model:** the plan commits atomically or not at all. Any guard denial anywhere in a multi-outlet plan means **zero DOM mutation anywhere**. Construction precedes unmounting (a constructor throw aborts with the old route untouched); a mount throw rolls the DOM back and restores the URL. `pushState` never fires for a rejected navigation.

The Router is the **sole history writer**. Transports and app code request navigation via `router.navigate()`, never touch `history`.

## 3. RouteMap (keyed-object form, normative)

```ts
type RouteMap = Record<RouteId, RouteDefinition>
type RouteDefinition =
  | { path, redirect }
  | { path, component, outlet, params?, query?, guard?, children? }
// children is recursively a RouteMap
```

**Route IDs** are quoted lowercase kebab-case string-literal keys with a leading letter — `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. Integer-like keys are structurally excluded so object order never lies. Enforcement: `satisfies RouteMap` in-editor; `route-check` enforces the full grammar with the canonical message:

```
Invalid route ID `querySettings`.
Route IDs must be quoted lowercase kebab-case strings.
Use:
  'query-settings': { ... }
```

**Rejected key forms (negative cases):** unquoted keys, computed `[expr]` keys, uppercase, snake_case.

**`params`:** `{ paramName: ConverterClass }` — required for every `:segment` (by type where expressible, by route-check always). Same `ParseResult` contract as `from-view`. **Divergent policy, stated:** forms keep-last-good; the router **fails the match**.

**Params are constructor constants:** `new RouteComponent(params)`. A param change is unmount + remount, always. Conformance note: route components may accept a single params object in their constructor (§4.2's no-arg form is the default, not a prohibition).

## 4. Matching: specificity, never declaration order

Segment-wise, left-to-right: **static > `:param` > pattern-exhausted > `*`**. `*` matches last regardless of its declaration position and must be terminal (route-check `wildcard-not-terminal`). Equal specificity over the same URL shape is a **build error** (`ambiguous-routes`), never a positional tiebreak — reordering route blocks never changes behavior.

URL normalization: matching is **path-only**; trailing-slash-insensitive; static segments **case-sensitive**; query params never participate in matching. An optional per-route `query` converter map parses declared query params through `ParseResult` (invalid fails the match); undeclared query params pass through raw as an app concern.

Path strings are position-relative; a leading slash is cosmetic (`'/corpora'` ≡ `'corpora'` at any nesting level) — pinned by test.

Redirects are Destinations — see §5, which governs redirects **and** guard denials with one vocabulary.

## 5. Destinations (v2.2.1 — governs redirects AND guard denials)

Redirects and guard denials are the same semantic — "go here instead" — and speak the same type. **The** destination vocabulary for the whole framework:

```typescript
/** [Diamond] A navigation destination. Used by route `redirect` and by
 *  Guard.deny(). Three concentric circles:
 *    route-*      → inside the router's map (by ID or by path spelling)
 *    site-path    → this origin, beyond the SPA (hard load)
 *    external-url → off origin entirely (hard load)
 */
export type Destination =
  | { type: 'route-id';     target: RouteId;            query?: QueryParams }
  | { type: 'route-path';   target: `/${string}`;       query?: QueryParams }
  | { type: 'site-path';    target: `/${string}` }
  | { type: 'external-url'; target: `https://${string}` };
```

**There is no classifier.** The arm is declared, never inferred: a same-origin hard load into a non-SPA system (`/support/wiki` served by a wiki, not the router) is **shape-identical** to an internal route path — no string classifier can distinguish them. The tag is the only correct design once this arm exists. Design-for-the-mean: an explicit `type` field is unmistakable to any reader, human or small model; shape-sniffing is inference, tags are declaration. Validation checks arm/target agreement; it never infers the arm.

The template-literal target types are deliberate: the editor squiggles arm/target disagreement (`type: 'external-url', target: 'http://…'`) before route-check runs. `query` exists only on the `route-*` arms (this is where a login guard's `returnTo` rides).

**Canonical examples (normative form — ordinary TS quoting):**

```typescript
'root-redirect': {
  path: '/',
  redirect: { type: 'route-id', target: 'corpus-list' },
},

'legacy-corpus': {
  path: '/c/:corpusId',
  redirect: { type: 'route-path', target: '/corpora/:corpusId' },  // params carry through
},

'support': {
  path: '/support',
  redirect: { type: 'site-path', target: '/support/wiki' },  // same origin, different system, hard load
},

'archive': {
  path: '/archive',
  redirect: { type: 'external-url', target: 'https://archive.org/details/diamondjs' },
},
```

**Execution semantics** — one `switch` on `destination.type`, used by **both** redirect resolution and guard-denial resolution; no second executor:

- **`route-id`** — resolve ID → route → its path (matched params pass by name where the target path needs them); continue the navigation pipeline internally (no hard load). Participates in the normal pushState/replaceState rules (denials on initial/popstate use `replaceState`).
- **`route-path`** — template `:param` substitution from the matched params, then internal navigation as above.
- **`site-path`** — hard departure on our origin: `Print('STATE', …)` narration, then `location.assign(target)`. **No `pushState`** — we are leaving the SPA; writing SPA history first breaks the Back button.
- **`external-url`** — identical hard-departure path as `site-path`, off origin.

**Static-only rail (outer arms):** `:param` in a `site-path` or `external-url` target is a build error (`static-target-has-params`) — an open-redirect rail; the receiving system's URL semantics are not the router's to vouch for. `route-path` params remain legal.

**route-check rules:** `unknown-redirect-target` (`route-id` not in the flattened map, with a route-path did-you-mean when the `/`-form matches), `unresolvable-route-path`, `site-path-shadows-route` (mirror-image: the target **does** match an SPA route — mislabeling that hard-reloads where SPA navigation was intended), `external-redirect-invalid` (non-`https://`: covers `http:`, `mailto:`, `javascript:`, protocol-relative), `static-target-has-params`, `redirect-cycle` (across **both** internal arms; `site-path`/`external-url` terminate the graph by definition), plus `destination-arm-mismatch` (cross-arm did-you-means: `route IDs never start with '/'` / `paths never carry a scheme`).

## 6. Outlets (closed world)

`<outlet name="x">` compiles as an ordinary element — zero compiler surface. The router discovers declared outlets **at mount time**: root-declared outlets at `start()`, route-declared outlets when their owning component mounts.

Registry shape: `Map<name, { element, ownerRouteId: string | null, active: Component | null }>`; `null` owner = root-declared. Entries whose owner unmounts are deleted with it.

Outlet names are a **statically-declared closed set**. No public dynamic registration. A route may target only a root-declared outlet or one declared by an **ancestor** route's component — build-checked (`unknown-outlet`, `outlet-not-ancestor-owned`, `duplicate-outlet-name`).

`isDiamondTemplate` detects `'<outlet'` (D-18 narrowed): the canonical app shell — static chrome + outlets, zero bindings — is detected and compiled.

## 7. Guards

`abstract class Guard` in the runtime — exactly three static members, **no other members, no hook forest — ever** (rejected alternative, recorded):

- `static check(ctx): boolean | Promise<boolean>` — base returns `false` (**fail closed**). A pure predicate: callable from templates, handlers, socket message handlers — second enforcement points welcome.
- `static deny(ctx): Destination` — base returns `{ type: 'route-id', target: 'not-found' }` (**conceal by default**). ALL navigation policy lives here.
- `static timeoutMs = 5000`.

**`Deny` is retired before it ever shipped (v2.2.1):** `deny` returns a `Destination` (§5) — data the router executes through the same single executor redirects use, never a guard side effect. Guards get `site-path` and `external-url` denials for free: the OAuth IdP handoff is `{ type: 'external-url', target: authorizeUrl(…) }`.

**The envelope** is a private static on `Router` (not an overridable class method — JS cannot seal statics): fail-closed on `check()` throw (`Print('EXCEPTION')` → deny); fail-closed on timeout (`Print('FAILURE')` → deny); **one structured narration line per decision** (guard class, route id, outcome, reason, duration); result normalization (`false` → `this.deny(ctx)`).

`GuardContext` v2.2: `{ to, from, params, routeId }` — flat, everything real. Capability namespaces (`ctx.policy`, `ctx.security`, `ctx.tenant`, …) are the named v3 growth path; **no stubs ship** (D-16 lesson).

**Composition:** `guard: GuardClass | GuardClass[]`, chain order, first non-true wins; parent guards cover subtrees, evaluated once per navigation into the subtree.

**Denial semantics by vector:** pushState nav → clean abort (nothing happened; the denied URL never enters history; the deny target is then resolved as its own navigation). Initial load / popstate → resolve the deny as a redirect via `replaceState` (no lingering denied entry). Guidance: auth/permission guards return a route-arm `Destination` (with `query: { returnTo }` where appropriate), not bare `false`.

**Principle (normative): client guards predict; servers enforce.** Client guards are UX and telemetry, never the security authority; enforcement lives at the API until Diamond 3.0's server side, after which the same vocabulary runs both sides with asymmetric authority.

**Reserved v3 vocabulary (specified, not shipped):** a `challenge` decision (v2.2 idiom: redirect to a challenge surface with `returnTo`); structured deny reasons (slot into narration now as strings); envelope boundary events beyond navigation (`kind: 'navigation' | 'message'` — socket-borne authorization through the same machinery); fingerprint-as-evidence-never-identity.

**Batteries (tier 2, `@diamondjs/guards`):** converters are the data batteries; guards are the policy batteries. Abstract mid-classes configured at the app tier via static fields (`class ExampleSSO extends OAuthGuard { static issuer = … }`). **2.2.0 resolution:** the project sketches were withdrawn in favor of ideation fixtures, so no battery family had a confirmed real-world inventory — the package ships as a scaffold with zero mid-classes (no stubs, D-16 lesson); candidates recorded: `OAuthGuard`, `WebAuthnGuard`, `CapabilityGuard`, `TenantGuard`. First batteries land in a 2.2.x once the first consuming app's guard inventory exists. Per-route parameterization (`{use, state}`) deferred.

## 8. Pending (departure-safety semaphore)

`class Pending`: `static hold(label): () => void` (refcounted, idempotent release); `static until<T>(work, label): Promise<T>` (**passthrough** — returns the same promise; hold releases on settle); `static get active(): boolean`; `static labels(): readonly string[]`.

`active`/`labels` are **reactive** (one micro-proxy version signal, the Collection pattern) — `if="!Pending.active"` works; the departure warning and save-indicator UI read one counter and cannot disagree.

The `beforeunload` handler is installed only while the count > 0 and removed at zero — **a persistent handler disables bfcache; this conditionality is correctness, not economy**. Browsers show generic dialog text; labels are for logs/UI only.

In-app pushState navs: phase-1 check — `Pending.active` → `window.confirm`, abort cleanly on decline. **Known gap, documented:** SPA Back (popstate) is not intercepted (the deferred canLeave problem); departure with active holds narrates `Print('WARNING', 'departure with active holds: <labels>')`. Holds are not cancellation; in-flight promises run to completion.

Every acquire/release narrates via `Print('STATE', …)`.

## 9. Links & startup

**Link pattern (spec §6.3 is the verbatim authority):** static `href` attribute + click interceptor — same-origin, primary button, no modifier keys → `preventDefault` + `navigate()`. Middle-click, modifier clicks, and external hrefs pass through untouched. (Static `href` gates like any static attribute; the interceptor pattern guarantees zero new baseline entries.)

**Startup route table:** `__DIAMOND_DEV__`-gated, one `Print('STATE', …)` **per route row** — line-oriented (greppable; survives wsSink). Columns: id, resolved full path, outlet, params, guard classes, redirect target. Tree flattened with indentation. Absent in prod.

**Socket lifetime idiom (example, not feature):** open in `mount()`, `registerCleanup(() => socket.close())`; deferred-close via `Pending.until(flush).then(() => socket.close())` inside a cleanup. Transports request navigation through `router.navigate()` only (sole-history-writer). Boundary events beyond navigation are reserved v3 vocabulary (§7).

## 10. Exports (spec §11)

From `@diamondjs/runtime`'s single entry point, no subpaths: `Router`, `Guard`, `Pending`, and types `RouteMap`, `RouteDefinition`, `RouteId`, `GuardContext`, `Deny`.

## 11. Tooling: route-check

Standalone bin (stink-check posture), ships in the `dev` meta-package. **Errors speak route IDs.** Rules, each with pass+fail fixtures: `invalid-route-id`, `duplicate-route-id` (global, flattened), `unknown-outlet`, `outlet-not-ancestor-owned`, `duplicate-outlet-name`, `param-missing-converter`, `redirect-cycle`, `unknown-redirect-target`, `wildcard-not-terminal`, `ambiguous-routes`, `guard-check-not-overridden` (base `check` in use is almost certainly a mistake; the runtime fail-closed remains the backstop).

## 12. Meta-packages

`@diamondjs/app` = runtime + converters + primafacie + guards. `@diamondjs/dev` = compiler + parcel transformer + tool bins (stink-check, route-check). `@diamondjs/all` = union. **Exact-pin lockstep** at the release version — one tested constellation, never a range. CI check: `npm run check-meta`.

## 13. run_mode / `__DIAMOND_DEV__`

The Parcel transformer reads `<projectRoot>/app/config/config.json` → `app.settings.run_mode` (`"dev" | "prod"`) once per build. Dev/prod is a **build-time property**; flipping requires a rebuild. Fail-closed defaults: absent file or absent key → `prod`. Malformed JSON that exists but cannot parse → **build error**, never a silent prod default. Compiled template modules receive `const __DIAMOND_DEV__ = <bool>` and mirror it onto `globalThis` for the runtime's dev-gated surfaces.

## 14. Normative reference route map (open input #1 — RESOLVED, ideation mode)

Joe's original project route sketches were withdrawn in favor of **ideation-mode fixtures** (ratified): a hypothetical, project-agnostic application — **"Conveyor", a generic ingest-pipeline app** — whose tree exercises every structural shape the grammar offers: single child, multiple sibling children alternating in one outlet, children nested inside children (depth 3), static-beats-param specificity, converter parse-fail fall-through, a two-hop redirect chain, guard chains with subtree coverage, and a terminal wildcard. This map is the normative worked example; `packages/runtime/tests/router-reference-map.test.ts` exercises it verbatim, including the all-vectors leak-free exit criterion.

```ts
const routes = {
  home: { path: '', component: HomePage, outlet: 'main' },

  // redirect chain across both internal arms:
  // legacy-dashboard (route-path) → dashboard (route-id) → home
  dashboard: { path: 'dashboard', redirect: { type: 'route-id', target: 'home' } },
  'legacy-dashboard': {
    path: 'legacy/dashboard',
    redirect: { type: 'route-path', target: '/dashboard' },
  },

  // single child
  sources: {
    path: 'sources',
    component: SourcesShell,        // template declares <outlet name="source-body">
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
    component: PipelineShell,       // template declares <outlet name="pipeline-body">
    outlet: 'main',
    guard: OperatorGuard,           // parent guard covers the subtree
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
          // deep child targeting a ROOT-declared outlet ('panel'): a
          // URL-addressable inspector — multi-outlet plan from one URL
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
    component: AdminShell,          // template declares <outlet name="admin-body">
    outlet: 'main',
    guard: [OperatorGuard, AdminGuard],  // chain order, first non-true wins
    children: {
      tenants: {
        path: 'tenants',
        component: TenantShell,     // template declares <outlet name="tenant-body">
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
```

Normative behaviors this tree pins down: `/pipeline/runs/latest` beats `/pipeline/runs/:runId` (static beats param, regardless of declaration order); `/pipeline/runs/oops` fails `IntConverter` and falls through to `not-found`; `/legacy/dashboard` resolves through two redirect hops spanning both internal Destination arms (`route-path` → `route-id`) to `home`; navigating between `pipeline` siblings never remounts `PipelineShell` (**occupancy diffs on the params each route's own resolved path consumes** — a child-only param change never remounts the parent); `/pipeline/runs/1042/notes/7` mounts a multi-outlet plan from one URL — `main` + `pipeline-body` + the root-declared `panel` (root outlets are always a legal target, even for deep children); `OperatorGuard` is evaluated once per navigation into the subtree; `[OperatorGuard, AdminGuard]` runs in declared chain order. `IntConverter` and `SlugConverter` ship in `@diamondjs/converters` as of v2.2.1.

## 15. basePath (open input #2 — RESOLVED: yes, both deployments)

`new Router(routes, { basePath })`. Deployments at the domain root omit it (default `''`). An app served from a folder one-or-N levels deep sets `basePath` to the **public prefix as the browser sees it** — e.g. `'/tools/reports'`.

Normative rules:
- App code, RouteMap `path`s, guards, and `navigate()` always speak **app-relative** paths. The router strips/prepends the prefix only at its edges: location reads, history writes, link interception.
- The link interceptor claims only same-origin URLs **under** `basePath`; a sibling app one folder over passes through untouched.
- **Reverse proxies:** `basePath` must equal the prefix in the browser's address bar, not the origin server's filesystem path. If an upstream proxy rewrites paths (public `/app/x` → origin `/x`), configure the PUBLIC prefix. The router narrates a `WARNING` whenever the live location falls outside `basePath` — the misconfiguration tripwire for unreflected proxy rewrites.
- Asset URLs are the bundler's concern (Parcel `--public-url`), not the router's.

## Appendix A — route-table line format

```
STATE: <ts> - <caller> - ~~~ route table: id | path | outlet | params | guards | redirect ~~~
STATE: <ts> - <caller> - ~~~ home | / | main | - | - | - ~~~
STATE: <ts> - <caller> - ~~~ workspace | /w | main | - | ExampleSSO | - ~~~
STATE: <ts> - <caller> - ~~~   item-detail | /w/items/:id | workspace-body | id:IntConverter | - | - ~~~
STATE: <ts> - <caller> - ~~~ legacy-home | /old | → redirect 'home' ~~~
```

## Appendix B — rejected alternatives (recorded so they stay dead)

Array RouteMap; declaration-order matching; `ComponentOutlet` wrapper class; scoped outlet addressing (`{outlet, owner}`); route-kind enums (`page|modal|toast`); bare guard functions; `dependencies` as a guard field name; guard lifecycle hook forest; `SecurityParticipant` ancestor class; overridable `run()` as the envelope; fluent/builder chains and any `Close()`-style unified teardown verb; URL-as-collaboration-state; hybrid branch cache; runtime-only outlet validation; dynamic outlet registration; guards skipping popstate/initial-load; **bare-string redirect sugar** (two spellings is two grammars — the tag is always present); **shape-inferred destination classification** (the string dual-form was designed, then rejected when `site-path` proved shape-indistinguishable from `route-path` — superseded by explicit tags).

## Appendix C — deferred (recorded)

`canLeave` with popstate veto semantics (history stamping ships now as forward-compat); keep-alive/route caching; stacked overlay routing; transitions; data resolvers; scroll restoration; compiler-lowered `<outlet>`; template component composition (**v2.3.0**, D-21 pointer, own DDR conversation); `ctx.state` request-scoped store; parameterized guards; the `challenge` decision type; `Print` caller-name compiler memoization; mount-outside-captureScope dev warning (primafacie backlog); attribute-interpolation support (diagnosed in 2.1.1); guards battery mid-classes (scaffolded; first families land with the first consuming app's guard inventory). ~~base-path~~ — **shipped in 2.2.0** (§15).
