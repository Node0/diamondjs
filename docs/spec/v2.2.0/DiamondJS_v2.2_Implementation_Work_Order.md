# DiamondJS — Implementation Work Order: v2.1.1 → v2.2.0

**Status:** Signed for implementation · **Base:** Architecture Specification v2.1 (`00db3c6`)
**Authority:** This document is keyed to spec section numbers and §16 defect IDs. The spec is authoritative over code; where this order amends the spec, the amendment text (A3) ships in the same release as the code it governs. Implementation agents may not reinterpret; ambiguities escalate to Joe.

**Release sequence:** `v2.1.1` (conformance patch — defect fixes only) → `v2.2.0` (logging consolidation, run_mode, router, guards, Pending, tooling, meta-packages).

**Open inputs (do not block start; block Phase 4 close):**
1. Crystallizer + Neuron route sketches — gate the Phase 4 recognition-table tests and the `@diamondjs/guards` first-battery selection.
2. Base-path/subdirectory deployment: one-line yes/no from Joe. If any fleet app deploys off domain root, add `basePath` to router config now (cheap) rather than later (annoying).

---

## RELEASE 1 — v2.1.1 (conformance patch)

Every item is a §16 **fix-the-code** disposition or its recorded correction. No new features. Suite must be green at tag time, including the currently-red disposal probe.

### 1.1 — D-1: `if`/`switch` dispose-on-detach
- In `core.ts` `if()` and `switch()`: on branch change, call the outgoing branch's captured `cleanup()` eagerly (match `repeat`'s `gone.cleanup()` pattern), drop the cached node, rebuild on re-activation. The branch cache is **removed**, not hybridized (rejected alternative: keep-node/dispose-effects hybrid — a third disposal semantic).
- Resulting invariant, spec-wide: **detached means disposed.** One disposal rule across all three structural directives.
- Lazy build stays; only the cache goes.
- Commit `packages/runtime/tests/detached-branch-disposal.test.ts` as-is; its three assertions are the acceptance criteria and go green with this fix.
- Update doc comments in `if()`/`switch()` and correct `working_notes.md:87/:92` (+ `deferred_work:73`) in the same commit — no artifact may still claim the cache exists.

### 1.2 — D-7: scheduler disposed-effect guard (highest severity)
- Mechanism per §16: an effect queued before `unmount()` flushes after it and **re-arms tracking**, re-inserting the disposed effect into dependency sets — permanent retention of the component + detached DOM.
- Fix: a `disposed` flag on the effect record; the scheduler flush skips (and drops) disposed effects; effect cleanup sets the flag. Dequeue-on-dispose is acceptable alternative; flag is simpler.
- New test: mutate a reactive property and `unmount()` in the same synchronous tick; assert post-flush that the effect is not re-subscribed (dependency-set size) and fires zero times on subsequent mutations.

### 1.3 — D-2: `repeat` duplicate primitive items
- Reconciliation keys on raw item; duplicate primitives collapse to one slot → phantom rows accumulate, orphaned effects.
- Fix: key on identity + occurrence index for primitives (identity alone for objects). Test: repeated strings across updates — row count exact, full cleanup on removal/clear.

### 1.4 — D-3: attribute interpolation diagnostic
- `<div title="Hello ${name}">` currently compiles the literal silently. Emit `error`-severity `attr-interpolation-unsupported` suggesting `title.to-view="'Hello ' + name"`. Diagnose now; support is a future decision.

### 1.5 — D-10: gate static attributes
- `staticAttrs` emission passes through `gateSink` for `on*` and off-list names: `stink:warn` undeclared, consistent with bound writes. Literal safe attrs (class, id, on-list) unchanged. Test: `<div onclick="alert(1)">` produces `stink:warn`; baseline diff behavior verified.

### 1.6 — D-8: stink-check routes on severity, not code prefix
- `switch-static-dead` (and any future non-`stink:` warn) must not slip the gate. Route on `severity` field.

### 1.7 — D-9 + measurement: budget tool
- Fail **closed** on `cloc` resolution error (nonzero exit, red output).
- Count production LOC only (`src` excluding `__tests__`); report test LOC as a separate informational column. This dissolves the false parcel `300/300 WARN` (production is 111/300). No ceiling changes anywhere.

### 1.8 — D-6: double-mount guard
- `mounted` boolean on `Component`; second `mount()` without `unmount()` throws with a clear message. §16 record updated from "scope leak" to "DOM-node leak," now guarded.

### 1.9 — D-5: export `TemplateImport` from compiler index (one line).

### 1.10 — D-12: RAW banner reword
- Banner must describe mechanism, not assert completed audit. Replace with: `raw sink — explicit opt-in (developer-owned, unescaped); recorded for stink-baseline review, no runtime XSS protection here`.

### 1.11 — D-15 / D-20: test strengthening
- Compiler-side allowlist invariant test upgraded to the runtime test's normative form (`map[lowercase(sink)] === sink`).
- Dedicated fail-closed tests for `srcset`, `action`, `formAction`, `cssText`.

### 1.12 — D-21: record + hyphen fix
- §16 gains D-21: §4.5 "props down" described unshipped machinery (v1.5.1 text carried forward). §4.5 rewritten as design-intent-not-shipped, forward pointer to v2.3 component composition.
- `nextVar` sanitizes identifiers (hyphens → underscores): `el_child_component_0` is valid JS.
- New diagnostic: hyphenated tag whose PascalCase form is imported in the component module → `error` `component-composition-unsupported` (points at v2.3). Hyphenated tag with no matching import → valid passthrough as a plain custom element (existing sink gating applies).

**v2.1.1 exit criteria:** full suite green including the disposal probe; `grep`-clean for the corrected working_notes claims; version 2.1.1 across all six packages.

---

## RELEASE 2 — v2.2.0

### Phase 1 — Logging consolidation (one vocabulary)

**Amends spec §15, §12.5, §6.6. Overturns A2 §94 (rationale: the no-dependency rule assumed primafacie was tooling; its reclassification as production infrastructure — it ships in `@diamondjs/app` and stink tagging must be visible in normal operation — removed the premise. The format-only copy was itself drift liability.)**

- Delete `packages/runtime/src/dev-log.ts`. Both call sites (`core.ts` spread unsafe-key, `reactivity.ts` inbound smell) import `Print` from `@diamondjs/primafacie` and emit `Print('WARNING', ...)`.
- Remove the call-site `IS_DEV` guards: these are **stink signals, prod-visible by design**. Warn-once-per-key dedup is retained (it lives at the call sites and stays).
- Runtime gains a dependency on `@diamondjs/primafacie` (browser-safe core only; Node transports stay behind `./node`). Acyclic; build order: primafacie → runtime.
- `primafacie` changes:
  - `WsLogMessage` gains `plain`; `wsSink` sends it (the line is formatted exactly once, in the browser).
  - `wsReceiver(sink: LogSink): (msg: WsLogMessage) => void` added to `./node` — framework-agnostic message handler; **silent** (no server console echo; the browser already printed it).
  - `fileSink(dir, { datestamped?: boolean })` — `access-YYYY-MM-DD.log` rolling by date-in-filename, per-append string compare, no rotation daemon. Default off (current behavior).
  - Fix dead `enableDebug` initializer (`(A || B) || true` is always true; make the env vars actually gate, default remains on).
- The three-channel taxonomy is preserved: compiler `Diagnostic[]` remains pure data (compiler prints nothing); runtime warnings are `Print` calls, not Diagnostics.
- Tests: WS round-trip byte-identical (`WsLogMessage.plain` → file line === browser line); datestamp rollover via injected clock; sink-throw containment; **format-drift tripwire** asserting the two runtime warnings match primafacie's line shape.
- Constraint (spec sentence): `Print` never lands in a hot reactive path (per-call stack capture). The compiler-injected caller-name memoization is a recorded deferred item.

**Exit:** `grep -r devWarn` returns nothing; one logging vocabulary repo-wide.

### Phase 2 — `run_mode` / `__DIAMOND_DEV__`

- Parcel transformer reads `<repo_root>/app/config/config.json` → `app.settings.run_mode` (`"dev"` | `"prod"`), resolved against the Parcel project root, **once per build**.
- Injects compile-time constant `__DIAMOND_DEV__` (true iff `"dev"`). Dev/prod is a **build-time property**; flipping requires rebuild (spec-stated).
- Fail-closed defaults: absent file or absent key → `prod`. Malformed JSON that exists but can't parse → **build error**, never a silent prod default.
- Fits current parcel budget after 1.7's measurement fix (~111 + ~20 → ~131/300). No ceiling decision.
- Tests: present/absent/malformed → constant/prod/build-error respectively.

### Phase 3 — Router core

One file: `packages/runtime/src/router.ts`, structured as the pipeline so the code reads as the diagram. Budget: ~300–350 LOC router + ~55 Guard + ~30 Pending against 1,637 runtime headroom.

**3.1 — Pipeline (normative order):**
1. **Trigger** — navigation gets a monotonic ID.
2. **Recognize** — specificity match + converter param parsing. Failed `ParseResult` = failed match, falls through toward `not-found`.
3. **Plan** — `Map<outletName, matchedRoute>` from the chain.
4. **Guard phase** — all guards, chain order (parent first), across the whole plan, awaited to completion **before anything mounts or constructs**. Runs on **every** vector: pushState navs, initial load, popstate.
5. **Race check** — nav ID still current, else discard silently.
6. **History write** — `pushState`, stamped with `{ diamondNavId, index }` (also on `replaceState`) — canLeave forward-compatibility, ~3 LOC.
7. **Commit** — diff vs. occupancy; unmount outgoing **deepest-first**, mount incoming **parent-first**, synchronous. Mount failure (constructor/mount throw) leaves the previous route intact — defined behavior, tested.
8. **Settle** — per-nav `Print('STATE', 'nav → <path> [outlets]')`, on by default, `configure()` quiets.

**3.2 — RouteMap (keyed-object form, normative):**
- Type: `RouteMap = Record<RouteId, RouteDefinition>`; `RouteDefinition = { path, redirect } | { path, component, outlet, params?, guard?, children? }`; `children` recursively `RouteMap`.
- Route IDs: quoted lowercase kebab-case string-literal keys, leading letter — `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` (integer-like keys structurally excluded so object order never lies). Enforced: `satisfies RouteMap` + validating mapped type squiggles cheap violations in-editor; `route-check` enforces the full grammar with the canonical error message:
  ```
  Invalid route ID `querySettings`.
  Route IDs must be quoted lowercase kebab-case strings.
  Use:
    'query-settings': { ... }
  ```
- Rejected key forms (negative spec cases): unquoted, computed `[expr]`, uppercase, snake_case.
- `params`: `{ paramName: ConverterClass }` — required for every `:segment` (enforced by type where expressible, by route-check always). Same `ParseResult` contract as `from-view`; divergent policy stated: forms keep-last-good, router **fails the match**.
- Params are **constructor constants**: `new RouteComponent(params)`. Param change = unmount + remount, always. Conformance note added to spec: route components may accept a single params object in their constructor (§4.2's no-arg form is default, not prohibition).

**3.3 — Matching: specificity, never declaration order.**
- Segment-wise left-to-right: static beats param. `*` matches last regardless of position. Equal specificity over the same URL shape = build error (`ambiguous-routes` in route-check), never a positional tiebreak. Reordering blocks never changes behavior.
- URL normalization: matching is path-only; trailing-slash-insensitive; static segments case-sensitive; query params never participate in matching (optional per-route `query` converter map parses them through `ParseResult`; otherwise passed through raw as app concern).

**3.4 — Outlets (closed world):**
- `<outlet name="x">` compiles as an ordinary element (zero compiler surface). Router discovers declared outlets at mount time.
- Registry: `Map<string, { element, ownerRouteId: string | null, active: Component | null }>`. `null` owner = root-declared. Entries whose `ownerRouteId` matches an unmounting route are deleted with it.
- Outlet names are a statically-declared closed set. No public dynamic registration. A route may target only a root-declared outlet or one declared by an **ancestor** route's component (build-checked).
- **Add `'<outlet'` to `isDiamondTemplate` detection** (D-18 interaction: the canonical app shell — static chrome + outlets, zero bindings — must be detected and compiled). Narrow D-18's spec text accordingly.

**3.5 — Guards:**
- `abstract class Guard` in runtime (~55 LOC): `static check(ctx): boolean | Promise<boolean>` (base returns `false` — fail closed), `static deny(ctx): Deny` (base returns `{ path: '/not-found' }` — conceal by default), `static timeoutMs = 5000`. **No other members. No hook forest — ever** (rejected alternative, recorded).
- `type Deny = Location | { external: string }`. External = IdP handoff; the router executes it (`location.assign`, logged) — data the router executes, never a guard side effect.
- **The envelope** is a private static on `Router` (not an overridable class method — JS cannot seal statics): fail-closed on `check()` throw (`Print('EXCEPTION')` → deny); fail-closed on timeout (`Print('FAILURE')` → deny); one structured narration line per decision (guard class, route id, outcome, reason, duration); result normalization (`false` → `this.deny(ctx)`).
- `GuardContext` v2.2: `{ to, from, params, routeId }` — flat, everything real. Capability namespaces (`ctx.policy`, `ctx.security`, `ctx.tenant`…) are the named v3 growth path; **no stubs shipped** (D-16 lesson).
- Composition: `guard: GuardClass | GuardClass[]`, chain order, first non-true wins; parent guards cover subtrees, evaluated once per navigation into the subtree.
- Denial semantics by vector: pushState nav → clean abort (nothing happened). Initial load / popstate → resolve deny as redirect via `replaceState` (no lingering denied entry). Spec guidance: auth/permission guards return a `Location`, not bare `false`.
- Check/deny cleave is normative: `check` is a pure predicate (callable from templates, handlers, socket message handlers — second enforcement points welcome); all navigation policy in `deny`.
- Spec principle, verbatim-adjacent: **client guards predict; servers enforce.** Client guards are UX and telemetry, never the security authority; enforcement lives at the API until Diamond 3.0's server side, after which the same vocabulary runs both sides with asymmetric authority.
- Reserved v3 vocabulary (specified, not shipped): `challenge` decision (v2.2 idiom: redirect to challenge surface with `returnTo`), structured deny reasons (slot into narration now as strings), envelope boundary events beyond navigation (`kind: 'navigation' | 'message'` — socket-borne authorization through the same machinery), fingerprint-as-evidence-never-identity.

**3.6 — `Pending` (departure-safety semaphore, ~30 LOC):**
- `class Pending`: `static hold(label): () => void` (refcounted, idempotent release), `static until<T>(work: Promise<T>, label): Promise<T>` (**passthrough** — returns the same promise; registers hold, releases on settle via finally), `static get active(): boolean`, `static labels(): readonly string[]`.
- `active`/`labels` are **reactive** (one micro-proxy version signal, the Collection pattern) — `if="!Pending.active"` works; departure warning and save-indicator UI read one counter and cannot disagree.
- `beforeunload` handler installed only while count > 0, removed at zero (**a persistent handler disables bfcache** — this conditionality is correctness, not economy). Browsers show generic dialog text; labels are for logs/UI only.
- In-app pushState navs / `navigate()`: phase-1 check — `Pending.active` → `window.confirm`, abort cleanly on decline.
- Known gap, documented: SPA Back (popstate) is not intercepted (that is the deferred canLeave problem); on departure with active holds, `Print('WARNING', 'departure with active holds: <labels>')`. Holds are not cancellation; in-flight promises run to completion.
- Every acquire/release narrates via `Print('STATE', ...)`.

**3.7 — Links & startup:**
- Link pattern per spec §6.3 (verbatim authority): static `href` attribute + click interceptor — same-origin, primary button, no modifier keys → `preventDefault` + `navigate()`. Middle-click/modifier/external pass through untouched.
- Startup route table: `__DIAMOND_DEV__`-gated, one `Print('STATE', ...)` **per route row** (line-oriented paradigm; greppable; survives wsSink). Columns: id, resolved full path, outlet, params, guard classes, redirect target. Tree flattened with indentation.
- Router is the **sole history writer**. Transports/app code request navigation via `router.navigate()`, never touch `history` (spec principle).
- Socket lifetime idiom (spec example, not feature): open in `mount()`, `registerCleanup(() => socket.close())`; deferred-close via `Pending.until(flush).then(() => socket.close())` inside a cleanup.

**3.8 — Exports (spec §11, single entry point):** `Router`, `Guard`, `Pending`, types `RouteMap`, `RouteDefinition`, `RouteId`, `GuardContext`, `Deny` from `index.ts`. No subpaths.

**3.9 — Meta-rule addition (spec §1): language-first composition.**
The framework provides values; the language provides control flow. Nouns for state (`Pending`, `Collection`), single verbs for platform gaps (`hold`, `bind`, `delegate`); JS provides grammar (`await`, `try/finally`, `Promise.all`). Combinators only where the language has no primitive (dependency tracking, `captureScope`). Corollaries: **no fluent/builder chains in public API**; **decorating functions are passthrough** (return what they were given, act by registry side effect).

### Phase 4 — Router test suite (largest single item; exceeds router LOC)

Priority order = risk order:
1. **Disposal** — every navigation fully unmounts outgoing; effect-fire counting after N navigations proves zero accumulation; the D-7 shape (mutate-then-navigate same tick) asserted leak-free at router level.
2. **Transaction atomicity & races** — multi-outlet plan, outlet B guard rejects ⇒ zero DOM mutation anywhere; async guard resolving after newer nav ⇒ discarded; `pushState` never fires on rejection; guard throw and guard timeout both deny (envelope tests); external Deny executes assign (mockable).
3. **Recognition table** — specificity cases (static-vs-param at each depth), parse-fail fall-through, redirect chains, `*` last, ambiguity fixtures (as route-check inputs), depth-3 per reference map. **Gated on the two route sketches — table must test Joe's trees, not only the reference example.**
4. **Links** — modifier/middle-click not intercepted, external hrefs pass, same-origin intercepted.
5. **Mount failure** — constructor throw during commit preserves previous route.
6. **Pending** — refcount, passthrough identity (`until` returns same promise), conditional beforeunload install/remove (bfcache), confirm-abort path, reactive `active` in a template.

### Phase 5 — `tools/route-check.ts` (~180 LOC; parallel to Phase 4)

Standalone bin (stink-check posture), ships in `dev` meta-package. Errors speak route IDs. Rules, each with pass+fail fixtures:
- `invalid-route-id` (full kebab grammar, canonical message above)
- `duplicate-route-id` (global, flattened tree)
- `unknown-outlet` (target not in template outlet inventory)
- `outlet-not-ancestor-owned` (target owned by a non-ancestor route's component)
- `duplicate-outlet-name` (within one component's template)
- `param-missing-converter` (`:segment` without `params` entry)
- `redirect-cycle` / `unknown-redirect-target`
- `wildcard-not-terminal`
- `ambiguous-routes` (equal specificity, same shape)
- `guard-check-not-overridden` (guard class using base `check` — almost certainly a mistake; runtime fail-closed remains the backstop)

### Phase 6 — `@diamondjs/guards` (tier-2 batteries package)

- New package, budget **400 LOC**, opt-in, imports base contract from runtime (cannot drift), ships in `app` meta-package. DDR sentence: converters are the data batteries; guards are the policy batteries.
- Candidate abstract mid-classes: `OAuthGuard` (static issuer/clientId, external-redirect deny), `WebAuthnGuard` (static maxSessionAge, challenge-as-redirect idiom), `CapabilityGuard`, `TenantGuard`. **Which ship in 2.2.0 is gated on the route sketches' guard-family inventory** — scaffold the package; land only confirmed families; the rest are recorded candidates.
- App tier: concrete subclasses configured via static fields (`class CorpusSSO extends OAuthGuard { static issuer = … }`). Per-route parameterization (`{use, state}`) is deferred.

### Phase 7 — Meta-packages (manifest-only)

- `@diamondjs/app` = runtime + converters + primafacie + guards. `@diamondjs/dev` = compiler + parcel-transformer + tools bins (stink-check, route-check). `@diamondjs/all` = union.
- Exact-pin lockstep at `2.2.0` (one tested constellation, not a range). CI check: three manifests in sync with workspace version.

### Amendment A3 + spec deliverables (ship with the release)

- **A3, keyed to v2.1 spec §§:** dispose-on-detach (§5.4.1/§5.4.3/§7.2 lowering text loses "branch cache, detach-not-destroy"; D-1 rationale: bounded rebuild traded for unbounded hidden work + a second disposal semantic); D-7 disposition → fixed; §15 rewrite (dev-log deleted, runtime→primafacie, A2 §94 overturn rationale); §12.5/§6.6 prod-visible warnings; §14 measurement note; D-21 + §4.5 rewrite; D-18 narrowed (`<outlet` token).
- **v2.2 router section:** pipeline, transaction model, RouteMap grammar with negative cases, specificity, outlets closed-world, Guard + envelope + reserved v3 vocabulary + predict/enforce principle, Pending, link pattern (cites §6.3), history stamping, socket seams (cleanup idiom, sole-history-writer, boundary-event reservation), route-table format appendix, language-first-composition meta-rule, and the **normative reference route map** (Crystallizer example, keyed-object form) verbatim.
- **Rejected alternatives (recorded so they stay dead):** array RouteMap; declaration-order matching; `ComponentOutlet` wrapper class; scoped outlet addressing (`{outlet, owner}`); route-kind enums (`page|modal|toast`); bare guard functions; `dependencies` as guard field name; guard lifecycle hook forest; `SecurityParticipant` ancestor class; overridable `run()` as envelope; fluent/builder chains and any `Close()`-style unified teardown verb; URL-as-collaboration-state; hybrid branch cache; runtime-only outlet validation; dynamic outlet registration; guards skipping popstate/initial-load.
- **Deferred (recorded):** `canLeave` with popstate veto semantics (history stamping ships now as forward-compat); keep-alive/route caching; stacked overlay routing; transitions; data resolvers; scroll restoration; compiler-lowered `<outlet>`; template component composition (**v2.3.0, D-21 pointer, own DDR conversation**); `ctx.state` request-scoped store; parameterized guards; `challenge` decision type; `Print` caller-name compiler memoization; mount-outside-captureScope dev warning (primafacie backlog); attribute-interpolation support (diagnosed in 2.1.1); base-path (pending Joe's one-liner).

### LOC ledger (production, post-2.2.0 projection)

| Package | v2.1 | Δ | Projected | Budget |
|---|---:|---:|---:|---:|
| runtime | 863 | +~400 (router+Guard+Pending), −5 (dev-log) | ~1,258 | 2,500 |
| compiler | 2,202 | +~30 (D-3, D-10, D-21, sanitize) | ~2,232 | 5,000 |
| parcel-transformer | 111 | +~25 (run_mode, `<outlet` token) | ~136 | 300 |
| primafacie | 262 | +~70 (plain, receiver, datestamp) | ~332 | 400 |
| converters | 84 | 0 | 84 | 500 |
| guards (new) | — | scaffold + confirmed batteries | ≤400 | 400 |
| tools (route-check) | — | ~180 | — | tools dir |

### Sequencing

v2.1.1 items are independent and parallelizable; tag when green. v2.2 Phases 1→2→3 strictly serial; 3+4 interleave red-then-green per feature; 5 parallel to 4 (depends only on RouteMap format, frozen by A3); 6 scaffolds anytime, lands batteries after sketches; 7 last. Route sketches must arrive before Phase 4 item 3 closes.

**v2.2.0 exit criteria:** full suite green; route-check + stink-check green with zero new baseline entries (link pattern guarantees this); startup route table renders in dev, absent in prod bundle (dead-code-eliminated); reference SPA (app shell + reference map) navigates all vectors leak-free; A3 and the v2.2 spec section merged alongside the code.
