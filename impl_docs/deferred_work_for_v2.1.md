# DiamondJS — Deferred Work for v2.1

**Context.** v2.0 (the v1.5.1→v2.0 migration) is complete — see `project_update_log.md` (2026-06-29 entry) and `v2.0_migration_chronicle.md`. This file consolidates everything deliberately left outside the closed v2.0 boundary, in three buckets:

1. **DDR §7 — formally deferred features** (the spec's own v2.1 scope, with dependency ordering)
2. **Architectural advisories** (surfaced by the v2.0 health-check audit)
3. **Implementation-discovery deferrals** (string-compiler / runtime ceilings logged in `working_notes.md`)

Plus the load-bearing empirical probe (§11.2/§11.3) that several of these share.

---

## 1. DDR §7 — formally deferred features

> These are **2.1, not "nice to have."** The Neuron and Crystallizer applications need the hot path sooner than intuition suggests (DDR §7).

### Dependency ordering (DDR §11.1)
```
2.1a  Collection-at-scale  ──▶  2.1b  data-delegation API   (2.1b gated on 2.1a)
2.1   attribute spread     ── depends only on the 2.0 allowlist (parallel; independent of the Neuron track)
2.1   switch/case/default  ── no dependency (non-urgent; ships after 2.1a/2.1b by priority, not by dependency)
```

### 1.1 Attribute spread `...attrs.bind` / `...attrs.rawBind` (§7.1)
JSX-familiar dynamic attribute/property binding: `<input ...attrs.bind="myGuts">`. The compiler emits a runtime loop over the object's keys → resolution defers to runtime, which is **why the allowlist had to be runtime-capable** (§3.3 row 2).
- **Security: gate FIRST, branch SECOND** — `if (!SAFE_SINKS.has(key)) continue;` then `key in el ? el[key] = val : el.setAttribute(key, val)`. Without the gate, `{innerHTML}`/`{onclick}` are XSS. `...attrs.bind` → unknown keys fail closed; `...attrs.rawBind` → developer owns all keys, emits a heavy `stink:declared`.
- **Precedence: source order wins** (last write) — yields both JSX patterns (defaults-then-override and override-then-defaults). Security stays orthogonal: source order picks *which value*, the allowlist picks *whether it's allowed at all*.
- **Dependency:** the 2.0 allowlist's runtime-enforcement half. Independent of the Neuron track — can land in parallel.

### 1.2 Collection-at-scale performance path — **2.1a** (§7.2)
**The real blocker for the applications — data-structure work, not binding-refactor.** Tens of thousands of cogits, sorted/searched/accessed efficiently against 200MB+ JSON; O(1) append, no proxy overhead at scale. Named as its own deliverable so the prerequisite is tracked, not hidden inside "delegation."

### 1.3 Homogenized reactive + Collection data-delegation API — **2.1b** (§7.2, depends on 2.1a)
The hot-path event surface. `delegate` means the same thing on reactive proxies and Collection (principle of least surprise). **Clean-slate design** against mature Collection's actual shape — *not* a salvage of the removed Aurelia `.delegate()` stub (§6.4). Neuron substrate trajectory: start **DOM/SVG** (peak justification — per-node listeners thrash on every layout tick; one delegated container listener with `.closest()` is the answer virtualization can't provide), then **WebGL** (hit-test against the canvas; DOM-delegate goes moot *for Neuron* there, but mid-size dashboards / update-churn keep the API justified).

### 1.4 `switch` / `case` / `default` (§7.3 — Amendment A1 backlog)
Exhaustive multi-state with a guaranteed catch-all, scoped by the container element (no positional pairing). Design-complete; **lowering strategy open** — Option A (compile-time-erasable wrapper) vs Option B (thin runtime, ~50–80 LOC). Likely resolution: Option B for reactive `on=`, with an Option A fast path for static `on=`. Estimated 60–100 LOC runtime; within budget. The bare-`else` rejection diagnostic already names this as the alternative for exhaustive cases.

---

## 2. Architectural advisories (from the v2.0 health-check audit)

### 2.1 `generateNodes` complexity refactor (`packages/compiler/src/generator.ts`)
The else-if sibling-collection algorithm reaches **nesting depth 5 / cyclomatic ~12**, exceeding the soft targets (<4 nesting, <10 CC). Correct and tested — architectural debt, not a defect; **no automated gate catches it** (deliberately deferred rather than churn the v2.0 finish line). Refactor: extract the chain collector into a private `collectIfChain(nodes, i): { branches: ElementInfo[]; next: number }`, dropping the outer method to depth 3 / CC ≤6. Do this **before** the compiler/parcel grows significantly.

### 2.2 Parcel plugin LOC headroom
`packages/parcel-plugin/src` is at **213 / 300 LOC (71%)** — the tightest budget, **87 lines remaining**. Any new first-class syntax requiring transformer-side handling hits this ceiling. If the plugin must grow, the 300-LOC budget needs a deliberate increase decision.

> Accounting note: `check-loc` measures `packages/compiler/src`, which includes `__tests__`. Production compiler source alone is ~1,700–1,800 cloc lines — comfortably under the 5,000 budget either way.

### 2.3 Multi-line `DiamondCore.bind()` for block-body setters (from the LLM-comprehension audit)
A two-way converter binding emits a single ~140-char line whose **setter holds the security-load-bearing `if (r.valid)` gate** at the very end. A quick-scanning 32B model may read the getter (`Conv.format`) and miss the inbound `parse` validation. Recommendation: in `generator.ts`, when a `bind()` getter/setter is a block body (or the composed call exceeds ~100 chars), split across lines with extra indent so `if (r.valid)` is visually prominent. (Deferred from v2.0: the audit's top two findings — the `rawSet` security comment and the interpolation expression echo — were applied; this formatting pass was not, to avoid finish-line churn.)

### 2.4 Variable-name / tag-name collision in `nextVar` (from the LLM-comprehension audit)
`nextVar` emits `${tagName}${counter}`, so an `h2` element at index 1 becomes `h21`, which reads to an HTML-trained model as a 21-level heading tag (same for `h20`, `h31`, …). Recommendation: separate the segments, e.g. `${tagName}_${counter}` or `el_${tagName}_${counter}`. **Cost note:** this is **cosmetic** but would break ~dozens of tests that assert exact variable names (`div0`, `input0`, `span1`, …) — a deliberate v2.1 change with its test churn, not a v2.0 finish-line edit.

---

## 3. Implementation-discovery deferrals (from `working_notes.md`)

### 3.1 Source maps (VLQ encoding)
The generator emits a **simplified Phase-0 source map** (`mappings: ''` — no VLQ). The DDR's source-map requirement is structurally stubbed; real line/column mappings back to the `.diamond.html` are deferred.

### 3.2 Interpolation brace-scanner
`extractInterpolations` / `buildInterpolationExpr` use `/\$\{([^}]+)\}/g`, which terminates early on a `}` inside pipe args (`${x | Conv('}')}`). Replace with a brace-depth scanner (can share `pipe.ts`'s `splitTopLevel` machinery).

### 3.3 Holistic root cleanup on unmount
Top-level compiled bindings still **don't auto-clean on unmount** (Phase 0/1 behavior — the compiled `createTemplate` discards `bind`/`on` cleanups). Structural directives DO clean their branch subtrees (via `captureScope`), which is stricter than the root. A root-level pass (compiled output registers binding cleanups against the component teardown registry) would close the gap uniformly.

### 3.4 `ParseResult` error-rendering surface (§5.7)
The validation-error **seam** exists (`valid`/`error` on `ParseResult`; the from-view setter gates on `valid`). The **rendering surface is deferred** — `error: string` for v2 (renders directly); noted seam to structured `{ code, message }` for i18n later.

### 3.5 Multi-segment two-way pipe inversion
v2.0 restricts a two-way leg to **exactly one converter** (multi-segment / camelCase → hard error, closing the §5.1 hole). The DDR is silent on inverting a *chain*; a future design could compose independently-invertible converters in reverse on the inbound leg.

### 3.6 Standalone-template import provenance
A standalone `.diamond.html` → module can't import a named pipe transform (errors `pipe-transform-standalone`); converters require the **component-inject path** (where the author's imports are in scope). A 2.1 affordance could map transform-head → module (a convention or directive) so converters work outside the inject path.

### 3.7 Inbound smell-check coverage (§3.3 row 3 / §5.1)
The runtime backstop catches only **number→non-numeric-string** (1 of §5.1's 3 corruption rows). Phone (string→string) and Date (canonical-string) are invisible to it. This is by design — the real defense is compile-time §5.6 parse-required; expanding the runtime backstop is optional and bounded by hot-path cost.

### 3.8 §5.6 resolution robustness
The regex import scan emits a soft `converter-unresolved` info for **re-exports / barrel files / package specifiers** ("verify parse manually"). Following re-exports (or a light module-graph walk) would tighten the hard-error coverage toward §5.5's "the import graph is the registry."

---

## 4. The load-bearing empirical probe (§11.2 / §11.3)

Several items above share one open question: **what is actually on the safe-sink allowlist?**
- **Outbound DOM sinks → tractable.** Trusted Types gives most of the inventory to invert against.
- **Reactive-proxy surface → genuine unknown-unknowns.** This is discovered, not transcribed — and it's the same surface Collection (2.1a) exists to route *around* at scale. **2.1a and the security unknown are the same probe wearing two labels.**
- **Where to run it: NetPad** (§11.3) — cross-user real-time content flow is the hardest XSS surface and exercises both the performance bar and the injection surface at their most demanding, while the foundation is still cheap to change.

---

*Sources: `DiamondJS_v2.0_Design_Decision_Record.md` §§7, 11; the v2.0 architectural health-check audit; `working_notes.md` (Phase 1–4 implementation notes).*
