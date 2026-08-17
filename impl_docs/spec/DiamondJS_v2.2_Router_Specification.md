# DiamondJS v2.2 — Router Specification (normative)

**Status:** Ships with v2.2.0, merged alongside the code it governs. Companion to Amendment A3 (which amends the v2.1 spec); this document carries the new-feature normative text: router, guards, Pending, outlets, tooling, meta-rule.
**Authority:** Spec over code. Ambiguities escalate to Joe; implementation agents may not reinterpret.

---

## 1. Meta-rule addition (spec §1): language-first composition

The framework provides **values**; the language provides **control flow**. Nouns for state (`Pending`, `Collection`), single verbs for platform gaps (`hold`, `bind`, `delegate`); JS provides grammar (`await`, `try/finally`, `Promise.all`). Combinators only where the language has no primitive (dependency tracking, `captureScope`).

Corollaries (normative): **no fluent/builder chains in the public API**; **decorating functions are passthrough** — they return what they were given and act by registry side effect (`Pending.until(work, label)` returns `work` itself).

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

Redirects resolve by route ID; chains are followed (route-check catches cycles and unknown targets; the runtime carries a bounded backstop).

## 5. Outlets (closed world)

`<outlet name="x">` compiles as an ordinary element — zero compiler surface. The router discovers declared outlets **at mount time**: root-declared outlets at `start()`, route-declared outlets when their owning component mounts.

Registry shape: `Map<name, { element, ownerRouteId: string | null, active: Component | null }>`; `null` owner = root-declared. Entries whose owner unmounts are deleted with it.

Outlet names are a **statically-declared closed set**. No public dynamic registration. A route may target only a root-declared outlet or one declared by an **ancestor** route's component — build-checked (`unknown-outlet`, `outlet-not-ancestor-owned`, `duplicate-outlet-name`).

`isDiamondTemplate` detects `'<outlet'` (D-18 narrowed): the canonical app shell — static chrome + outlets, zero bindings — is detected and compiled.

## 6. Guards

`abstract class Guard` in the runtime — exactly three static members, **no other members, no hook forest — ever** (rejected alternative, recorded):

- `static check(ctx): boolean | Promise<boolean>` — base returns `false` (**fail closed**). A pure predicate: callable from templates, handlers, socket message handlers — second enforcement points welcome.
- `static deny(ctx): Deny` — base returns `{ path: '/not-found' }` (**conceal by default**). ALL navigation policy lives here.
- `static timeoutMs = 5000`.

`type Deny = { path } | { external: string }`. External = IdP handoff; the **router** executes it (`location.assign`, logged) — Deny is data the router executes, never a guard side effect.

**The envelope** is a private static on `Router` (not an overridable class method — JS cannot seal statics): fail-closed on `check()` throw (`Print('EXCEPTION')` → deny); fail-closed on timeout (`Print('FAILURE')` → deny); **one structured narration line per decision** (guard class, route id, outcome, reason, duration); result normalization (`false` → `this.deny(ctx)`).

`GuardContext` v2.2: `{ to, from, params, routeId }` — flat, everything real. Capability namespaces (`ctx.policy`, `ctx.security`, `ctx.tenant`, …) are the named v3 growth path; **no stubs ship** (D-16 lesson).

**Composition:** `guard: GuardClass | GuardClass[]`, chain order, first non-true wins; parent guards cover subtrees, evaluated once per navigation into the subtree.

**Denial semantics by vector:** pushState nav → clean abort (nothing happened; the denied URL never enters history; the deny target is then resolved as its own navigation). Initial load / popstate → resolve the deny as a redirect via `replaceState` (no lingering denied entry). Guidance: auth/permission guards return a `Location`, not bare `false`.

**Principle (normative): client guards predict; servers enforce.** Client guards are UX and telemetry, never the security authority; enforcement lives at the API until Diamond 3.0's server side, after which the same vocabulary runs both sides with asymmetric authority.

**Reserved v3 vocabulary (specified, not shipped):** a `challenge` decision (v2.2 idiom: redirect to a challenge surface with `returnTo`); structured deny reasons (slot into narration now as strings); envelope boundary events beyond navigation (`kind: 'navigation' | 'message'` — socket-borne authorization through the same machinery); fingerprint-as-evidence-never-identity.

**Batteries (tier 2, `@diamondjs/guards`):** converters are the data batteries; guards are the policy batteries. Abstract mid-classes configured at the app tier via static fields (`class CorpusSSO extends OAuthGuard { static issuer = … }`). Which families ship in 2.2.0 is gated on the route sketches' guard-family inventory; candidates recorded: `OAuthGuard`, `WebAuthnGuard`, `CapabilityGuard`, `TenantGuard`. Per-route parameterization (`{use, state}`) deferred.

## 7. Pending (departure-safety semaphore)

`class Pending`: `static hold(label): () => void` (refcounted, idempotent release); `static until<T>(work, label): Promise<T>` (**passthrough** — returns the same promise; hold releases on settle); `static get active(): boolean`; `static labels(): readonly string[]`.

`active`/`labels` are **reactive** (one micro-proxy version signal, the Collection pattern) — `if="!Pending.active"` works; the departure warning and save-indicator UI read one counter and cannot disagree.

The `beforeunload` handler is installed only while the count > 0 and removed at zero — **a persistent handler disables bfcache; this conditionality is correctness, not economy**. Browsers show generic dialog text; labels are for logs/UI only.

In-app pushState navs: phase-1 check — `Pending.active` → `window.confirm`, abort cleanly on decline. **Known gap, documented:** SPA Back (popstate) is not intercepted (the deferred canLeave problem); departure with active holds narrates `Print('WARNING', 'departure with active holds: <labels>')`. Holds are not cancellation; in-flight promises run to completion.

Every acquire/release narrates via `Print('STATE', …)`.

## 8. Links & startup

**Link pattern (spec §6.3 is the verbatim authority):** static `href` attribute + click interceptor — same-origin, primary button, no modifier keys → `preventDefault` + `navigate()`. Middle-click, modifier clicks, and external hrefs pass through untouched. (Static `href` gates like any static attribute; the interceptor pattern guarantees zero new baseline entries.)

**Startup route table:** `__DIAMOND_DEV__`-gated, one `Print('STATE', …)` **per route row** — line-oriented (greppable; survives wsSink). Columns: id, resolved full path, outlet, params, guard classes, redirect target. Tree flattened with indentation. Absent in prod.

**Socket lifetime idiom (example, not feature):** open in `mount()`, `registerCleanup(() => socket.close())`; deferred-close via `Pending.until(flush).then(() => socket.close())` inside a cleanup. Transports request navigation through `router.navigate()` only (sole-history-writer). Boundary events beyond navigation are reserved v3 vocabulary (§6).

## 9. Exports (spec §11)

From `@diamondjs/runtime`'s single entry point, no subpaths: `Router`, `Guard`, `Pending`, and types `RouteMap`, `RouteDefinition`, `RouteId`, `GuardContext`, `Deny`.

## 10. Tooling: route-check

Standalone bin (stink-check posture), ships in the `dev` meta-package. **Errors speak route IDs.** Rules, each with pass+fail fixtures: `invalid-route-id`, `duplicate-route-id` (global, flattened), `unknown-outlet`, `outlet-not-ancestor-owned`, `duplicate-outlet-name`, `param-missing-converter`, `redirect-cycle`, `unknown-redirect-target`, `wildcard-not-terminal`, `ambiguous-routes`, `guard-check-not-overridden` (base `check` in use is almost certainly a mistake; the runtime fail-closed remains the backstop).

## 11. Meta-packages

`@diamondjs/app` = runtime + converters + primafacie + guards. `@diamondjs/dev` = compiler + parcel transformer + tool bins (stink-check, route-check). `@diamondjs/all` = union. **Exact-pin lockstep** at the release version — one tested constellation, never a range. CI check: `npm run check-meta`.

## 12. run_mode / `__DIAMOND_DEV__`

The Parcel transformer reads `<projectRoot>/app/config/config.json` → `app.settings.run_mode` (`"dev" | "prod"`) once per build. Dev/prod is a **build-time property**; flipping requires a rebuild. Fail-closed defaults: absent file or absent key → `prod`. Malformed JSON that exists but cannot parse → **build error**, never a silent prod default. Compiled template modules receive `const __DIAMOND_DEV__ = <bool>` and mirror it onto `globalThis` for the runtime's dev-gated surfaces.

## 13. Normative reference route map

> **PENDING (open input #1, tracked in the Implementation Work Order):** the normative reference route map — a realistic application route tree in keyed-object form, to be supplied verbatim by Joe — is inserted here when it arrives. It gates the work order's Phase 4 item 3 (recognition-table tests must exercise real supplied trees, not only reference cases) and the `@diamondjs/guards` first-battery selection. DiamondJS itself remains agnostic of any consuming project; the supplied map serves purely as a validation fixture and worked example. Until then, the implementation's reference recognition cases (depth-3 nesting, static-vs-param, converter parse-fail fall-through, redirect chains, terminal wildcard) live in `packages/runtime/tests/router.test.ts`.

> **PENDING (open input #2):** base-path/subdirectory deployment — one-line yes/no from Joe. If any fleet app deploys off domain root, `basePath` joins the router config now (cheap) rather than later (annoying).

## Appendix A — route-table line format

```
STATE: <ts> - <caller> - ~~~ route table: id | path | outlet | params | guards | redirect ~~~
STATE: <ts> - <caller> - ~~~ home | / | main | - | - | - ~~~
STATE: <ts> - <caller> - ~~~ workspace | /w | main | - | ExampleSSO | - ~~~
STATE: <ts> - <caller> - ~~~   item-detail | /w/items/:id | workspace-body | id:IntConverter | - | - ~~~
STATE: <ts> - <caller> - ~~~ legacy-home | /old | → redirect 'home' ~~~
```

## Appendix B — rejected alternatives (recorded so they stay dead)

Array RouteMap; declaration-order matching; `ComponentOutlet` wrapper class; scoped outlet addressing (`{outlet, owner}`); route-kind enums (`page|modal|toast`); bare guard functions; `dependencies` as a guard field name; guard lifecycle hook forest; `SecurityParticipant` ancestor class; overridable `run()` as the envelope; fluent/builder chains and any `Close()`-style unified teardown verb; URL-as-collaboration-state; hybrid branch cache; runtime-only outlet validation; dynamic outlet registration; guards skipping popstate/initial-load.

## Appendix C — deferred (recorded)

`canLeave` with popstate veto semantics (history stamping ships now as forward-compat); keep-alive/route caching; stacked overlay routing; transitions; data resolvers; scroll restoration; compiler-lowered `<outlet>`; template component composition (**v2.3.0**, D-21 pointer, own DDR conversation); `ctx.state` request-scoped store; parameterized guards; the `challenge` decision type; `Print` caller-name compiler memoization; mount-outside-captureScope dev warning (primafacie backlog); attribute-interpolation support (diagnosed in 2.1.1); base-path (pending Joe's one-liner).
