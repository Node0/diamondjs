# DiamondJS — Amendment A2: the v2.1 Design Record

**Status:** Ratified. Records every interpretive call and spec-gap resolution made for the v2.1 implementation, so the spec (DDR + A1 + this document) remains authoritative over the code — nothing below was resolved silently at implementation time; each decision was surfaced and user-approved during the v2.1 planning session.
**Date:** July 7, 2026
**Governs:** the v2.1 release (all packages at 2.1.0).
**Sources:** DDR §7/§11, Amendment A1, `deferred_work_for_v2.1.md`, `working_notes.md` §§2–3, and the recorded v2.1 planning decisions.

---

## 1. `<switch>` / `<case>` / `<default>` semantics (closes A1's open lowering question)

**Lowering: Option B + Option A fast path.** Reactive `on=` lowers to a thin runtime construct, `DiamondCore.switch(anchor, onGetter, cases, defaultMake?)`, mirroring `if()` (lazy `captureScope` builds, branch cache, detach-not-destroy). The **on-value is evaluated exactly once per update**, then tested against case predicates in document order; first match wins; the default occupies slot `cases.length`.

**Case classification** (`<case if="...">`):
| Form | Kind | Meaning |
|---|---|---|
| quoted string / number / `true` / `false` / `null` | equality | `v === <literal>` |
| bare single word (identifier-shaped; dashes allowed) | equality | `v === '<word>'` — **string** equality; A1's own `on="status"` / `if="loading"` example |
| anything with operators / spaces / dots / parens | expression | boolean expression over component state via `prefixExpression` |

Consequences (ratified): a dotted path like `if="user.role"` is an **expression (truthiness)**, NOT equality. Expression cases **cannot see the on-value** (no `$value` alias — A1 silent; not invented).

**Erasure.** All three elements are fully erased: no DOM container ships (multi-root case bodies mount as DocumentFragments via `combineRoots`); any attribute beyond `switch[on]` / `case[if]` is an error (`switch-extraneous-attr`) — the elements have no DOM target.

**`<default>` must be the last child** (`switch-default-not-last`, error) — canonical-form readability promoted to a rule.

**Static fast path (Option A).** Applicable iff `on=` is a **pure literal** AND every case is equality-kind (one expression case makes the winner undecidable — falls back to the runtime construct; a bare identifier `on=` is reactive state, never static). When applicable, only the winning branch's DOM code is emitted — zero runtime cost.

**Statically-dead switch (user decision, replaces the proposed hard error):** a static `on=` matching no case with no `<default>` emits a **`switch-static-dead` WARNING** ("unused code" — not a build blocker) plus an **inspectable DOM comment** carrying the dead switch's source (with `--` made comment-safe). Never silently dropped, never fails the build.

**Diagnostics:** `switch-no-on`, `switch-extraneous-attr`, `switch-bad-child`, `switch-multiple-default`, `switch-default-not-last`, `switch-empty`, `case-no-if`, `case-outside-switch`, `default-outside-switch`, `switch-static-dead` (warn).

**HTML caveat (accepted):** parse5 foster-parenting relocates `<case>`/`<default>` inside table contexts, producing loud `case-outside-switch` errors rather than silent breakage.

## 2. Attribute spread `...attrs.bind` / `...attrs.rawBind` (implements DDR §7.1; spec-silent parts ratified as FULL semantics)

- Only the two canonical forms exist; any other `...` attribute → `bad-spread` error.
- Compiler emits `DiamondCore.spread(el, () => expr[, true])` **in attribute source order** relative to sibling bindings (mount-time "source order wins"); after mount, standard reactive semantics (last effect wins) — §7.1 doesn't address update time.
- Runtime, per key: **gate FIRST** (canonicalize via `canonicalizeSinkKey`, then `SAFE_SINKS` ∪ `data-*`/`aria-*`; unknown keys fail closed with a dev-only warn-once), **branch SECOND** (`canonical in el` → property; else `setAttribute(String(value))`).
- **Key-removal reconciliation (spec-silent, ratified):** keys applied previously but absent now — attribute keys are removed; property keys restored to their snapshotted pre-spread value.
- **Reactivity shape-tracking (spec-silent, ratified):** the proxy gains `ownKeys` + `deleteProperty` traps and an `ITERATE_KEY` sentinel; key add/delete on a reactive spread source retriggers the effect.
- `...attrs.rawBind` bypasses the runtime gate entirely (developer-owned) and emits a heavy **`stink:declared`** (`property: '...attrs'`, `op: 'spread'`) into the audited baseline.

## 3. `data-*` / `aria-*` allowlist extension (ratified)

`data-*`/`aria-*` keys pass the outbound gate **through the attribute branch** — inert metadata, never parsed as HTML/script/URL. Applied consistently at BOTH gates: the runtime spread gate and compile-time `gateSink` (a single `data-x.set` must not warn where spread would allow it). Codegen: dashed names write via `setAttribute` (`.set`) or the new attribute path in `bind()` (`.to-view`); inbound ops on dashed names are an error (`attr-binding-outbound-only`) — there is no DOM property to sample. Other dashed names (not data-/aria-) still fail closed.

## 4. `SAFE_SINKS` / `PROPERTY_NAME_MAP` canonical home → `@diamondjs/runtime` (ratified)

The spread gate made the allowlist **load-bearing at runtime**; two copies with an equality test would be two audit points. The canonical sets now live in `packages/runtime/src/security.ts`; the compiler imports and re-exports them (public API unchanged) and gains a runtime **package dependency** (acyclic; the root build script orders runtime first). Invariant (`SAFE_SINKS ⊆ PROPERTY_NAME_MAP ∪ lowercase-identical`) is enforced in both packages' test suites.

## 5. Collection<T> — the 2.1a surface (DDR §7.2 gave only the performance bar; API ratified)

`packages/runtime/src/collection.ts`; factory `DiamondCore.collection(items?, {key?})`.

- **Items are never proxied** — no per-item trap overhead; identity preserved (exactly what `repeat` keys on).
- **Coarse-grained reactivity**: one version signal (a one-field micro-proxy through the existing engine — zero new reactivity machinery); reads touch, mutations bump; the scheduler's dedupe collapses 10k synchronous `push()` calls into one flush.
- Surface: `length`, `at`, `byKey` (O(1); requires `key` option; incremental index, lazily rebuilt after `mutate`), `push` (O(1) amortized), `remove` (O(n) by identity — batch removals belong in `mutate`), `find`, `where`, `sortBy` (view cached per **stable comparator reference** until the next mutation), `binarySearch` (returns index or `~insertionPoint`), `mutate(fn)` (raw array surgery, single re-render), `notify()` (the ratified escape hatch for in-place item edits — invisible to the version signal by design), `toArray`, `[Symbol.iterator]`.

## 6. `DiamondCore.delegate` — the 2.1b surface (ratified; clean-slate, NOT the removed Aurelia stub)

`delegate(container, eventType, selector, handler(item, event, node)): CleanupFn`. One container listener; `event.target.closest(selector)` + containment check; walk-up through `repeat`'s **WeakMap node→item registry** (populated at row build, deleted at row disposal); the handler receives the **data item** — identically for reactive-array and Collection sources (that uniformity IS the DDR's "homogenized" requirement). A selector match with no registered item is a **no-op** (ratified). **Runtime-API-only in v2.1** — no template grammar (unspecified by the DDR; also protects the parcel-plugin LOC ceiling).

## 7. Multi-segment two-way pipe inversion (working_notes §3.5 — DDR silent; design ratified)

A two-way chain is legal **iff every segment is a PascalCase converter**. Getter = `format` composed left-to-right; setter = `parse` composed **right-to-left** (`rN…r0`, numbered by segment index), each step's `ParseResult` checked, **fail-fast** — the model stays untouched (raw text preserved) unless every step is valid. One plain function anywhere poisons the chain → `pipe-two-way-noninvertible` (hard error). **`pipe-two-way-multi` is retired.** One `parse` obligation is emitted **per segment**, so §5.6 verification covers the whole chain. **from-view stays single-transform** (`pipe-fromview-multi` unchanged) — inbound single-step remains the discipline.

## 8. `error-into` — the §5.7 rendering surface (ratified new grammar)

`property.error-into="targetProp"` — a property-scoped companion attribute (mirrors `update-on` exactly; parse5-safe). The emitted setter writes `target = r.valid ? null : r.error`; in chains, the **first failing step's error wins**, cleared to null on full success. The target is ordinary reactive state — rendering it is plain `${amountError}` / `if="amountError"`; no new rendering machinery. `error` stays `string` (the structured `{code,message}` i18n seam remains open, per §3.4's note). Diagnostics: `bare-error-into`, `bad-error-into` (bare property paths only), `error-into-no-binding`, `error-into-not-inbound`, `error-into-no-converter` (codegen-time — only it knows segment kinds).

## 9. `<!-- @import -->` — standalone-template provenance (working_notes §3.6; ratified new grammar)

`<!-- @import { Name, other } from './module' -->`, scanned from the raw template text. **v1 restrictions:** named imports only — no aliasing, no default/namespace forms; malformed `@import`-shaped comments error loudly (`bad-import-directive`), duplicates error (`import-directive-duplicate`), unused names are info (`import-directive-unused`). The Parcel wrapper emits the directives as real import lines (specs resolve relative to the `.diamond.html` asset), `pipe-transform-standalone` fires only for **uncovered** heads, and §5.6 obligations are verified against the synthesized imports via the new public `DiamondCompiler.verifyObligations()`.

## 10. §5.6 re-export following (working_notes §3.8)

`verifyConverterParse` follows **named re-exports** (incl. `as` aliasing, followed under the original name) and **`export * from`** barrels: depth cap **3 hops**, cycle-guarded, package-specifier hops stay soft-info. A barrel-resolved module missing `static parse` **hardens** to `converter-missing-parse` (previously soft "verify manually"). The module-level `/static\s+parse\b/` check remains the string compiler's accepted ceiling.

## 11. Source maps (working_notes §3.1)

Real base64-VLQ V3 mappings (hand-rolled, dependency-free, line-level granularity) replace the Phase-0 `mappings: ''` stub. **Documented caveat:** the map is relative to the bare `createTemplate()` snippet; `compileAndInject` insertion and the Parcel module wrapper shift lines — full `asset.setMap` wiring remains deferred plugin work.

## 12. Wider inbound smell check (working_notes §3.7 — ratified best-effort widening)

The runtime backstop adds two dev-only, warn-once heuristics beyond number→NaN-string: ISO-date-string → `/`-formatted date-ish string, and canonical-10-digit string → formatted string. §5.1 calls these rows "invisible by design"; this widening is explicitly **best-effort** — heuristic false positives are accepted as dev noise. Hot-path guards unchanged (string-check first, hoisted regexes, `NODE_ENV` gate).

## 13. Template detection tokens

`isDiamondTemplate` (plugin + stink-check mirror) gains `<switch` and `repeat.for=` — both unambiguous. **Bare `if=` is deliberately excluded** (false-positive claims on non-Diamond HTML would break builds loudly); an if-only template with zero bindings/interpolations remains undetected — documented blind spot.

## 14. Primafacie logging (user-requested addition)

New package **`@diamondjs/primafacie`** (named by the user): the stargate `Print(logType, message)` paradigm — 15 log types, symbol pairs, caller extraction, padded line format preserved verbatim; isomorphic console (Node ANSI / browser `%c`); pluggable sinks (`addSink`, `wsSink` adapter; Node-only `fileSink` under the `./node` subpath so browser bundles never touch fs). Wiring: tools' summary lines and the Parcel transformer's non-throwing diagnostics print through it; the **runtime adopts only the line format** via a dependency-free `devWarn` (stays lean/tree-shakeable); the compiler stays pure (returns diagnostics). Budget: 400 LOC.

## 15. Root cleanup (working_notes §3.3 — closed)

`Component.mount` wraps `createTemplate()` in `DiamondCore.captureScope` and registers the cleanup: root-level binding/listener/structural teardowns now dispose on `unmount()`, uniformly with branch subtrees. Known, pre-existing, still-open: calling `mount()` twice leaks the first scope (unguarded before and after).

## 16. Budget notes

- Parcel plugin sits at **exactly 300/300 LOC** after v2.1 — the §2.2 ceiling has arrived; any further transformer-side growth requires the deliberate budget-increase decision that advisory anticipated.
- Compiler ~4,150/5,000; runtime ~865/2,500; converters 84/500; primafacie ~230/400.

## 17. Still open after v2.1

- `ParseResult.error` structured `{code, message}` (i18n seam).
- Plugin `asset.setMap` source-map wiring (offset shift).
- Double-`mount()` scope leak guard.
- The §11.2 empirical allowlist probe — netpad (§11.3) remains the designated stress test; 2.1a/2.1b now exist to build it on.

---

*Amendment A2 closes the v2.1 implementation session. The switch lowering question left open by A1 is resolved; every §3 working-notes deferral is either shipped or explicitly re-recorded above.*
