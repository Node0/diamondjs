> **Filed with the v2.3.0 specification.** This is the design record and work order the Lifecycle Contract was implemented from (PR #39, merged 2026-10-07). It was written against the 2.2.4 baseline and titled for that release; the work shipped in 2.3.0. The Architecture Specification v2.3.0 beside it (§4, §4.6, §4.7, §7.2, §17.2) is authoritative where the two differ, and the divergences found in implementation are recorded in `impl_docs/working_notes.md` under "Lifecycle contract". The record is kept verbatim below as rationale.

---

# DiamondJS Lifecycle Contract — Design Record and Work Order

**Status:** Proposed. Amends spec §4.4 (Component base class contract) and supersedes the "4-hook lifecycle" language in §4.2. Targets the D8 (component composition) release.
**Baseline examined:** `main` at `82bb8bc` (v2.2.4 release merge); Turbine at `62e3b17`.
**Authority:** This record governs. Implementation does not reinterpret it. Open decisions are listed in §13 and must be resolved by the author before Phase 2 begins.

---

## 0. For the implementing session

Read this whole document before touching code. Then:

1. Run the recon in §11 Phase 0 and report divergences from §1 before writing anything.
2. Working-memory notes go in `impl_docs/working_notes.md`, not in this record.
3. The runtime LOC budget is 2,500 (`tools/check-loc-budget.ts`). Current production LOC is 1,746. D8 composition is budgeted separately at ~200. This work is budgeted at **≤ 300 net runtime LOC**, target ~170. Report the number at every phase gate.
4. Tests are numbered L-n (unit) and A-n (acceptance) in §10. The spec cites them by number. Do not renumber.
5. Every phase ends with the full suite green under **both** tsconfig variants (§10.1).

---

## 1. Problem statement

The lifecycle names promise states. The code delivers actions. The gap between each pair is what the runtime's own code calls "D8": a component built as a child of another component is built while detached from the document.

### 1.1 The four hooks as shipped

| Hook | What the name implies | What `component.ts` guarantees | Honest? |
|---|---|---|---|
| `constructor` | The object exists | The object exists | Yes. But `@reactive` fields are inert under `useDefineForClassFields: true` until `mount()` repairs them (`adoptDefinedReactiveFields`), so an effect created in a constructor or field initializer silently tracks nothing on that toolchain. |
| `mount(host)` | On the DOM | Template built and appended to `host` | Only if `host.isConnected` and no root-level structural is pending. Never checked. |
| `update(props)` | Props changed | `Object.assign(this, props)` | Not a hook. Nothing in runtime, compiler or router calls it (spec §4.5, D-21). One unit test does. |
| `unmount()` | Off the DOM | This component's cleanups run and its range removed | Yes for the range. Does not cascade to hand-mounted children; does not cancel unregistered async. |

### 1.2 Defects in the current mechanism (verified by reading, not running)

- **P-1** `Component.mount()` sets `this.mounted = true` before `createTemplate()`. A throw inside the template leaves the flag true and the captured cleanups discarded. Effects created before the throw stay live. The router's rollback only unmounts components that *finished* mounting, so the one that threw is never cleaned.
- **P-2** `DiamondCore.captureScope()` returns its cleanup inside `try`; on throw the `scope` array is lost. Everything registered before the throw leaks.
- **P-3** `placeBefore()` defers to a microtask when the anchor has no parent. A page whose template root is a structural (`<if>` at top level, which is what the compiler emits for a root-level conditional) has no branch nodes when `mount()` returns. The router's `settleScroll` after commit therefore finds no hash target and scrolls to top. Confirmed with a scratch test against 2.2.4. Should be filed as its own issue (root-level structural + hash).
- **P-4** `Component.cleanups` is one flat list. `debounce`/`throttle` register their cancel at construction; the first `unmount()` empties the list; a remount has no cancels. Documented as a caveat in §4.4 today; it is a bug.
- **P-5** `router.commit` constructs all incoming components before unmounting anything. A later constructor or mount throw drops already-constructed instances without `unmount()`. Anything acquired in those constructors leaks.
- **P-6** A child's lifecycle work (`mount`/`unmount`) is hand-wired by parents (Turbine does this on all three pages). `unmount()` does not cascade.

### 1.3 Why it matters (Turbine inventory at `62e3b17`)

| Document-dependent work | Where | Current workaround |
|---|---|---|
| Hand-mount children into slot divs | 3 pages, 4 children | `override mount(host) { super.mount(host); child.mount(slot) }` |
| `querySelector` into own template | `output.ts`, `prompt.ts` | None; fragile |
| Focus after reactive write | `output.askClear` (rAF), `prompt.insertVar` (microtask) | Hand-rolled deferral |
| Scroll restore on appear | `prompt.ts` → `viewer.scrollToOffset` | Works only because pages mount into connected outlets |
| IntersectionObserver rooted at scroller | `source-viewer.ts` | Created in `mount()`; would root at a detached node under D8 |
| Tail follow | `tail-follower.ts` | rAF with cancel (correct, but every author re-implements it) |
| Geometry at drag time | `slide-to-confirm.ts` `range()` | Already correct: reads at interaction time |

`output.diamond.html` line 44 carries the comment "hidden with a class rather than `if`, so its slider host always exists": the bug class forcing a markup decision.

Under D8 every one of these becomes the normal case for every non-root component.

---

## 2. Decisions

Numbered for citation. Each is final unless listed in §13.

- **LC-1 Six phases, one callback each.** `constructing → constructed → mounting → mounted → unmounting → unmounted`. The JS `constructor` is `constructing`'s callback. The other five are overridable methods named exactly as the phase: `constructed()`, `mounting()`, `mounted()`, `unmounting()`, `unmounted()`. Two further phases, `faulted` and `disposed`, are terminal and have no callback.
- **LC-2 No `on` prefix.** `DiamondCore.on(el, event, handler)` already means "event listener". One vocabulary per concept. Lineage: Aurelia's `binding`/`bound`/`attaching`/`attached`.
- **LC-3 Entry points are not hooks.** `mount(host)`, `unmount()` and `dispose()` are final. Overriding `mount` or `unmount` is detected at construction and throws, naming the replacement callback (§5.7).
- **LC-4 `update()` is retired.** Props arrive (D8) as writes to the child's `@reactive` fields; the child's own reactivity is the notification. A separate hook would be a second vocabulary for one event. Any future "prop batch" callback is a D8 decision, opt-in, and is not part of this record.
- **LC-5 `mounted` means connected.** `mounted()` runs only when the component's managed range is in the document, its root-level structurals are placed, and its children's `mounted()` have run. Children built into a detached parent wait for the parent's connection.
- **LC-6 Child-first delivery.** For a parent with children, `mounted()` order is children (in construction order) then parent. Parent measures assembled children; parent runs last so it wins any focus contention.
- **LC-7 Rollback by inventory, not by snapshot.** Every framework-owned acquisition (`bind`, `on`, `effect`, structurals, child instances, tracked ranges, `registerCleanup`) registers into the current scope at creation. Failure recovery is `dispose(scope)`. There is no mutation journal, no value rollback, no verification walk beyond two assertions (§5.5).
- **LC-8 Two scopes.** Instance scope (opened at first framework entry, closed by `dispose()`) holds `debounce`/`throttle` cancels and anything acquired in `constructed()`/`unmounted()`. Mount scope (opened per `mount()`, closed by `unmount()` or rollback) holds the template, children, range and anything acquired in `mounting()`/`mounted()`/`unmounting()`.
- **LC-9 Generations.** Each `mount()` increments `generation`. `unmount()` increments it again on entry. Stale callbacks compare and decline.
- **LC-10 Dispose is total and LIFO.** Each cleanup runs in its own `try`. Failures are collected, never thrown mid-dispose. If any cleanup threw, the instance becomes `faulted`.
- **LC-11 `faulted` and `disposed` are terminal.** `mount()` on either throws before any transition. A faulted instance exposes the cleanup failures on its last record. Recovery is a fresh instance, never a repair call.
- **LC-12 Teardown never throws for callback failures.** A throw in `unmounting()` or `unmounted()` is recorded; teardown continues to completion. Only cleanup failures (LC-10) fault the instance.
- **LC-13 Ring and snapshot are one write.** The coordinator commits a transition by appending one `LifecycleRecord` to the per-instance ring and applying the same record to the reactive snapshot (`phase`, `generation`). Snapshot is `fold(ring)`, cached. `domPing` asserts the two agree with the DOM in dev mode.
- **LC-14 Emission through `Print`.** Failed transitions always emit (`FAILURE`); faults emit `CRITICAL`; stale callbacks emit `WARNING`; successful transitions emit `STATE` only when `__DIAMOND_DEV__`. The ring records regardless.
- **LC-15 The boundary.** The guarantee covers acquisitions made through framework APIs. A raw `addEventListener`, `setInterval` or fetch the author did not register is outside the inventory. The spec says so in one sentence.
- **LC-16 Out of scope for this record:** mutation journal / value rollback; a `Request` battery (belongs beside `Pending`, separate package); retained delivery of writes to not-yet-connected targets (the "courier"); a `visible`/has-a-box phase; compiler site ids; a persistence exporter (that is `wsSink`).

---

## 3. Phase contracts

| Phase | Callback | Promise when the callback runs | DOM | On throw in the callback |
|---|---|---|---|---|
| `constructing` | `constructor` | The object exists. Nothing else. Constructors acquire nothing and announce nothing. | none | Caller disposes the construction scope (§6); no instance registered |
| `constructed` | `constructed()` | `@reactive` fields operational under any toolchain emit; instance scope open and current; `getElement()` is null. Runs exactly once per instance. | none | Instance scope disposed → `faulted` |
| `mounting` | `mounting()` | Mount scope open and current; `generation` assigned; no template, no children exist yet. The honest home for "I am about to appear" side effects. | none | Mount scope disposed → `constructed` (or `unmounted` on remount) |
| `mounted` | `mounted()` | Range connected to the document; bindings applied; root-level structurals placed; children's `mounted()` complete; mount scope current. | connected | Mount scope disposed (range removed) → `constructed`/`unmounted` |
| `unmounting` | `unmounting()` | Range still connected; `generation` already invalidated; mount scope current; anything acquired here is disposed before `unmount()` returns. | connected | Recorded; teardown continues (LC-12) |
| `unmounted` | `unmounted()` | Range detached; mount inventory empty; instance state preserved; instance scope current; remount permitted. | detached | Recorded (LC-12) |
| `faulted` | — | A cleanup failed; inventory cannot be certified empty. Terminal. | indeterminate | — |
| `disposed` | — | Instance scope closed. Terminal. | detached | — |

Visibility, paint and dimensions are **not** promised by `mounted`. A connected element under `display: none` has no box. A-4 pins this.

---

## 4. Failure destinations

| Transaction fails during | Inventory at that moment | Dispose removes | Destination |
|---|---|---|---|
| `constructor` (via router or D8) | Construction scope only | Whatever the constructor registered | No instance |
| `constructed()` | Instance scope | Everything in it | `faulted` |
| `mounting()` | Mount scope: only what the hook acquired | That | `constructed` / `unmounted` |
| `createTemplate()` at acquisition N | Partial bindings, children, anchors | All; nothing was inserted | `constructed` / `unmounted` |
| `appendChild` into host | Full template, range registered | Bindings, children; range remove is a no-op | `constructed` / `unmounted` |
| `mounted()` | Template, range, callback's acquisitions | Range out of document; all effects and listeners | `constructed` / `unmounted` |
| `unmounting()` | Full mount inventory | Teardown continues; failure recorded | `unmounted` |
| A cleanup during dispose | Remainder | Remaining cleanups still run | `faulted` |
| `unmounted()` | Instance scope only | Nothing (recorded) | `unmounted` |
| `mount()` on `mounted`/`faulted`/`disposed` | — | Nothing; throws before transition | unchanged |

"Destination on remount": a failed remount returns to `unmounted`, preserving instance state. A failed first mount returns to `constructed`. Implementation: `priorPhase` captured at `mount()` entry.

---

## 5. Runtime design

### 5.1 Scope changes (`core.ts`)

Replace the closure-returning `captureScope` with an explicit scope object. Keep `captureScope` as a thin wrapper for existing call sites (structurals) so their shape does not change.

```ts
interface Scope {
  list: CleanupFn[]
  children: Component[]          // D8: for child-first delivery
  pending: Array<() => void>     // placeBefore deferred placements
  add(fn: CleanupFn): void
  dispose(): Array<{ index: number; error: unknown }>   // LIFO, each in try; returns failures; list.length === 0 after
}
static openScope(): Scope        // sets currentScope
static closeScope(s: Scope): void // restores previous currentScope
```

**P-2 fix:** `captureScope` wrapper disposes the scope on throw before rethrowing.

`placeBefore`: when `anchor.parentNode` is null **and** `currentScope` is non-null, push the deferred placement into `currentScope.pending` instead of (not in addition to) `queueMicrotask`. The drain in §5.3 runs it synchronously. Keep the microtask path only for the no-scope case (hand-written templates outside any component).

### 5.2 `Component.mount(host)`

```ts
mount(host: HTMLElement): void {
  if (this.phase !== 'constructed' && this.phase !== 'unmounted') throw …   // LC-11, L-25
  this.ensureConstructed()                                                 // §5.6
  const prior = this.phase
  this.generation++
  this.transition('mounting', 'mount')
  const scope = DiamondCore.openScope()
  this.mountScope = scope
  try {
    this.mounting()
    const body = this.createTemplate()        // bind/on/effect/children/pending → scope
    const range = DiamondCore.trackRange(body)
    scope.add(range.remove)
    host.appendChild(range.node)
    if (host.isConnected) DiamondCore.deliverMounted(this)   // else an ancestor's drain delivers
  } catch (e) {
    const failures = scope.dispose()
    this.mountScope = null
    this.transition(failures.length ? 'faulted' : prior, 'mount', e, failures)
    throw e
  } finally {
    DiamondCore.closeScope(scope)
  }
}
```

If `host.isConnected` is false and this component has no framework parent (root mount into a detached host), dev mode prints a `WARNING` once: `mounted()` will never fire. Root hosts must be connected.

### 5.3 `DiamondCore.deliverMounted(c)`

```ts
static deliverMounted(c: Component): void {
  if (c.phase !== 'mounting') return
  const scope = c.mountScope!
  for (const child of scope.children) this.deliverMounted(child)   // LC-6 child-first
  for (const place of scope.pending.splice(0)) place()             // root structurals placed (P-3)
  const prev = this.currentScope; this.currentScope = scope.list   // hook acquisitions → mount scope
  try {
    c.transition('mounted', 'connect')
    c.mounted()
  } catch (e) {
    c.rollbackMount(e)                                               // same dispose path as §5.2 catch
    throw e
  } finally { this.currentScope = prev }
}
```

**Drain points (exactly three):** `Component.mount` after `appendChild` when `host.isConnected`; `placeBefore` immediate path when `anchor.isConnected` (deliver each child in the placed branch's scope); `placeBefore` deferred path, same. A D8 child mounted into its parent's detached element stays in `mounting` until the parent's `deliverMounted` reaches it.

### 5.4 `unmount()` and `dispose()`

```ts
unmount(): void {
  if (this.phase !== 'mounted' && this.phase !== 'mounting') throw …
  this.generation++                                   // LC-9: invalidate first
  this.transition('unmounting', 'unmount')
  const scope = this.mountScope!
  DiamondCore.withScope(scope, () => this.safeCall(() => this.unmounting()))   // LC-12
  const failures = scope.dispose()                    // LIFO: range out first, then children, then bindings
  this.mountScope = null
  this.element = null
  this.transition(failures.length ? 'faulted' : 'unmounted', 'unmount', undefined, failures)
  if (!failures.length) DiamondCore.withScope(this.instanceScope, () => this.safeCall(() => this.unmounted()))
}

dispose(): void {
  if (this.phase === 'mounted' || this.phase === 'mounting') this.unmount()
  const failures = this.instanceScope.dispose()
  this.transition(failures.length ? 'faulted' : 'disposed', 'dispose', undefined, failures)
}
```

`safeCall` catches, records a `callback-failed` record with the error, and returns. Who calls `dispose()`: the router when an occupant leaves for good; structurals (D8) when a branch or row holding a child is removed; app code at root teardown. Authors rarely call it.

### 5.5 Verification (dev mode, `domPing`)

Two assertions, run by `domPing(c)` and in the test harness `afterEach`:

1. After any dispose: `scope.list.length === 0`.
2. `phase ∈ {mounted}` ⇔ every node of the managed range has `isConnected === true`; `phase ∈ {constructed, unmounted, disposed}` ⇔ `getElement() === null`.

`domPing` returns `{ phase, generation, connected, consistent }`.

### 5.6 `ensureConstructed()`

Idempotent. Runs at the first framework entry (`mount()` or the router/D8 construction site): `adoptDefinedReactiveFields(this)`, open instance scope, set it current, `transition('constructed')`, call `constructed()`. On throw: dispose instance scope → `faulted`. Covers hand-constructed components (Turbine's `new SourceViewer()` in a field initializer) without a factory. Moves the `#11` repair out of `mount()`.

### 5.7 Override guard (LC-3)

In the `Component` constructor:

```ts
if (this.mount !== Component.prototype.mount || this.unmount !== Component.prototype.unmount)
  throw new Error(`[Diamond] ${this.constructor.name} overrides mount()/unmount(). These are final. Override mounted()/unmounting() instead (spec §4.4).`)
```

This is the migration hazard: every existing DiamondJS example and all of Turbine use `override mount(host)`. Fail loud.

### 5.8 Ring and record

```ts
type Phase = 'constructing'|'constructed'|'mounting'|'mounted'|'unmounting'|'unmounted'|'faulted'|'disposed'
type Cause = 'construct'|'mount'|'connect'|'unmount'|'dispose'|'stale'|'callback-failed'
interface LifecycleRecord {
  seq: number           // global monotonic
  t: number             // performance.now()
  instance: number      // runtime-assigned id
  generation: number
  from: Phase
  to: Phase
  cause: Cause
  outcome: 'ok'|'failed'|'faulted'|'stale'
  error?: unknown
  failures?: Array<{ index: number; error: unknown }>
}
```

Per-instance fixed ring of 32 (constant; see §13). `Component.history(): readonly LifecycleRecord[]`. `transition()` is the single writer: append, set `phase`/`generation` (reactive), emit per LC-14.

### 5.9 Snapshot

`phase` and `generation` are `@reactive`-equivalent fields on the base class (use the reactivity engine directly; do not depend on the decorator). Effects may read `this.phase`.

---

## 6. Router changes (`router.ts`)

- Wrap each `new Component(params)` in `commit` step (a) in a scope; on throw dispose it (P-5). Call `ensureConstructed()` immediately after construction so `constructed()` runs before any `mount()`.
- Replace the hand-written rollback in step (c) with: on throw, `dispose()` each newly mounted component (they are already rolled back individually by §5.2), then remount previous occupants. Expect ~25 LOC removed.
- `unmountOutlet` calls `dispose()`, not `unmount()`: a departing occupant is gone for good.
- `settleScroll` runs after `commit` as today; P-3 is fixed by §5.3's pending drain, so no router change is needed for the hash hole. L-5 and A-6 verify.

---

## 7. D8 interaction

This record defines the runtime calls D8's compiler output makes. D8 itself (parsing child tags, emitting instantiation, prop effects) is a separate work order.

- Compiler-emitted child instantiation calls `DiamondCore.child(instance, hostEl)`, which: pushes `() => instance.dispose()` onto `currentScope.list`; pushes `instance` onto `currentScope.children`; calls `instance.mount(hostEl)` (host is detached at this point; child stays `mounting`).
- Props: compiler emits `DiamondCore.effect(() => { child.name = this.parentName })`. No `update()` call.
- Cascade: parent `unmount()` disposes mount scope → LIFO reaches `child.dispose()`.
- `constructed()` for children runs inside `DiamondCore.child` via `ensureConstructed()` before `mount`.

---

## 8. LOC budget

| Change | File | Net LOC |
|---|---|---|
| `Scope` object, `openScope`/`closeScope`, LIFO dispose with failure collection, `captureScope` wrapper fix | `core.ts` | +25 |
| `placeBefore` pending registration | `core.ts` | +8 |
| `deliverMounted` and the three drain points | `core.ts` | +35 |
| `DiamondCore.child` | `core.ts` | +10 |
| Phase, generation, `transition()`, ring, `history()` | `component.ts` | +40 |
| `mount()` rewrite | `component.ts` | +20 (replaces existing) |
| `unmount()` rewrite, `dispose()`, `safeCall` | `component.ts` | +25 |
| `ensureConstructed()` | `component.ts` | +12 |
| Five callback stubs, override guard | `component.ts` | +12 |
| `domPing`, dev assertions | `component.ts` | +12 |
| Remove `update()`, `mounted` flag, flat `cleanups` | `component.ts` | −20 |
| Router: construction scope, `ensureConstructed`, simplified rollback, `dispose` | `router.ts` | −15 |
| Dev-only live-effect counter for tests | `reactivity.ts` | +5 |
| **Total** | | **≈ +170** |

Hard ceiling for this record: +300. If the implementation approaches 250, stop and report before continuing.

---

## 9. Migration

- **Turbine** (three pages, two components): `override mount(host) { super.mount(host); … }` → `override mounted() { … }`. Hand child mounting stays until D8 lands (then deleted). `ui.activeTab = …` moves from constructors to `mounting()`. `SourceViewer` observer creation moves to `mounted()` unchanged. `OutputPage.askClear`'s rAF stays (it is a post-reactive-write focus, not a lifecycle concern) until D8 refs exist.
- **`examples/`**: every `override mount` → `mounted`. The override guard makes stragglers fail at construction.
- **Spec**: §4.2 "4 lifecycle hooks" → this record's six phases. §4.4 contract block replaced. §4.5 note that `update()` is retired. Add §4.6 "Failure and recovery" from §3–§4 here. Add the LC-15 boundary sentence.
- **README**: lifecycle section and the base-class example.
- **CHANGELOG**: breaking. `mount`/`unmount` final; `update()` removed; new callbacks.
- **Issue to file**: P-3 (root-level structural + hash) against 2.2.4, closed by this work.

---

## 10. Test plan

### 10.1 Harness

- Existing vitest + jsdom. Add a `lifecycle/` directory under `packages/runtime/tests/`.
- **Two tsconfig runs.** Add a second vitest config (or project) that compiles tests with `useDefineForClassFields: true` and TC39 decorators. CI runs both. L-1 is the reason; everything else benefits.
- **Listener counter.** In `beforeEach`, wrap `EventTarget.prototype.addEventListener`/`removeEventListener` to maintain a per-target count; expose `listenerCount(target?)`.
- **Live-effect counter.** `__DIAMOND_DEV__`-gated counter in `reactivity.ts`, incremented on effect creation, decremented on its cleanup. Expose via `DiamondCore.__liveEffects()`.
- **Instance tracker.** Test-only `WeakRef` set of constructed components for L-34/L-35.
- **`afterEach`:** L-35 (`domPing` consistent for every live instance).
- **Fixtures:** every code example in the spec's lifecycle section is a file under `tests/lifecycle/fixtures/` and is imported by at least one test. Docs cannot drift from tests.
- **Acceptance:** Playwright against real Chromium, `examples/` app and Turbine. Add `@playwright/test` as a dev dependency of the repo root (not of any published package). A-n tests live in `tests/acceptance/`.

### 10.2 Unit tests — hooks

| ID | Hook | Asserts |
|---|---|---|
| L-1 | `constructed` | An effect created inside tracks a `@reactive` field: write → effect re-runs. Must pass under both tsconfig runs. |
| L-2 | `constructed` | `getElement()` is null; `phase === 'constructed'`; runs exactly once across construct → mount → unmount → mount. |
| L-3 | `constructed` | Runs at first `mount()` for a hand-constructed component; runs before `mount()` for a router-constructed one; runs inside `DiamondCore.child` for a D8 child. |
| L-4 | `mounted` | `getElement().isConnected === true` for: root component; D8 child; child inside `if`; `repeat` row; route component; page whose template root is a structural. |
| L-5 | `mounted` | Page whose template root is `<if>`: the branch's nodes are in the document when `mounted()` runs (P-3). |
| L-6 | `mounted` | Parent with two children: call order is child A, child B, parent. |
| L-7 | `mounted` | A child built into a detached parent does not receive `mounted()` until the parent connects; a child inside an `if` branch receives it on branch placement, not branch build. |
| L-8 | `mounted` | Bindings applied: a `textContent` bound to a field reads the field's value inside the hook. |
| L-9 | `mounting` | `getElement()` is null; no child has been constructed; an effect created here is disposed by `unmount()`; `generation` already incremented. |
| L-10 | `unmounting` | `isConnected === true` inside; `generation` already incremented relative to `mounted`; an effect created inside is disposed by the time `unmount()` returns. |
| L-11 | `unmounting` | A throw inside does not stop teardown: range removed, inventory empty, `phase === 'unmounted'`, ring has a `callback-failed` record. |
| L-12 | `unmounted` | Every range node has `parentNode === null`; mount scope length 0; listener delta since before `mount()` is 0; live-effect delta 0; `@reactive` values preserved; `mount()` again succeeds with `generation + 2` (one for unmount, one for mount). |
| L-13 | `unmounted` | Instance scope survives: a `debounce` created in a field initializer still cancels correctly after unmount → remount → unmount (P-4). |
| L-14 | `dispose` | Instance scope closed; `phase === 'disposed'`; `mount()` afterwards throws without a transition. |
| L-15 | guard | A subclass overriding `mount` or `unmount` throws at construction with a message naming `mounted()`/`unmounting()`. |

### 10.3 Unit tests — failure paths

| ID | Throws in | Asserts |
|---|---|---|
| L-20 | `createTemplate()` at the Nth acquisition, parameterised N ∈ 0..k | Listener delta 0; live-effect delta 0; no node connected; `phase === 'constructed'`; ring ends `mounting → constructed, failed`; error rethrown unchanged. |
| L-21 | `mounting()` | Same post-conditions as L-20; inventory at throw contained only the hook's own acquisitions. |
| L-22 | `mounted()` | Range removed from document; callback's effects and listeners disposed; `phase === 'constructed'` (first mount) or `'unmounted'` (remount); error rethrown. |
| L-23 | A child's `mounted()` under a parent | Parent remains `mounted` and interactive (a bound click still fires); the owning structural's branch is gone; no child listeners remain; child's ring says failed. |
| L-24 | A cleanup during dispose | Remaining cleanups still ran (spy order); `phase === 'faulted'`; `mount()` refused with message naming the failed cleanup index; `history().at(-1).failures` holds the error. |
| L-25 | `mount()` on `mounted`, `faulted`, `disposed` | Throws before any transition; ring unchanged. |
| L-26 | Subclass constructor, via router and via D8 | No instance registered; nothing from the attempt in any scope; previous route / branch fully intact. |
| L-27 | `constructed()` | Instance scope disposed; `phase === 'faulted'`; `mount()` refused. |
| L-28 | `unmounted()` | Recorded as `callback-failed`; `phase === 'unmounted'`; remount still permitted. |

### 10.4 Unit tests — invariants

| ID | Invariant |
|---|---|
| L-30 | Property test: random sequence of `bind`/`on`/`effect`/`if`/`repeat`/child acquisitions, throw injected at random index, 1,000 iterations. Post-condition is L-20's every time. |
| L-31 | A callback that captured generation g and runs in g+1 is a no-op and appends a `stale` record. |
| L-32 | For any transition sequence, `fold(history())` equals `{ phase, generation }`. |
| L-33 | `faulted` and `disposed` are terminal: no transition leaves either. |
| L-34 | Conformance: mount → unmount → mount → unmount leaves listener count, live-effect count, DOM node count and instance-scope length identical to one mount → unmount. Run against every component in `examples/` and every Turbine component. |
| L-35 | `afterEach`: `domPing` consistent for every live instance. |
| L-36 | Router: `commit` failing on the third of three incoming components leaves occupancy, outlets and DOM identical to before the navigation; the two that mounted are `disposed` with empty inventory. |
| L-37 | `placeBefore` deferred path with no scope (hand-written template) still places on the microtask, as today. |
| L-38 | `Print` emission: failed transition emits `FAILURE`; fault emits `CRITICAL`; ok transition emits `STATE` only when `__DIAMOND_DEV__`. |

### 10.5 Acceptance tests (Playwright, real Chromium)

| ID | Scenario | Passes when |
|---|---|---|
| A-1 | A D8 child three levels deep, under a root-level `if`, calls `this.knob.focus()` in `mounted()` with no rAF | `document.activeElement` is the knob |
| A-2 | Prompt page sets `scroller.scrollTop = saved` in `mounted()` during a route commit | `scrollTop === saved` after navigation |
| A-3 | SlideToConfirm reads `clientWidth` in `mounted()` under a visible parent | Nonzero |
| A-4 | Same, under a `display: none` ancestor | Zero; test name states this is the documented boundary |
| A-5 | SourceViewer creates its IntersectionObserver in `mounted()` | First batch renders without a manual trigger |
| A-6 | Navigate to a page whose template root is a structural, with `#hash` | Viewport scrolled to the target (P-3) |
| A-7 | A child's `mounted()` throws on a live page | Page remains clickable; failed branch absent; exactly one `FAILURE` line; zero uncaught errors |
| A-8 | Navigate away during a page's in-flight rAF and pending fetch | No callback runs after `unmount()`; no console error |
| A-9 | Turbine's three pages cycled 50 times via navigation | DOM node count, listener count and JS heap (CDP `Performance.getMetrics`) within tolerance of cycle 1 |
| A-10 | Force a cleanup to throw, then navigate back | Navigation refused with the faulted instance named; previous route intact |

Until D8 lands, A-1 uses a hand-mounted child via `DiamondCore.child` directly.

---

## 11. Work order (phased, gated)

Each phase ends with: both tsconfig runs green; `check-loc-budget` number reported; a one-paragraph note in `working_notes.md`.

**Phase 0 — Recon (no code).** Verify every claim in §1.2 against `main`. Report line numbers. Report any existing test that encodes the old `mount` semantics and will need to change. Report the current production LOC. Stop and report.

**Phase 1 — Scope and inventory.** §5.1. `captureScope` fix (P-2). `placeBefore` pending. Tests: L-37, and a direct `Scope.dispose` LIFO/failure test. Existing suite must still pass unchanged. Gate.

**Phase 2 — FSM and entry points.** §5.2, §5.4, §5.6, §5.7, §5.8, §5.9. Callbacks as empty methods. `deliverMounted` with only the first drain point (root). Remove `update()`. Update `examples/` to `mounted()`. Tests: L-1..L-3, L-9..L-15, L-20..L-22, L-24, L-25, L-27, L-28, L-32, L-33, L-38. Gate: LOC report.

**Phase 3 — Connection and delivery.** Remaining drain points, child-first order, `DiamondCore.child`. Tests: L-4..L-8, L-23, L-26 (D8 half may be stubbed), L-31, L-34, L-35. Gate.

**Phase 4 — Router.** §6. Tests: L-26 (router half), L-36. Gate.

**Phase 5 — Property and conformance.** L-30, L-34 across `examples/` and Turbine (Turbine checked out as a sibling, path configurable). Gate.

**Phase 6 — Acceptance.** Playwright setup, A-1..A-10. A-9 tolerance to be set from the first run and recorded in `working_notes.md`.

**Phase 7 — Docs.** §9 spec, README, CHANGELOG. Fixtures-as-docs wiring (§10.1). File the P-3 issue and close it in the same PR.

---

## 12. Definition of done

- All L-n and A-n green under both tsconfig runs.
- Runtime production LOC ≤ 1,746 + 300; reported figure in the PR.
- Spec §4.2/§4.4/§4.5/§4.6 updated; every lifecycle code example in the spec is an imported fixture.
- Turbine builds and its three pages pass L-34 and A-9 against the new runtime.
- Stink baseline unchanged (this work touches no sinks).
- `route-check` and `stink-check` pass.

---

## 13. Open decisions for the author

Resolve before Phase 2.

1. **Keep `unmounted()`?** Least-justified callback; the ring already carries the phase. Default: keep, for one-callback-per-phase regularity.
2. **Ring size.** Default 32 per instance, constant. Configurable later if tooling needs it.
3. **`dispose()` name.** Alternatives: `destroy()`, `release()`. Default: `dispose`, matching the "disposal contract" vocabulary already in the spec.
4. **Does `mounting()` receive `host`?** Default: no. Keep callbacks nullary; `getElement()` is the DOM accessor.
5. **Should `unmount()` rethrow a `mounting()`/`unmounting()` callback error after completing teardown?** Default: no (LC-12). Record and continue.
6. **`STATE` emission in production.** Default: dev only (LC-14). Flip if the recorder is wanted in production logs from day one.

---

## 14. Not in this record

Mutation journal and value rollback. `Request`/async-operation battery. Retained write delivery (courier/mailbox). `visible` / has-a-box phase. Compiler site ids and `ping(id)`. Component-graph JSON projection. Any `update(change)` observation channel beyond the lifecycle ring. These are recorded elsewhere or deferred; nothing here precludes them.
