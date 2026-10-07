# DiamondJS — Architecture & Design Specification v2.3.0

**Status:** Complete, for ratification · describes `main` at `07cf171` — the content of v2.3.0: v2.2.4 plus the Lifecycle Contract (PR #39) and preserved template text (#15, PR #40). The `v2.3.0` tag and publication are pending; nothing in this document waits on them. §4.5 records the template component composition proposal, deferred to v2.3.1.
**Author:** Joe Hacobian
**Supersedes:** the v2.2.4 specification (`docs/spec/v2.2.4/`), and through it the v2.1 spec, Amendment A3, the v2.2 Router Specification and Work Order. Those remain the *rationale* archive; this document is the single authoritative *reference*. `diff` against the v2.2.4 file shows exactly what 2.3.0 changes.

**Consolidation basis:** the v2.1 spec → Amendment A3 (v2.1.1 conformance patch, v2.2.0 logging/measurement rulings) → the v2.2 Router Specification (v2.2.0, with the v2.2.1 Destination record folded in) → the 2.2.2–2.2.4 fixes → the 2.3.0 changes: the Lifecycle Contract design record (LC-1…LC-16, filed beside this document as `DiamondJS_v2.3.0_Lifecycle_Contract_Design_Record_and_Work_Order.md`) as implemented in PR #39, and preserved text (#15). This document is self-contained: the earlier records are rationale, and nothing normative is stated only there. Section numbers §1–§16 keep their v2.1 meaning so that every `§n` citation in source comments and earlier records still resolves; the router becomes §17 and keeps the Router Specification's own numbering (Router Specification §9 is §17.9 here); the appendices move to §18. Appendix G is the version changelog.

---

## 0. How to read this document

This is a **specification**, and under the project's standing rule the spec is authoritative over the code: where shipped v2.3.0 diverges from what this document states, the *code* is nonconforming, not the spec. That rule only works if the divergences are visible rather than buried, so two conventions run throughout:

- The **body** states the intended, authoritative contract — what a conforming DiamondJS must do.
- Where shipped v2.3.0 does **not** currently meet that contract, an inline **⚠ Defect D-n** pointer marks the spot, and the full mechanism, severity, and disposition (fix-the-code vs. accept-as-limitation vs. correct-the-record) live in **§16 (Conformance & Known Limitations)**. Nothing the recon surfaced is smoothed over.

Version tags in parentheses — *(v2.2.1)*, *(2.2.4, #29)* — mark text that entered after v2.1, with the release and the issue that carried it. Appendix G lists every such change by release. Tags such as *LC-n* and *P-n* (the decisions and defects of the Lifecycle Contract record filed beside this document), *C-n* (the composition proposal, §4.5) and *D-n* (§16) are provenance labels: every rule they tag is stated here, and nothing normative lives only in an earlier record.

The throughline under every naming and grammar decision: **a token must predict its own behavior to a ~32B model, not merely describe it to a human.** Names are optimized against the small model's failure mode — a confident wrong completion drawn from a training prior — not against the dictionary. A technically-correct name that reliably triggers a wrong prior is worse than a plainer name with no competing prior.

---

## Table of contents

1. The Zen of DiamondJS
2. Architecture overview
3. Core constraints
4. Component system
5. Template DSL
6. Security model
7. Reactivity & binding engine
8. Collections
9. Data delegation
10. Build system
11. Runtime API reference
12. Diagnostics catalog
13. Compiled-output conventions
14. Packages & LOC budgets
15. Logging (`@diamondjs/primafacie`)
16. Conformance & known limitations
17. Router
18. Appendices (A token reference · B positioning · C versioning · D route-table format · E router rejected alternatives · F deferred · G version changelog)

---

## 1. The Zen of DiamondJS

Governing principles. Not aspirational poetry — engineering constraints with teeth. When a design decision creates tension, these break the tie.

**I. Radical transparency ("show your work").** No black box at runtime. Build-time transformation is preferred over runtime reflection. The compiled output an LLM or junior developer reads is standard JavaScript classes calling explicit functions. There is no dependency-injection container hiding object provenance; the compiler leaves a paper trail for every transformation.

**II. Conservation of complexity.** Complexity must live somewhere; put it in the compiler, so it lives neither in the runtime nor in the developer's head. Ergonomic syntax (decorators, pipes) is acceptable only when it lowers to self-evidently transparent code.

**III. Consistency over optimization.** The mental model is never broken to save memory unless that memory prevents the application from existing. If `this` works in 90% of cases, make it work in 100%. Optimize the data structures (`Collection`), not the syntax.

**IV. Pit-of-success scaffolding.** Routine decisions are made for the developer so energy goes to unique problems. One router that works, not twelve options.

**V. Routine things simple, difficult things possible.** "Hello world" is trivial; the hard app is possible without ejecting. When a data wall is hit, the developer switches to `Collection` — because the physics of the data changed, not because the framework broke. The framework explains the transition rather than hiding it.

**VI. Barely noticed is victory.** The highest praise is "I barely noticed the framework was there."

The design meta-rules these fall out of, carried from the v2.0 record and load-bearing for the rest of this document:

- **Syntax ≠ semantics ≠ architecture.** A construct's surface token, its meaning, and a host framework's implementation choices are three independent things; never reason from one to another. ("Aurelia used DI for X" never justifies removing X's *syntax* — DiamondJS compiles, and can lower any construct to a plain call with zero DI.)
- **Name must predict behavior to a small model** (the throughline above).
- **Purity vs. statefulness cleave.** Pure value transforms and stateful binding/control mechanics belong in different syntactic locations.
- **Scope introduction must be visible at the use site.** `repeat.for` introduces a named, visible loop variable — passes. `with` introduced anonymous ambient rebinding — removed.
- **Allowlist > blocklist for security.** A blocklist enumerates known-bad and fails *open* on the unforeseen; an allowlist enumerates known-good and fails *closed* on ignorance.
- **Compile-time is the single choke point** for statically-known sink writes.
- **Provenance lives in the import, not a magic location.** The `import` statement is the registry.
- **Reactive-over-static is free.** A reactive binding referencing only static values never re-evaluates, so no construct needs a separate one-time variant.
- **Language-first composition** *(v2.2.0)*. The framework provides **values**; the language provides **control flow**. Nouns for state (`Pending`, `Collection`), single verbs for platform gaps (`hold`, `bind`, `delegate`); JS provides grammar (`await`, `try/finally`, `Promise.all`). Combinators only where the language has no primitive (dependency tracking, `captureScope`). Corollaries (normative): **no fluent/builder chains in the public API**; **decorating functions are passthrough** — they return what they were given and act by registry side effect (`Pending.until(work, label)` returns `work` itself).
- **Explicit discriminants** *(v2.2.1)*. Explicit discriminants in authored data; shape-inference only for uncontrolled input. When a field in a spec-governed structure grows a taxonomy, promote it to a tagged union. Canonical example: `Destination` (§17.5) — the string dual-form was designed, then rejected when `site-path` proved shape-indistinguishable from `route-path`.
- **A lifecycle name promises a state, not an action** *(2.3.0, LC-1)*. A callback is named for the phase it runs in, and runs only when that phase's promise holds (§4.4). Entry points (`mount`, `unmount`, `dispose`) are actions and are not overridable.

---

## 2. Architecture overview

### 2.1 The three-layer model

**Layer 1 — Write-time (human + LLM friendly).** ES2022+ TypeScript; Aurelia-descended template syntax; `@reactive` decorators; explicit imports; component triplets (`.ts` + `.html`/`.diamond.html` + `.css`).

**Layer 2 — Build-time (compiler).** A Parcel 2 transformer compiles templates into an instance `createTemplate()` method — injected into the component class, or exported from a standalone template module (§5.8) that the class assigns; `@reactive` is a runtime decorator (§7.1) the compiler leaves alone; `[Diamond]` semantic-hint comments are injected; a compile-time security gate audits every statically-known sink write; VLQ source maps are generated (see §16, D-11, for their reachability).

**Layer 3 — Debug-time (LLM comprehensible).** Explicit `DiamondCore` method calls; `this` refers to the component instance everywhere; no hidden state, no DI container; every transformation carries a `[Diamond]` hint.

### 2.2 What was eliminated relative to Aurelia 2.0

The DI container, the runtime template compiler, the complex observer system, the 8-hook lifecycle, and the decorator-metadata system are all gone — replaced by ES-module imports, build-time compilation, Proxy reactivity + `@reactive`, a six-phase lifecycle with one callback per phase (§4.4; the Aurelia `binding`/`bound`/`attaching`/`attached` lineage, without the `on` prefix), and compiler transformation respectively. The runtime that remains is a small library of explicit functions (see §14 for actual LOC).

---

## 3. Core constraints

### 3.1 Hard constraints (non-negotiable)

1. **Runtime LOC budget:** < 2,500 production lines.
2. **Compiler LOC budget:** < 5,000 production lines (as measured by the budget tool; see §3.3 and §14).
3. **Zero runtime DI:** no dependency-injection container in the browser.
4. **Zero runtime template parsing:** compilation is build-time only.
5. **Modern ES target:** ES2022+ output; no legacy transforms.
6. **Pure OOP output:** all runtime and compiled code uses class methods / static namespaces, never lone exported functions.
7. **Source-map requirement:** every compiled file emits a source map. *Shipped caveat: the compiler generates VLQ maps but the Parcel transformer does not yet wire them (§16 D-11).*
8. **LLM testable:** 32B models achieve a high bug-fix rate against compiled output (comprehension scoring to move from heuristic proxies to actual 32B-class models — open, §16).
9. **Universal `this`:** the component instance is always `this` — no `vm`, no `self`, no parameter aliasing.
10. **Semantic hints required:** the compiler emits `[Diamond]` comments in all generated code.

### 3.2 Soft constraints (targets)

Bundle < 20KB gzipped runtime; initial compilation < 3s typical; HMR < 100ms; full TypeScript support with no runtime cost; modern evergreen browsers; O(1) amortized append for large data via `Collection` (the *data structure* meets this; the `repeat` *render* path does not — §16 D-4).

### 3.3 Budget accounting note *(v2.1.1, D-9)*

LOC budgets count **production LOC only** (`src` excluding `__tests__`); test LOC is a separate informational column. This dissolved the false parcel `300/300 WARN` (production was 111/300). The budget tool (`tools/check-loc-budget.ts`) fails **closed** on a `cloc` resolution error. No ceiling changed anywhere.

---

## 4. Component system

### 4.1 File organization

Configurable discovery (`diamond.config.js`) supports `flat` mode (`./components/my-component.{ts,html,css}`) and `nested` mode (`./components/my-component/my-component.{ts,html,css}`). Nested mode uses `component-name.*`, **never** `index.*`, so every open editor tab names its own component (the v1.5.1 fix that eliminated multi-developer filename ambiguity). Scaffolded files carry a `[Diamond]` comment header stating the folder→basename convention.

### 4.2 Canonical component *(rewritten 2.3.0, Lifecycle Contract LC-1/LC-3/LC-4)*

```typescript
import { Component, DiamondCore, reactive } from '@diamondjs/runtime'

export class MyComponent extends Component {
  @reactive name = ''                 // reactive → drives the UI
  @reactive count = 0
  private saved = 0                   // bare → inert bookkeeping

  constructor() { super() }           // the object exists; acquire nothing here

  override constructed() {            // @reactive is live under any toolchain; no element yet
    this.count = 1
  }
  override mounting() {               // about to appear: generation assigned, no template yet
    this.saved = Date.now()
  }
  override mounted() {                // in the document: measure, focus, observe
    this.getElement()?.querySelector('input')?.focus()
  }
  override unmounting() {             // still in the document; the generation is already invalid
    this.saved = 0
  }
  override unmounted() {              // detached, state preserved; may be mounted again
    this.count++
  }

  handleClick() { this.name = 'Updated' }   // `this` is always the component

  // Compiler-generated from my-component.html; written out so the fixture mounts.
  createTemplate(): HTMLElement {
    const div = document.createElement('div')
    const input = document.createElement('input')
    DiamondCore.bind(input, 'value', () => this.name, (v) => (this.name = v as string))
    div.appendChild(input)
    return div
  }
}
```

Key decisions: `@reactive` is the single reactivity declaration (decorated drives the UI; bare is inert — no class-level "YOLO mode"); explicit imports, no constructor injection; **six lifecycle phases, one callback each** — `constructing` (the constructor) → `constructed()` → `mounting()` → `mounted()` → `unmounting()` → `unmounted()`, plus the terminal `faulted` and `disposed` with no callback (§4.4); `extends Component`; `this` is `this` everywhere. The entry points `mount()`, `unmount()` and `dispose()` are final: a subclass that overrides `mount` or `unmount` throws at construction, naming the callback to use instead (LC-3). `update()` is **retired** (LC-4) — props arrive as writes to the component's `@reactive` fields and its own reactivity is the notification.

Constructors acquire nothing and announce nothing: the object exists, nothing else. Route components may accept a single params object in their constructor (§17.3); the no-arg form is the default, not a prohibition.

This block and the one in §4.4 are test fixtures verbatim (`packages/runtime/tests/lifecycle/fixtures/`); a test fails if the spec drifts from them.

### 4.3 The instance-template model

`createTemplate()` is a compiler-generated **instance** method (not a static factory returning a closure). The same `this` appears in the class body and the template — one referent, no `vm`/`self` context-switch. The static-factory pattern was eliminated in v1.5 because it forced two referents for one component (`this.count` in code, `vm.count` in template) to save kilobytes that are negligible for target apps (<50K LOC, 50–200 live instances); `Collection` already handles data scaling.

A standalone template module (§5.8) exports the same instance method as a function of `this`; the class assigns it (`createTemplate = T.createTemplate`). The referent is the same either way.

### 4.4 The `Component` base class contract *(rewritten 2.3.0 — Lifecycle Contract LC-1…LC-16)*

```typescript
type Phase =
  | 'constructing' | 'constructed' | 'mounting' | 'mounted'
  | 'unmounting' | 'unmounted' | 'faulted' | 'disposed';

export abstract class Component {
  protected element: HTMLElement | null;
  readonly phase: Phase;                          // reactive snapshot (accessor) — see the table below
  readonly generation: number;                    // +1 at every mount(), +1 again at every unmount(); a failed mount keeps its increment
  history(): readonly LifecycleRecord[];          // the ring's last 32 records, live (§4.7)
  createTemplate(): HTMLElement;                  // public; throws until compiler-injected or assigned
  mount(host: HTMLElement): void;                 // final
  unmount(): void;                                // final
  dispose(): void;                                // final; terminal
  ensureConstructed(): void;                      // first framework entry; idempotent (mount() and the router call it)
  domPing(): { phase; generation; connected; consistent };   // dev verification: the snapshot against the DOM
  getElement(): HTMLElement | null;
  protected constructed(): void;                  // the five phase callbacks — override these
  protected mounting(): void;
  protected mounted(): void;
  protected unmounting(): void;
  protected unmounted(): void;
  protected registerCleanup(fn: () => void): void;                         // into the mount scope while a mount is open (mounting … unmounting), else the instance scope
  protected whileMounted<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void;   // bound to the current generation
  protected debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void;
  protected throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void;
}
```

> ⚠ `createTemplate()` and `element` are typed `HTMLElement`, but a template with two or more roots returns a `DocumentFragment` (§16 D-23). `adopt(scope)` and `deliver()` are also public on the class, tagged `@internal`: the router and `DiamondCore` call them, and they are not app-facing. `dispose()` is final by contract; the construction-time guard checks `mount` and `unmount`.

**Phases (LC-1).** The names promise states, and each callback runs only when its state holds. The callbacks carry no `on` prefix: `DiamondCore.on(el, event, handler)` already means "event listener", and one concept gets one vocabulary (LC-2).

| Phase | Callback | Promise when the callback runs | DOM |
|---|---|---|---|
| `constructing` | constructor | The object exists. Nothing else: constructors acquire nothing and announce nothing. | none |
| `constructed` | `constructed()` | `@reactive` fields operational under any toolchain emit ([[Define]] fields are repaired here, #11); instance scope current; `getElement()` is null. Exactly once per instance, at the first framework entry (`mount()`, or the router's construction site). | none |
| `mounting` | `mounting()` | Mount scope current; `generation` assigned; no template and no children yet. | none |
| `mounted` | `mounted()` | The managed range is in the document; bindings applied; root-level structurals placed; children's `mounted()` complete (child-first, construction order). | connected |
| `unmounting` | `unmounting()` | Range still in the document when the mount was delivered (an `unmount()` from `mounting` finds it detached); `generation` already invalidated; anything acquired here is disposed before `unmount()` returns. | connected |
| `unmounted` | `unmounted()` | Range detached; mount inventory empty; instance state preserved; remount permitted. | detached |
| `faulted` | — | A cleanup threw, or `constructed()` threw; the inventory cannot be certified empty. Terminal. | indeterminate |
| `disposed` | — | Instance scope closed. Terminal. | detached |

**`mounted` means connected, not visible (LC-5).** A connected element under `display: none` has no box. A child built into a detached parent — a child mounted with `DiamondCore.child`, a child inside an `if` branch or a `repeat` row — stays `mounting` until the parent's **connection drain** reaches it; the drain runs when a component mounts into a connected host and when a structural places a branch into the document. It delivers child components first, in the order `DiamondCore.child` registered them — construction order when children are built in sequence (LC-6) — then branches that were placed while the tree was detached, then root-level structural placements that waited for a parent (§5.4.4). A root mounted into a detached host never reaches `mounted`, and dev builds say so once per class (for a mount outside any scope): root hosts must be connected.

**Two scopes (LC-7/LC-8).** The instance scope exists from construction — a class-field `debounce`/`throttle` registers into it before any framework entry — becomes current at the first framework entry and closes at `dispose()`; it holds those cancels and anything acquired in `constructed()` or `unmounted()`. The mount scope opens per `mount()` and closes at `unmount()` or rollback; it holds the template, the children, the tracked range and anything acquired in `mounting()`, `mounted()` or `unmounting()`. Every framework-owned acquisition — `bind`, `on`, `effect`, `delegate`, `spread`, the structurals, `DiamondCore.child`, tracked ranges, `registerCleanup` — registers into the current scope at creation. Disposal is LIFO, each cleanup in its own `try`: what `mounted()` and `unmounting()` acquired is released first, then the range leaves the document, then everything `createTemplate()` acquired — children, bindings, listeners — in reverse template order; a branch a structural removes is disposed the same way, so a disposed branch is also a detached one. **The boundary (LC-15):** the guarantee covers acquisitions made through framework APIs. A raw `addEventListener`, `setInterval` or fetch the author did not register is outside the inventory.

**Generations (LC-9).** `mount()` increments `generation`; `unmount()` increments it again on entry; a mount that fails and rolls back keeps the increment the attempt used. `whileMounted(fn)` returns a wrapper bound to the generation it was created in: while that generation is current it runs `fn`; afterwards it declines and records `stale`. `debounce`/`throttle` cancels run at `unmount()`; one created in a field initializer or in `constructed()` stays registered in the instance scope, so the class-field one-liner survives a remount, while one created in `mounting()` or `mounted()` lives and dies with that mount:

```typescript
import { Component, DiamondCore, reactive } from '@diamondjs/runtime'

export class Ticker extends Component {
  @reactive seconds = 0

  // Self-registering: cancelled at unmount(), kept for a remount, released by dispose().
  private bump = this.debounce(() => this.seconds++, 1000)

  override mounted() {
    // A callback the inventory cannot cancel is bound to this mount's generation:
    // after unmount() it declines and records `stale` instead of running.
    requestAnimationFrame(this.whileMounted(() => this.getElement()?.scrollIntoView()))
  }

  createTemplate(): HTMLElement {
    const button = document.createElement('button')
    DiamondCore.on(button, 'click', () => this.bump())
    return button
  }
}
```

**First framework entry (`ensureConstructed`).** The first time the framework touches an instance — `mount()`, the router's construction site (§17.2), or `DiamondCore.child` (§4.5) — it re-routes any `@reactive` field a [[Define]]-emitting toolchain left as an own data property (`adoptDefinedReactiveFields`, *2.2.3, #11*; dev builds report the repair once per class), opens the instance scope, transitions to `constructed` and calls `constructed()`. It is idempotent, so a hand-constructed component (`new SourceViewer()` in a field initializer) is covered without a factory.

**Entry-point rules.** `mount()` on an instance that is `mounting`, `mounted`, `unmounting`, `faulted` or `disposed` throws before any transition (supersedes the v2.1.1 double-mount guard, D-6; the faulted message names the cleanup that threw when the fault is the ring's latest record). `unmount()` on an instance that is neither `mounted` nor `mounting` throws (it used to be a silent no-op); an `unmount()` from `mounting` — a root in a detached host, an undelivered child — runs `unmounting()` with the range detached. `dispose()` unmounts if needed and closes the instance scope; it is idempotent, and on a `faulted` instance it releases the instance scope without leaving `faulted`. The router disposes an occupant that leaves for good, structurals dispose a child instance when its branch or row is removed, and app code disposes a root at teardown.

**The override guard (LC-3).** The `Component` constructor throws if the subclass overrides `mount` or `unmount`, naming the replacement callback. This is the migration's fail-loud point: every 2.2.x component that wrote `override mount(host) { super.mount(host); … }` fails at construction, not silently at runtime. Migration: `override mount(host) { super.mount(host); … }` becomes `override mounted() { … }`, and `override unmount() { …; super.unmount() }` becomes `override unmounting() { … }`.

### 4.5 Template component composition *(D-21)* — **proposed for v2.3.1, not shipped**

> **Deferred to v2.3.1 — non-normative.** This section records the composition design brief (decisions C-1…C-10) as revised against the Lifecycle Contract. Each decision is the recommendation, not a ruling; the author rules on them in v2.3.1. In 2.3.0 the 2.2.4 boundary stands: the compiler errors `component-composition-unsupported` on an imported hyphenated tag, and children are mounted imperatively or with `DiamondCore.child` (§4.4).

A parent template instantiates a child component by writing its tag. **Props flow down as one-way writes to the child's `@reactive` fields; events flow up as standard DOM events on the host; there is no implicit event bus.** The runtime seam is `DiamondCore.child` (§4.4, shipped with the Lifecycle Contract); the compiler emits the calls.

- **C-1 Resolution by explicit import.** A hyphenated tag converts to PascalCase and must match an imported name: in the compiler-injected form, the component module's own import; in the standalone form (§5.8), an `@import` directive, which now covers component classes as well as pipe transforms. There is no global registry. A hyphenated tag with no matching import stays a plain custom element, under existing sink gating.
- **C-2 The host stays.** The child's tag remains in the DOM as its host element, and the child's template mounts inside it, exactly as `mount(host)` does. Events, `class` and `style` have a home, and the host is the boundary of the child's range. A custom element is `display: inline` by default; authors style the host.
- **C-3 Command means prop; no command means host attribute.** `compact.set="true"` writes a prop once; `name.to-view="expr"` writes it reactively. Plain attributes — `class`, `id`, `style`, `data-*`, `aria-*`, `role` — land on the host and are gated as today. Prop names are written kebab-case and map to the camelCase field (`parent-name.to-view` → `parentName`), because the HTML parser lowercases attribute names.
- **C-4 Props are one-way.** `.bind`, `.two-way` and `.from-view` on a component tag are errors whose message suggests `.to-view` plus an event. (v1.5.1 wrote `name.bind`, which under v2 grammar means two-way.)
- **C-5 Props are field writes.** Each prop lowers to one effect that writes the child's field — `DiamondCore.effect(() => { child.name = this.parentName })` — whose first run delivers the initial value before the child mounts. No `update()` (LC-4). Template-composed children are constructed with no arguments. Names that would overwrite base-class members — `phase`, `generation`, `element`, `mount`, `unmount`, `dispose`, the five phase callbacks, `history`, `ensureConstructed`, `domPing`, `whileMounted`, `adopt`, `deliver` — are errors as props.
- **C-6 Events up on the host.** The base class gains `protected emit(name, detail?)`, which dispatches a non-bubbling `CustomEvent` on the component's host, so nothing travels past the parent by accident. Parents listen with `item-selected.calls="onSelect($event)"`. The base class therefore keeps a reference to its host, alongside `getElement()` (the template's root).
- **C-7 Refs.** `ref="viewer"` puts the child instance in `this.viewer`. It is set inside `DiamondCore.child`, so it is usable in the parent's `mounted()` (which runs after the children's, LC-6), and cleared when the child is disposed. A `ref` inside `repeat.for` is an error in 2.3.0. *Open: whether `ref` on a plain element holds that element.*
- **C-8 Lifecycle.** Construction, prop effects, `.calls` listeners, then `DiamondCore.child(instance, host)`; the child stays in `mounting` until its parent connects, and is disposed when its parent's mount scope is (§4.4). Under `if`, `switch` and `repeat`, detached means disposed: a hidden child is disposed and a fresh instance is built when it shows again.
- **C-9 No content between the tags.** Non-whitespace children of a component tag are an error (`component-children-unsupported`); whitespace-only content between the tags is syntax (§5.9). Slots are deferred (Appendix F).
- **C-10 No self-closing tags.** `<source-viewer />` is an error (`component-self-closing`). HTML has no self-closing custom elements: the parser treats the tag as an opening tag and every following sibling silently becomes its child.

Compiled output (sketch):

```js
// [Diamond] Component: <source-viewer> → SourceViewer
const el_source_viewer_4 = document.createElement('source-viewer');
const child_5 = new SourceViewer();
this.viewer = child_5;                                   // ref="viewer"
// [Diamond] Prop: compact ← true (set)
child_5.compact = true;
// [Diamond] Prop: offset ← this.focusStart
DiamondCore.effect(() => { child_5.offset = this.focusStart; });
// [Diamond] Event binding: confirmed → this.clearNow()
DiamondCore.on(el_source_viewer_4, 'confirmed', (e) => this.clearNow(e));
DiamondCore.child(child_5, el_source_viewer_4);
```

Imperative mounting remains available for children a template cannot describe: construct, then `DiamondCore.child(instance, host)` from the parent's `mounting()` or `mounted()`.

### 4.6 Failure and recovery *(new 2.3.0, LC-7/LC-10/LC-11/LC-12)*

Rollback is by inventory, not by snapshot: whatever a failed transaction acquired is in a scope, and recovery is that scope's `dispose()`. There is no mutation journal and no value rollback. Disposal is total and LIFO — each cleanup in its own `try`, failures collected and never thrown mid-dispose; if any cleanup threw, the instance becomes `faulted` (LC-10). A throw in `unmounting()` or `unmounted()` is recorded as `callback-failed` and teardown continues (LC-12); what faults an instance is a cleanup failure during a dispose, or a throw in `constructed()` (the instance scope is disposed; cause `construct`). When a cleanup throws during `unmount()`, `unmounted()` is not called. A cleanup failure inside a structural branch is reported (⚠ §16 D-26) and faults no instance: the branch has none, and the enclosing component stays mounted.

| Transaction fails during | Dispose removes | Destination |
|---|---|---|
| constructor, via the router | What the constructor registered (a construction scope of its own) | no instance |
| constructor of a child built inside a parent's `createTemplate()` (then `DiamondCore.child`) | The parent's whole mount — the child was constructed under the parent's mount scope | parent: `constructed` / `unmounted` |
| `constructed()` | Everything in the instance scope | `faulted` |
| `mounting()` | What the callback acquired | `constructed` / `unmounted` |
| `createTemplate()` at acquisition N | Partial bindings, children, anchors; nothing was inserted | `constructed` / `unmounted` |
| `appendChild` into the host | Bindings, children; range removal is a no-op | `constructed` / `unmounted` |
| `mounted()` | The range out of the document; all effects and listeners | `constructed` / `unmounted` |
| a child's `mounted()` under a structural | That branch — its range and inventory; the parent stays mounted and interactive | parent unchanged |
| a child's `mounted()` directly under a parent | The parent's whole mount (the child has rolled itself back first) | parent: `constructed` / `unmounted` |
| `unmounting()` | Nothing — recorded as `callback-failed`; teardown continues | `unmounted` |
| a cleanup during dispose | The remaining cleanups still run | `faulted` |
| `unmounted()` | Nothing — recorded | `unmounted` |

A failed first mount returns to `constructed`; a failed remount returns to `unmounted`, state preserved and `generation` keeping the attempt's increment. The error is rethrown unchanged to the caller. `faulted` and `disposed` are terminal (LC-11): `mount()` on either throws before any transition, and recovery is a fresh instance, never a repair call. The router's part is in §17.2.

### 4.7 The lifecycle record *(new 2.3.0, LC-13/LC-14)*

**Ring and snapshot are one write (LC-13).** Every transition appends one `LifecycleRecord` to the instance's ring of 32 and writes the reactive `phase` from that record (`generation` is incremented on entry to `mount()` and `unmount()` and copied into the record), so effects may read them and `fold(history())` equals the snapshot.

```typescript
type Cause = 'construct' | 'mount' | 'connect' | 'unmount' | 'dispose' | 'stale' | 'callback-failed';

interface LifecycleRecord {
  seq: number;           // global, monotonic across every instance
  t: number;             // performance.now() at the transition
  instance: number;      // runtime-assigned instance id
  generation: number;
  from: Phase;
  to: Phase;
  cause: Cause;
  outcome: 'ok' | 'failed' | 'faulted' | 'stale';
  error?: unknown;
  failures?: ScopeFailure[];
}
```

`fold(history)` returns `{ phase, generation }` — the last record's destination, or `{ phase: 'constructing', generation: 0 }` for an empty ring. A `stale` wrapper call and a `callback-failed` teardown throw are self-records — `from` and `to` are the current phase — and take ring slots like any transition; `callback-failed` carries outcome `failed`. `history()` returns the live ring, so a caller that wants a snapshot copies it.

> ⚠ `fold` ships as a standalone exported function, which §3.1 #6 forbids in runtime code (§16 D-24).

**`domPing()`** (dev verification) returns `{ phase, generation, connected, consistent }`: `mounted` holds exactly when every node of the managed range is in the document, `mounting` when it is not yet, and a detached phase exactly when there is no element and no mount scope; `unmounting` and `faulted` are not checked (`consistent` is true). The test harness runs it after every test.

**Emission through `Print` (LC-14).** Failed transitions emit `FAILURE`, faults `CRITICAL`, stale callbacks `WARNING`; successful transitions emit `STATE` in dev builds only. The ring records regardless.

---

## 5. Template DSL

This chapter defines the complete v2.3.0 template grammar. The before/after token reference against v1.5.1 is in Appendix A.

### 5.1 Attribute binding grammar

Bindings are **attribute-based and element-scoped**, not statement-based. An attribute name is split on `.` into **2 or 3 segments**:

- **2-segment** `property.command` — e.g. `value.set`, `value.bind`, `value.to-view`, `value.from-view`, `value.two-way`, `value.rawSet`, `click.calls`, `panel.capture`.
- **3-segment** `property.command.qualifier` — the raw *directional* escape hatch: `innerHTML.rawBind.to-view`, `innerHTML.rawBind.from-view`, `innerHTML.rawBind.two-way`.

> **parse5 lowercases attribute names.** `innerHTML.rawBind.to-view` reaches the compiler as `innerhtml.rawbind.to-view`. The camelCase legibility of `rawBind`/`rawSet` is a **source-only affordance**; the property segment is restored to its camelCase DOM name through the runtime's `PROPERTY_NAME_MAP` (§6.3: lowercased author input maps to the canonical property name; for the gate alone a static `class` reads as `className` and `for` as `htmlFor`) and command matching is lowercase-keyed. Internally a binding is `{ type, raw }` where `type` is the operation and `raw` is a boolean — the source surface stays three-segment; flattened tokens like `rawTo-view` never exist.

> ⚠ The shipped parser also accepts the non-raw three-segment spellings `property.bind.to-view`, `.bind.from-view` and `.bind.two-way` as synonyms of the two-segment commands; this grammar does not define them (§16 D-27).

The operations:

| Command | Meaning | Reactive? | Sink-gated? |
|---|---|---|---|
| `.set` | static one-shot assignment (`el[prop] = value`), no reactivity | no | yes (outbound) |
| `.rawSet` | `.set` to a non-allowlisted sink, developer-owned, audited | no | yes (declared) |
| `.bind` | two-way binding (getter + setter) | yes | yes (outbound) |
| `.to-view` | one-way model → DOM | yes | yes (outbound) |
| `.from-view` | one-way DOM → model | yes | **no** — inbound leg, see §5.1.1 |
| `.two-way` | explicit two-way (synonym of `.bind` for value-like props) | yes | yes (outbound) |
| `.rawBind[.dir]` | raw counterpart of `bind`/`to-view`/`from-view`/`two-way` | yes | declared (outbound dirs) |

`.set` is deliberately named a **set**, not a binding — it is a static assignment with no reactivity, and reactive-over-static being free means there is no `if.set`-style one-time variant of anything reactive. Unknown or retired commands (`one-time`, `trigger`, `delegate`, typos) are **hard errors**, never a silent `bind` fallback — fail-open is unacceptable in a security release.

#### 5.1.1 `from-view` is genuinely one-directional

`from-view` emits `DiamondCore.bind(el, prop, undefined, setter)` — **no getter**, so no model→DOM effect is created and the model can never reach the sink. This corrects a Phase-1 bug where `from-view` was silently wired two-way (the runtime unconditionally ran a to-view getter effect), which would have let a websocket/sibling model write reach e.g. `innerHTML` unvalidated. Because it carries no outbound sink write, `from-view` is **excluded from the outbound `SinkOp` set** and is not compile-time gated; its inbound risk is covered by the runtime smell check (§6.6). Its `raw` flag (`rawBind.from-view`) is preserved as the inbound escape hatch. *A one-way-named flow must never permit the opposite flow.*

### 5.2 Interpolation

`${expression}` interpolation is supported in **text nodes**. The compiler extracts interpolations with a brace-depth scanner (`scanInterpolations`) that correctly handles `}` inside pipe args and reports `unterminated-interpolation` on an unclosed brace. Text interpolation lowers to a `textContent` binding over a template literal:

```js
// [Diamond] Text interpolation: Hello ${name}!
DiamondCore.bind(text_1, 'textContent', () => `Hello ${this.name}!`);
```

**Attribute interpolation is diagnosed, not supported** *(v2.1.1, D-3)*. A `${` in a plain static attribute value is the `attr-interpolation-unsupported` error, whose message suggests the concatenation form: `title.to-view="'Hello ' + name"` (or a getter). Supporting attribute interpolation remains a future decision (Appendix F).

#### 5.2.1 Literal `${` *(2.2.4, #29)*

**Literal `${`.** In template text and in plain attribute values, interpolation syntax is recognized only where the source literally contains it: the `${` opener, its closing `}`, and a run of backslashes directly before a `${`. A character reference is never syntax — `&#36;{`, `$&#123;` and their named forms are text. A backslash run before `${` reads by the JavaScript rule: each pair is one backslash, and an odd backslash left over makes the `${` literal text. A backslash anywhere else is text. Static text and expression bodies are then decoded exactly as HTML decodes them. The compiler reports each `\${` as an `escaped-interpolation` info diagnostic.

| Source | Renders |
|---|---|
| `${name}` | value of `name` |
| `\${name}` | `${name}` |
| `\\${name}` | `\` + value of `name` |
| `\\\${name}` | `\${name}` |
| `C:\temp\notes` | `C:\temp\notes` |
| `a\\b` | `a\\b` |
| `&#36;{name}` (and `&#x24;{`, `&dollar;{`, `$&#123;`, `$&lbrace;`) | `${name}` |
| `&#92;${name}` | `\` + value of `name` (an encoded backslash is never an escape) |

The rationale, carried from #29: an encoded character is never syntax — HTML's own rule (an encoded `<` is never a tag) applied to DiamondJS's one piece of syntax in text; `\${` is the spelling every JavaScript developer and model already reads as "escaped"; the escape is context-free; and the one case whose rendering changes — a Windows path followed by an interpolation, `C:\Users\${user}` — shows on screen immediately and is named by the `escaped-interpolation` message, which suggests `\\${`. An entity can only make text more literal, never create an interpolation, which also closes the path where HTML-encoded untrusted text spliced into a template was decoded back into a live interpolation. Bound values and `raw` content are inserted as data and never scanned; compiling untrusted text as a template remains template injection, and no escape syntax changes that.

Templates generated from JavaScript: a template literal consumes one backslash, so emitting this escape takes `\\\${`. `String.raw` passes it through one-to-one: ``String.raw`<p>Use \${x}</p>` `` → `<p>Use \${x}</p>`.

The same rules hold in plain attribute values, so `placeholder="e.g. \${HOME}"` can be written. A real `${` in a plain attribute is still `attr-interpolation-unsupported`. Binding and structural attribute values are expressions and are not scanned.

#### 5.2.2 Author text is literal in compiled output *(2.2.4, #19)*

A backslash in template text or an attribute value is a literal character (except in a run directly before `${`, §5.2.1). Every piece of author text written into compiled output — static text, the literal parts of interpolated text, attribute names and values, and the expressions echoed in hint comments — is encoded for the position it lands in, so no author character becomes a JavaScript escape sequence or ends a comment. Static and interpolated text follow the same rule.

### 5.3 Pipes & template formatting/parsing

#### 5.3.1 The pipe

`|` is a **Unix pipe**, not an Aurelia "value converter" resource: left is data, right is a transform, output flows through. `${value | parseRaw | clamp | formatPercent}` lowers to `formatPercent(clamp(parseRaw(this.value)))` — pure function composition, zero framework concepts. The non-obvious payoff is that the pipe makes "this token is a transform" *syntactically* true, so the format/parse pairing audit (§5.3.3) is trivial rather than requiring static analysis of arbitrary expressions. Pipe heads are classified by casing: **PascalCase → converter class** (`.format`/`.parse` static methods); **camelCase → plain function**.

#### 5.3.2 Converter classes (template formatting/parsing methods)

A converter is one class bundling two static methods:

```typescript
class CurrencyConverter {
  static format(value: number, currency: string): string;             // number → string
  static parse(raw: string, currency: string): ParseResult<number>;   // string → validated number
}
```

`format`/`parse` name the real operation (unlike Aurelia's frame-relative `toView`/`fromView`, and unlike `set`/`get` which collides with §5.1). Static methods, not instances — the class is a namespace so the pair cannot drift; compiled output is `CurrencyConverter.format(this.amount, 'USD')`, bare, no allocation. Arguments use **parens** and thread to *both* legs identically (`CurrencyConverter('USD')` → `format(v, 'USD')` and `parse(raw, 'USD')`), giving round-trip consistency for free. Parens are sugar for additional static-method arguments — **not** construction (`new` would reintroduce per-binding allocation).

The `transform_functions/` convention folder is **deleted**: the import graph is the registry. A converter lives wherever it is imported from; the compiler follows that import to verify the method pair.

#### 5.3.3 Contextual parse obligation

Enforcement is contextual, not universal:

- A converter's `format` on the **outbound leg of a two-way binding** requires a `parse` in the same class → **hard compile error** (`converter-missing-parse`) if missing.
- `format` in interpolation / one-way binding has no inbound leg → no parser required. **One method, or no class.**

This closes a silent-corruption class: a tolerant formatter is idempotent on its own output, so a two-way binding with no parser makes the demo look correct while the model silently holds the wrong *type* (currency string over a number, formatted phone over canonical, wall-clock string over a UTC instant). You cannot reliably catch a non-throwing corruption at runtime; you catch it at compile time by requiring the parser to exist.

Obligation resolution follows the import graph, including **named re-exports** (with `as` aliasing) and `export * from` barrels, cycle-guarded to a **3-hop** depth cap; a barrel-resolved module missing `static parse` hardens to `converter-missing-parse`. Package-specifier hops stay a soft `converter-unresolved` info. The check verifies the method *exists* (`/static\s+parse\b/`), not its signature — TypeScript checks arity when the module type-checks. This is the string compiler's accepted ceiling.

#### 5.3.4 `ParseResult<T>` and validation-in-parse

Parse already had to validate (you cannot convert `"abc"` to a number without deciding it isn't one). Making that explicit gives DiamondJS its client-side validation story:

```typescript
interface ParseResult<T> {
  valid: boolean;
  value: T | null;
  raw: string;          // the user's in-progress text — never clobbered
  error: string | null; // v2: renders directly; structured {code,message} is a future i18n seam (§16)
}
const ParseResult = {
  ok<T>(value: T, raw: string): ParseResult<T>,
  fail<T = never>(raw: string, message: string): ParseResult<T>,
};
```

From-view runtime semantics: `valid: true` → write `value` to the model; `valid: false` → **do not write** (model keeps its last good value), **keep `raw` in the input** (never clobber mid-type text), expose `valid`/`error` to the validation surface. Parse owns **type/format** validity only ("is this a valid currency string"), not business rules ("amount < $10,000") — those live in the component, or the battery stops being reusable. A plain camelCase function on the `from-view` leg is legal and is the unvalidated path: the setter writes `fn(v)` to the model directly. Validation needs a converter.

#### 5.3.5 Multi-segment two-way inversion

A two-way pipe chain is legal **iff every segment is a PascalCase converter**. The getter composes `format` left-to-right; the setter composes `parse` **right-to-left** (`rN…r0`, numbered by segment index), each step's `ParseResult` checked **fail-fast** — the model stays untouched (raw text preserved) unless every step is valid:

```js
() => C.format(B.format(A.format(this.amt, 'x'))),
(v) => {
  const r2 = C.parse(v);
  if (!r2.valid) { this.err = r2.error; return; }
  const r1 = B.parse(r2.value);
  if (!r1.valid) { this.err = r1.error; return; }
  const r0 = A.parse(r1.value, 'x');
  this.err = r0.valid ? null : r0.error;   // cleared on full success
  if (r0.valid) this.amt = r0.value;       // model written only when all valid
}
```

One plain (camelCase) function anywhere in the chain poisons it → `pipe-two-way-noninvertible` (hard error). One `parse` obligation is emitted **per segment**, so §5.3.3 covers the whole chain. `from-view` stays **single-transform** (`pipe-fromview-multi` for ≥2). (The former `pipe-two-way-multi` diagnostic is **retired** — a clean multi-converter chain is now legal.)

#### 5.3.6 `error-into` — the validation-error rendering surface

`property.error-into="targetProp"` is a property-scoped companion attribute (mirrors `update-on`; parse5-safe). The emitted setter writes `target = r.valid ? null : r.error`; in a chain, the **first failing step's error wins**, cleared to `null` on full success. The target is ordinary reactive state — rendering it is plain `${amountError}` / `if="amountError"`, no new machinery. Diagnostics: `bare-error-into`, `bad-error-into`, `error-into-no-binding`, `error-into-not-inbound`, `error-into-no-converter`.

### 5.4 Structural directives

Template control flow is **attribute-based and element-scoped**: the element's own open/close tags are the body delimiters; there is no `endRepeat`/`endIf` terminator because the DOM is already a bounded tree.

**Detached means disposed** *(v2.1.1, D-1)*. All three structural directives (`if`, `switch`, `repeat`) dispose a detached subtree eagerly — node removed, captured cleanup invoked — and rebuild from `make()` on re-activation. Lazy building stays; there is no branch cache. The cache traded a bounded rebuild for unbounded hidden work plus a second disposal semantic; one disposal rule beats a micro-optimization, and the keep-node/dispose-effects hybrid was rejected as a third.

#### 5.4.1 `if` / `else-if`

`if="condition"` **conditionally includes the element in the DOM** (removes it entirely when false — not `display:none`). Bare `if`, no suffix: `if` has no sink (the boolean never flows into the DOM as content → no injection surface → no `raw` variant, and `rawIf`/`if.set`/`if.bind` are all errors), and `if` is always reactive. `if` is a JS reserved word, so it cannot collide with a property named `if` — which is also how the parser recognizes the structural form.

`else-if="condition"` is retained; **bare `else` is removed** (`bare-else-removed` error). Bare `else` is a valueless positional marker whose pairing must be resolved by scanning upward through arbitrary nesting — a whole bug class with no compile-time signal (the structured-programming argument restated for template DSLs). `else-if` survives because its condition is self-describing: a model reading `<div else-if="hasError">` knows the meaning without lookback. The catch-all case is written as an explicit standalone negated `if` (`if="!isLoading && !hasError && !isReady"`), which documents the asserted state space and breaks loudly when a new state is added — strictly more informative than "none of the above." For exhaustive multi-state with a guaranteed catch-all, use `switch` (§5.4.3).

**Chain whitespace** *(2.2.4, #18)*. Whitespace between an `if` (or `else-if`) and the `else-if` after it is syntax, consumed only when an `else-if` actually follows; whitespace after the last branch of a chain is content. Only ASCII whitespace separates branches: a non-breaking space between an `if` and an `else-if` is content, so the `else-if` is orphaned (`orphan-else-if`).

Lowering: `DiamondCore.if(anchor, branches)`, where each branch is `{ when, make }` in source order and the first true `when` wins. The compiler emits only authored branches; hand-written code may end the array with `when: () => true` as a catch-all.

#### 5.4.2 `repeat.for`

```html
<li repeat.for="user of users">${user.name}</li>
```

The one and only looping construct — no `while`, no `repeat-until`, no `forEach` variant. Lowering: `DiamondCore.repeat(anchor, itemsGetter, makeItem)`. Reconciliation **keys on item identity** for objects (which is why `Collection` never proxies its items — a proxy wrapper would break keying and the `itemRegistry` that `delegate` resolves through). Primitives key by **typeof-prefixed value plus a per-pass occurrence index** *(v2.1.1, D-2)*, so duplicate strings or numbers each get their own row. A reactive array re-renders on in-place mutation as well as on reassignment (§7.1, *2.2.4, #26*).

> ⚠ The render path **re-inserts every node on every update** (O(n) DOM mutations per change), so the "O(1) append" property belongs to `Collection` the data structure, not to the render (§16 D-4).

#### 5.4.3 `switch` / `case` / `default`

```html
<switch on="status">
  <case if="loading"><div>Loading…</div></case>
  <case if="progress > 0.5"><div>${pct}</div></case>
  <default><div>Unexpected: ${status}</div></default>
</switch>
```

`switch` supplies the **explicit, visible scope container** that bare `else` lacked: a `default` inside a `switch` is walled off by its container and never scans upward, so nesting is unambiguous. Semantics:

- **`on="expr"`** is evaluated **exactly once per update**, then tested against case predicates in **document order; first match wins**. The default occupies the final slot.
- **`<case if="…">` classification:** a quoted string / number / `true`/`false`/`null` or a **bare identifier-shaped word** (dashes allowed) is **equality** (`v === literal`; bare words are **string** equality); anything with operators/spaces/dots/parens is a **boolean expression** over component state. Consequence: a dotted path like `if="user.role"` is an **expression (truthiness)**, not equality. Expression cases **cannot see the on-value** (no `$value` alias).
- **`<default>` must be the last child** (`switch-default-not-last`); at most one (`switch-multiple-default`).
- **Full erasure:** all three elements are compile-time erased — no DOM container ships; a multi-root case body is built as one `DocumentFragment` and mounted and removed as a range (§5.4.4). Any attribute beyond `switch[on]` / `case[if]` is an error (the elements have no DOM target).
- **Whitespace directly inside `<switch>`**, between cases, is syntax — ASCII whitespace, the class (a) and (c) use (§5.9); non-whitespace text there is `switch-bad-child`. ⚠ Shipped 2.3.0 tests it with JavaScript's `trim()`, so a non-ASCII space there is consumed too (§16 D-28).

**Lowering (runtime `DiamondCore.switch`, plus a compile-time fast path):** reactive `on=` lowers to `DiamondCore.switch(anchor, onGetter, cases, defaultMake?)`, mirroring `if()` (lazy `captureScope` builds; detached means disposed). The **static fast path** applies iff `on=` is a **pure literal** AND every case is equality-kind — then only the winning branch's DOM code is emitted, zero runtime cost. A statically-dead switch (static `on=` matching no case, no `<default>`) emits a **`switch-static-dead` warning** plus an inspectable DOM comment carrying the dead source — never silently dropped. Because stink-check routes on severity *(v2.1.1, D-8)*, that warning fails the stink-check merge gate; it does not stop a local build.

#### 5.4.4 Mounted ranges and placement *(2.2.3 #7; 2.2.4 #17; 2.3.0 Lifecycle Contract, #38)*

**A body is a range, not a node.** A component template, an `if` branch, and a `case`/`default` body may each have several roots, and a body whose root is itself a structural places its output *before* that structural's anchor. Each is therefore mounted and removed as a **range**: `DiamondCore.trackRange(body, stop?)` returns the node to insert and a `remove` that walks the siblings as they stand at removal time, from the range's first node up to its last node, the owning anchor, or the end of the parent. `if()` and `switch()` remove a branch's range and then dispose its scope; a component's mount scope disposes LIFO, so its range leaves the document first (§4.4).

**The start marker.** A body that **begins with** a structural directive (`if`, `repeat.for`, a reactive `<switch>`) mounts behind one empty comment, `<!---->`, that fixes the start of its range. Nothing else gains a node: single element/text roots, static multi-root bodies, empty-case and dead-switch placeholders mount without one. Under preserved text (§5.9) most bodies begin with a whitespace text node, so the marker appears only where a body's first node is itself a structural.

**First-mount placement.** The compiler appends a structural's anchor to its parent **before** it emits the `DiamondCore.if/switch/repeat` call, so every nested structural renders synchronously on the first pass. A structural whose anchor is still detached at its first pass — one at a template's root, or one in hand-written code — defers its placement. Inside a component the deferred placement registers with the owning scope and runs in the connection drain (§4.4), before `mounted()`, so a page whose template root is an `if` has its branch in the document when `mounted()` runs and when the router looks for a hash target after commit (§17.9). With no scope (hand-written code outside any component) the placement runs on the next microtask.

### 5.5 Events

Two commands, both naming what they do without a misleading actor:

```html
<button click.calls="save()">      <!-- bubble phase (default) -->
<div panel.capture="intercept()">  <!-- capture phase -->
```

`.calls` (not `.trigger`): "click **calls** save" reads left-to-right subject-verb-object with the event as grammatical subject — the correct causation direction. `.trigger` implied framework-as-actor; `.triggers` collides with jQuery's *dispatch* sense (a model with jQuery in weights hallucinates a conflict); `.on` is correct but reads as idiom rather than prose. `.capture` is its own command (not a modifier) — the event capture phase is a real DOM primitive with no other access path, semantically distinct enough from default-phase to warrant explicitness. Both lower to `DiamondCore.on(el, event, handler, capture?)` (`addEventListener`); neither is sink-gated (no sink write). The handler expression is a method call whose arguments are expressions over the component; `$event` names the DOM event, so `change.calls="pick($event)"` lowers to `(e) => this.pick(e)`, and an expression that is not a call lowers to a zero-argument arrow over it. Event hints are the one family that prints the `this.` prefix (`click → this.save()`).

The Aurelia `.delegate` event-command is **removed** (`delegate` is a hard parse error suggesting a per-node `.calls`). Note the name is simultaneously *retired template grammar* and a *live runtime API* — see §9.

### 5.6 Attribute spread

```html
<input type="text" ...attrs.bind="myGuts">
```

Only two forms exist; anything else is `bad-spread`. The compiler emits `DiamondCore.spread(el, () => expr[, true])` in **attribute source order** relative to sibling bindings (mount-time "source order wins"; after mount, standard reactive last-effect-wins). Per key at runtime: **gate FIRST** (canonicalize, then `SAFE_SINKS` ∪ inert metadata — `data-*`, `aria-*`, `role`; unknown keys fail closed with a warn-once `Print('WARNING')`, prod-visible — §12.5), **branch SECOND** (`canonical in el` and not inert metadata → property; else `setAttribute(String(value))`, or `removeAttribute` on nullish). Security stays orthogonal to precedence: source order picks *which value*, the allowlist picks *whether it is allowed at all* — so `{type:'password'}` wins over `text` by order while a co-occurring `{onclick}` fails closed. `...attrs.rawBind` bypasses the runtime gate entirely (developer owns every key) and emits a heavy `stink:declared`. Key-removal reconciliation restores property keys to their pre-spread snapshot and removes attribute keys; the reactive proxy gains `ownKeys` + `deleteProperty` traps (an `ITERATE_KEY` sentinel) so key add/delete on a spread source retriggers.

### 5.7 Binding timing & handler timing

The two concerns Aurelia overloaded onto `&` are cleaved:

- **Binding-update timing** — *when a two-way binding samples the DOM* — is `property.update-on`, property-scoped in the `property.command` grammar: `<input value.two-way="amount | Currency('USD')" value.update-on="blur">`. Bare `update-on` is an error (ambiguous on multi-binding elements). It lowers to the 5th `eventName` argument of `DiamondCore.bind`, applied only to the inbound listener. A *validating* parser wants `update-on="blur"` (per-keystroke validation of mid-type text is hostile).
- **Handler timing** — *debouncing a handler* — leaves the template for visible class code: `handleInput = this.debounce(v => this.query = v, 500)` (§4.4). The common real-time case picks the right half automatically: a debounced search wants the *model* live and the *side-effect* debounced.

`&` is **gone, not relocated.** A lone `&` (not `&&`) anywhere in a binding/interpolation/spread expression is a **hard error** (`ampersand-removed`), and this includes bitwise `&`: a template is a declarative binding surface, not a computation surface (there is no legitimate bitwise `&` in a binding any more than in a SQL `WHERE` or CSS selector). Both bitwise and behavior-`&` should leave the template; the diagnostic redirects both (bitwise → view-model getter; behavior → `update-on` / `this.debounce` / a reactive dependency). Softening this to a warning was rejected — softening a security-adjacent error is how holes open. Aurelia's `signal` maps to *making the dependency reactive* (no hidden re-eval trigger); `oneTime` maps to `set`.

A `<select>`'s bindings and handlers are wired **after** its `<option>` children, including `repeat.for`-generated ones, because `value` needs the options to exist *(2.2.3, #9)*.

### 5.8 Standalone templates & `@import`

A standalone `.diamond.html` compiled to a module cannot import a named pipe transform (its only import is `DiamondCore`), so uncovered pipe heads error `pipe-transform-standalone`. The `@import` directive supplies provenance from the raw template text:

```html
<!-- @import { CurrencyConverter, Trim } from './converters' -->
```

**v1 restrictions:** named imports only — no aliasing, no default/namespace forms; malformed `@import`-shaped comments error loudly (`bad-import-directive`); duplicates error (`import-directive-duplicate`); unused names are info (`import-directive-unused`). The Parcel wrapper emits the directives as real import lines (specs resolve relative to the asset), `pipe-transform-standalone` fires only for **uncovered** heads, and §5.3.3 obligations are verified against the synthesized imports via the public `DiamondCompiler.verifyObligations()`. `with` is not part of this or any grammar — it was removed outright (TypeScript rejects the `with` statement, strict-mode throws, and a template `with` reproduces exactly the non-local-scope confusion the keyword is reviled for); the one legitimate need (deep repeated access) is a view-model getter.

### 5.9 Template text and whitespace *(2.3.0, #15 — closes D-22)*

**Template text is kept exactly as the HTML parser produces it.** The compiler does not collapse, trim or drop content whitespace, and static and interpolated text follow the same rule. Collapsing whitespace is CSS's job at render time, as in any browser. There is no compiler option for this.

Whitespace consumed as **syntax** is exactly:

- **(a)** between an `if`/`else-if` and an `else-if` that follows it — only when one follows, and only ASCII whitespace (§5.4.1);
- **(b)** directly inside `<switch>`, between cases — ASCII whitespace, as (a) and (c) (§5.4.3; ⚠ D-28);
- **(c)** a whitespace-only text node that would be the first or the last root of a component template — the indentation around the markup. A component's template mounts inside its host (§4.4), so the whitespace around a component's tag belongs to the parent template and is kept there. Only a whole whitespace-only node is consumed: a text root with content keeps its own edges, a trailing line break included, and whitespace between roots is content;
- **(d)** with composition (v2.3.1): whitespace-only content between a component tag's open and close tags (§4.5 C-9, proposed). In 2.3.0 a hyphenated tag is a plain element, and its content is content.

Everything inside an element is content — `<case>` and `<default>` bodies included. NBSP, narrow and thin spaces, tabs and line breaks are kept as written; parse5's own normalization (the single newline HTML drops after `<pre>` and `<textarea>`, CRLF → LF) is the only normalization. Punctuation adjacency and intentional word fragments are kept: `un<em>break</em>able` and `<strong>Stop</strong>!` acquire no space. An HTML comment is not emitted, and the text on either side of one is a single run — what the markup holds once the comment is gone.

**The lossless property (normative).** For every template, the text nodes of the compiled DOM equal, character for character, the text nodes of the same markup parsed as plain HTML with the directives removed and adjacent text nodes merged (§13.6).

**Behaviour change, recorded.** Indented inline-block siblings — buttons, inputs, links on separate lines — gain the normal HTML gap between them unless their parent is flex or grid (whitespace-only text between flex or grid items is not rendered). Source written with no whitespace between the tags stays flush. Rejected alternatives are in Appendix E.

---

## 6. Security model

The heart of v2.0, carried whole into v2.3.0. The work that triggered the entire refactor: a security PR addressing XSS via DOM sinks, escalated into a system-wide audit so *every* surface gains security-by-default with an audited `raw` escape hatch.

### 6.1 `raw`, not `unsafe`

The escape hatch is `raw` (`rawSet`/`rawBind`), not `unsafe`. `unsafe` is a **verdict** ("you are doing something wrong") — but a `rawSet` to a trusted constant isn't wrong. `raw` is a **description** — unprocessed, unescaped, developer-responsible — accurate across the whole range from "fine" to "XSS hole," and it reads as a verb-modifier (`rawSet`) where `unsafeBind` reads as an accusation.

### 6.2 Allowlist inversion

The original PR was blocklist-shaped and already caught failing open (`outerHTML` wasn't in the property map, silently no-op'd, and would slip a naive list). The model is **inverted** to enumerate the *safe* sinks:

- On the list → clean output, no stink.
- Not on the list → requires `rawSet`/`rawBind`, emits `stink:declared`.
- Novel / unknown → fails **closed** (treated as raw).

Ignorance fails to raw rather than to allowed. The `outerHTML`-class gap becomes impossible by construction.

### 6.3 `SAFE_SINKS` — the allowlist (37 entries, canonical)

The canonical set lives in `packages/runtime/src/security.ts` (the spread gate made it load-bearing at runtime; two copies would be two audit points). The compiler imports and re-exports it (public API unchanged), gaining a runtime package dependency (acyclic; the build orders runtime first).

```
text:              textContent, innerText
value / state:     value, valueAsNumber, valueAsDate, checked, selected, selectedIndex
class:             className
boolean UI:        disabled, readOnly, required, hidden, multiple, open
numeric scalars:   tabIndex, maxLength, minLength, rowSpan, colSpan, scrollTop, scrollLeft
text descriptors:  placeholder, title, alt, label, htmlFor
constrained tokens: type, name, accept, autocomplete, inputMode, step, min, max, pattern, id
```

> **This list is design-derived and unrefined, not empirically hardened.** It is byte-for-byte the Phase-1 starter set; the "refine empirically" step (the allowlist probe against NetPad, recorded under D-14) has **not** happened (§16 D-14). Describe it accordingly. Four candidates surfaced by the first application — `rows`, `cols`, `list`, `for` — are recorded for ratification and not on the list.

**Off-list** (require `raw`, fail closed): `innerHTML`, `outerHTML`, `srcdoc`, `href`, `src`, `srcset`, `action`/`formAction`, `style`/`cssText`, all `on*`, and everything unenumerated. `srcset`, `action`, `formAction` and `cssText` carry dedicated fail-closed regression locks *(v2.1.1, D-20)*. `href` is deliberately off-list — SPA links use a static `href` attribute plus the router's click interceptor (§17.9), never a dynamic `href` bind.

**The static link exception** *(2.2.3, #8)*. A **static** `href` on `<a>` or `<area>` whose literal target is scheme-less or carries `http`, `https`, `mailto` or `tel` gates clean — the link pattern above depends on it. Whitespace and control characters are stripped before the scheme test. `javascript:`, `data:` and every unenumerated scheme still warn; a *bound* `href` still warns; `href` stays off the allowlist.

`PROPERTY_NAME_MAP` is a **canonicalizer, not an allowlist**: it maps lowercase author input to canonical property names (`innerhtml → innerHTML`), and it deliberately contains *dangerous* names so a lowercase-authored `innerhtml` canonicalizes to the exact name the gate rejects and the diagnostic names correctly. Map membership is not blessing. Any safe sink whose camelCase differs from lowercase must appear in the map or it fails closed as a false positive; the invariant `map[lowercase(sink)] === sink` is tested, normatively, in both the runtime and the compiler suites *(v2.1.1, D-15)*.

**Inert metadata** — `data-*`, `aria-*` and `role` *(role: 2.2.3, #8)* — passes the gate as inert at both the runtime spread gate and compile-time `gateSink` (`isInertMetadataKey`; `isDataOrAriaKey` is unchanged and excludes `role`): never parsed as HTML/script/URL. Spread writes all three through the attribute branch; a `set`/`bind` on `role` — no dash, so a DOM property — writes the `role` property, which reflects the attribute. Inbound ops on dashed names error (`attr-binding-outbound-only`): there is no DOM property to sample. Other dashed names still fail closed.

### 6.4 Coverage map — three threats, three mechanisms

| # | Threat | Mechanism | Where |
|---|---|---|---|
| 1 | Outbound sink writes, statically-known target | Compile-time allowlist gate at codegen | Single choke point upstream of runtime path divergence; covers `set`/`rawSet`/`bind`/`rawBind` and static attributes *(v2.1.1, D-10)* (see D-13 for the `from-view` exemption) |
| 2 | Outbound sink writes, statically-unknown target (attribute spread) | Runtime allowlist gate inside the emitted loop | Dynamic keys are unknowable at compile time |
| 3 | Inbound model writes carrying display-formatted strings | Runtime proxy `set`-trap smell check | The value is only knowable at runtime (§6.6) |

The compile-time gate is a **permission/audit decision, not a transformation**: the emitted bytes for `innerHTML` are identical declared vs. undeclared. "Fails closed" means *blocked at merge/publish by the stink gate*, not *neutered at runtime*. You cannot make `innerHTML` safe with code — only with a declaration; the gate forces that declaration into the reviewed baseline.

### 6.5 Two-tier stink biscuit

- **`stink:warn`** (unresolved unsafe-sink write; nobody declared it) → **hard gate.** A latent bug by definition; the stink-check tool counts these — and every `error`-severity diagnostic — and exits 1 on any count > 0 (wired into `prepublishOnly`).
- **`stink:declared`** (intentional raw) → **don't gate; baseline it.** A snapshot of the declared-raw set is checked into `stink-baseline.json`. A *new* raw not in the baseline doesn't block the build: the check reports the drift, and `stink-check --update` **rewrites the baseline file, so that diff lands in code review.** The tripwire is not "block raw" — it is **"raw cannot be added invisibly."**

stink-check routes on the diagnostic's `severity` field, never on its code prefix *(v2.1.1, D-8)*: every `warn`-severity diagnostic, `switch-static-dead` included, is a hard-gate count, and `info` is never gated. Static attributes pass `gateSink` (`on*` and off-list names → `stink:warn`) *(v2.1.1, D-10)*, so the "raw cannot be added invisibly" claim holds for every authoring syntax.

### 6.6 Inbound smell check

The runtime proxy `set`-trap runs a **warn-once-per-property** heuristic (string-check first, hoisted regexes) for three corruption shapes: a number receiving a non-numeric string, a canonical ISO date receiving a `/`-formatted date-ish string, and a canonical 10-digit phone receiving a formatted string. This is an explicitly **thin, best-effort backstop** — the real defense is the compile-time §5.3.3 parse-required obligation; heuristic false positives are accepted as noise. The warning is a **stink signal, prod-visible by design** *(v2.2.0, A3 §4)*: it prints through `Print('WARNING')` in every build, with warn-once dedup at the call site.

### 6.7 The unified mechanism

The pipe (§5.3), the raw path (§6.1), and the audit (§6.5) are **one mechanism, not three features.** A declared, audited XSS escape hatch *is* a sanitizer in a pipe on a raw binding:

```html
innerHTML.rawBind.to-view="userHtml | sanitizeHtml"
```

That single expression says: you're doing `innerHTML` (off-list → forced to `rawBind` → fails closed if forgotten), you routed it through a named transform, and the biscuit records both as one greppable, baseline-diffable line. Keeping the pipe is not in tension with the security work — the pipe is the security work's declaration surface.

---

## 7. Reactivity & binding engine

### 7.1 The model

`@reactive` on a property declares "this drives the UI": the decorator installs an accessor pair backed by the engine's proxy — nothing is compiler-emitted for it — and `DiamondCore.makeReactive(target, property)` is the public helper that wraps an object-valued property by hand. Reactive objects are Proxy-wrapped by a single internal `ReactivityEngine`; reads inside an effect register a dependency, writes retrigger dependents. `DiamondCore.effect(fn)` runs `fn`, tracks its reads, and re-runs on change, returning a disposer. `DiamondCore.reactive(obj)` wraps an object; `DiamondCore.computed(getter)` returns a memoized getter. A `WeakMap` proxy cache preserves referential identity for deep reactivity.

Arrays are reactive in place: adding or removing an element (`push`, `pop`, `shift`, `unshift`, `splice`, assignment past the end, a `length` write) re-runs every effect that iterated the array or read its `length`, exactly as reassigning the array does. Mutations within one tick batch into one flush (§7.2). `Collection` remains the tool for large lists. *(2.2.4, #26)*

`@reactive` is operational under either class-field emit. A [[Define]]-emitting toolchain (`useDefineForClassFields: true`, TypeScript's default for ES2022+ targets and what Parcel 2.16 / SWC emit) lands fields as own data properties that shadow the reactive accessor; the first framework entry re-routes them (§4.4, *2.2.3, #11*). Projects set `"useDefineForClassFields": false` alongside `"experimentalDecorators": true` regardless.

The public reactivity surface is `DiamondCore.effect` / `.computed` / `.reactive` / `.makeReactive`. `ReactivityEngine`, the engine singleton, `ITERATE_KEY`, `Scheduler`, and the scheduler singleton are **internal** — there is no public way to force a synchronous effect flush.

> ⚠ `DiamondCore.computed` is public but **not emitted by the compiler and its caching is currently defeated** (it re-runs on every dependency change) — dead public surface (§16 D-16). The nested-effect `activeEffect` handling is also a latent trap for any future primitive that reads *after* building (§16 D-17); all current codegen reads dependencies before building, so nothing triggers it today.

### 7.2 Scheduling & disposal

Effects are batched onto a microtask queue with `Set` dedupe, so N synchronous mutations collapse into one flush (this is what makes `Collection`'s 10k-push case one render). The scheduler drops disposed effects at flush: effect cleanup sets a `disposed` flag on the effect record, and the flush skips and drops flagged effects *(v2.1.1, D-7)* — so a mutation in the same tick as `unmount()` can no longer re-arm a disposed effect and retain the unmounted tree.

`DiamondCore.captureScope(fn)` runs `fn` while collecting every `bind`/`on`/`effect`/`if`/`switch`/`repeat`/`spread`/`delegate`/child cleanup created during it, returning `{ value, cleanup, scope }`. If `fn` throws, everything registered before the throw is disposed before the error propagates *(2.3.0, Lifecycle Contract P-2)*. `DiamondCore.effect()` registers its disposer into the current scope like every other acquisition; each structural creates its master effect through the engine directly and registers its own disposer, so the acquisition appears in the inventory once *(2.3.0)*. Underneath it is an explicit scope object, which the component lifecycle opens and closes directly (§4.4): scopes dispose LIFO, each cleanup in its own `try`, collecting failures (§4.6). **Root-level and nested** bindings all dispose with their scope, uniformly with structural-directive subtrees, and detached structural branches dispose eagerly (§5.4).

---

## 8. Collections

`Collection<T>` is the collection-at-scale primitive (v2.1's phase "2.1a"): tens of thousands of items, sorted/searched/accessed efficiently, O(1) amortized append, **no per-item proxy overhead**. Factory `DiamondCore.collection(items?, { key? })` or `new Collection(...)`.

```typescript
class Collection<T> implements Iterable<T> {
  get length(): number;
  at(index): T | undefined;
  byKey(key): T | undefined;          // O(1); throws if no `key` option was supplied
  push(...items: T[]): number;        // O(1) amortized
  remove(item: T): boolean;           // O(n) by identity — batch removals via mutate
  find(pred): T | undefined;
  where(pred): T[];
  sortBy(cmp): readonly T[];          // view cached per stable comparator reference
  binarySearch(sorted, probe): number; // index, or ~insertionPoint
  mutate(fn: (items: T[]) => void): void;  // raw-array surgery, single re-render
  notify(): void;                     // escape hatch for in-place item edits
  toArray(): readonly T[];
  [Symbol.iterator](): Iterator<T>;
}
```

**Items are never proxied** — identity is preserved (exactly what `repeat` keys on), and a proxy wrapper would break both keying and the `delegate` registry. Reactivity is **coarse-grained**: one version signal (a one-field micro-proxy through the existing engine — zero new machinery); every read method touches it, every mutation bumps it, and the scheduler's dedupe collapses N synchronous mutations into one flush. A separate untracked revision mirror invalidates the `sortBy` cache. `notify()` exists because in-place field edits on unproxied items are structurally invisible to the version signal. `sortBy` caches per **comparator reference** — an inline lambda defeats the cache.

The data structure meets the O(1) bar (10k synchronous pushes → exactly one flush). The `repeat` *render* over a collection does not (§16 D-4).

---

## 9. Data delegation

`DiamondCore.delegate` is the homogenized event-delegation surface (v2.1's phase "2.1b") — a clean-slate design, **not** a salvage of Aurelia's removed `.delegate` stub:

```typescript
static delegate<T = unknown>(
  container: Element,
  eventType: string,
  selector: string,
  handler: (item: T, event: Event, node: Element) => void
): () => void;
```

One container listener; `event.target.closest(selector)` + containment check; upward walk to the first node registered in `repeat`'s node→item `WeakMap` (populated at row build, deleted at row disposal); the handler receives the **data item** identically for reactive-array and `Collection` sources (that uniformity *is* the "homogenized" requirement). `container` is `Element` (SVG works); `matchedNode` is the selector match, not the registered row node; a selector match with no registered item is a **silent no-op**; the listener is non-capturing; the cleanup self-registers.

**Runtime-API-only** — there is no template grammar for delegation (none was specified, and the omission protects the parcel-plugin LOC ceiling). The registry is populated exclusively by `repeat`, so `delegate` resolves items only for `repeat`-produced nodes. Note the naming split: `click.delegate="f()"` in a template is a hard parse error; `DiamondCore.delegate(...)` in TypeScript is the supported API.

---

## 10. Build system

### 10.1 Pipeline

`.diamond.html` / `.html` template → parse5 (HTML→AST) → transform (bindings → `DiamondCore` calls; pipes → composed function calls + provenance; structural directives → `if`/`switch`/`repeat` lowerings; spread → `spread` loop; `@import` → import lines) → generate the instance `createTemplate()` with `[Diamond]` hints → emit with a source map. The compiler is `build-time only`; the browser never sees a parser.

### 10.2 Parcel transformer

`@diamondjs/parcel-transformer-diamond` detects Diamond templates via `isDiamondTemplate`, compiles, and maps diagnostic severities onto `@diamondjs/primafacie` log types. It **throws on `severity: 'error'`** (retired/unknown commands = broken source) and logs `warn`, `declared` and `info` through `Print` without failing the build — enforcement is the out-of-band stink-check merge gate, not local dev. It reads the build's run mode and injects `__DIAMOND_DEV__` (§17.13). It also exports `compileTemplate`, `readRunMode`, `resetRunModeCache` and the `RunMode` type for its tests; those are not on the contract.

`isDiamondTemplate` detects the v2.0 command surface (`calls`, `set`, `rawset`, `rawbind`, `capture`, `bind`, `to-view`, `from-view`, `two-way`) plus `<switch`, `repeat.for=` and `<outlet` *(v2.2.0)*, **and retains the retired tokens** (`trigger`, `delegate`, `one-time`) so a stale `.trigger` file is still detected, compiled, and served the helpful rename diagnostic rather than silently shipped as raw HTML. Bare `if=` is deliberately excluded (false-positive claims on non-Diamond HTML would break builds loudly); an `if=`-only template with zero bindings, interpolations, switches, repeats and outlets is a documented blind spot — which also covers `else-if`-only and `case`/`default`-only fragments (§16 D-18).

### 10.3 Source maps

The compiler emits real base64-VLQ Source Map V3 mappings (hand-rolled, dependency-free, line-level). **Documented caveat:** the map is relative to the bare `createTemplate()` snippet; `compileAndInject` insertion and the Parcel module wrapper shift lines. Full `asset.setMap` wiring is deferred — and the Parcel transformer currently passes `sourceMap = false`, so the maps are **not reachable on the default toolchain** at all (§16 D-11).

### 10.4 Monorepo build order *(v2.2.0; 2.2.4, #25)*

The runtime imports `Print` from `@diamondjs/primafacie` (§15), so the build order is **primafacie → runtime → everything else**, acyclic. The root build runs the first two as two chained builds in that order, so the result does not depend on how npm orders workspace flags, and a fresh clone builds in one pass; `prepublishOnly` goes through the same script.

---

## 11. Runtime API reference

`@diamondjs/runtime` exposes a single entry point (no subpath exports; deep imports are impossible). Public surface, verbatim:

```typescript
// index.ts
export { DiamondCore, Scope, type ScopeFailure } from './core'           // DiamondCore is also the default export
export { Component, fold, type Phase, type Cause, type LifecycleRecord } from './component'
export { Collection, type CollectionOptions } from './collection'
export { reactive } from './decorators'
export { ParseResult } from './parse-result'
export { SAFE_SINKS, PROPERTY_NAME_MAP, canonicalizeSinkKey, isDataOrAriaKey, isInertMetadataKey } from './security'
export { Router, type RouteMap, type RouteDefinition, type RouteId, type Destination, type QueryParams } from './router'
export { Guard, type GuardContext } from './guard'
export { Pending } from './pending'
```

`isInertMetadataKey` *(2.2.3)* tests the inert-metadata set of §6.3 (`data-*`, `aria-*`, `role`). The router exports are specified in §17.10.

### 11.1 `DiamondCore` (static namespace)

```typescript
static captureScope<T>(fn: () => T): { value: T; cleanup: () => void; scope: Scope };
static reactive<T extends object>(obj: T): T;
static makeReactive(target: object, property: string): void;
static effect(fn: () => void): () => void;
static computed<T>(getter: () => T): () => T;   // public but not compiler-emitted (§16 D-16)

static bind(
  element: HTMLElement,
  property: string,
  getter: (() => unknown) | undefined,   // required slot; `undefined` for from-view
  setter?: (value: unknown) => void,
  eventName?: string                     // update-on timing; read only inside `if (setter)`
): () => void;

static on(element: HTMLElement, event: string, handler: (e: Event) => void, capture?: boolean): () => void;

static if(anchor: Comment, branches: Array<{ when: () => boolean; make: () => Node }>): void;

static switch(
  anchor: Comment,
  onGetter: () => unknown,
  cases: Array<{ match: (v: unknown) => boolean; make: () => Node }>,
  defaultMake?: () => Node
): void;

static repeat<T>(
  anchor: Comment,
  itemsGetter: () => Iterable<T> | null | undefined,
  makeItem: (item: T, index: number) => Node
): void;

static spread(
  element: HTMLElement,
  objGetter: () => Record<string, unknown> | null | undefined,
  raw?: boolean
): () => void;

static delegate<T = unknown>(
  container: Element, eventType: string, selector: string,
  handler: (item: T, event: Event, node: Element) => void
): () => void;

static collection<T>(items?: Iterable<T>, options?: CollectionOptions<T>): Collection<T>;

static trackRange(body: Node, stop?: Node): { node: Node; remove: () => void; nodes: () => Node[] };   // 2.2.4, #17 — §5.4.4
static child(instance: Component, host: HTMLElement): void;          // 2.3.0 — §4.4, §4.5

// Scopes (2.3.0 — §4.4, §7.2)
static openScope(): Scope;
static closeScope(scope: Scope): void;
static withScope<T>(scope: Scope, fn: () => T): T;
static inScope(): boolean;
static drain(scope: Scope): void;                                     // the connection drain
```

```typescript
export class Scope {                 // the inventory of one lifetime (§4.4, §7.2)
  list: Array<() => void>;           // cleanups, disposed LIFO
  children: Component[];             // child instances awaiting the connection drain
  scopes: Scope[];                   // branches placed while this tree was detached
  pending: Array<() => void>;        // root-level structural placements awaiting a parent
  nodes: (() => Node[]) | null;      // the managed range (set by mount(); read by domPing())
  prev: Scope | null;                // the scope that was current when this one opened
  add(fn: () => void): void;
  dispose(): ScopeFailure[];         // LIFO, each cleanup in its own try; every list emptied after
}
export interface ScopeFailure { index: number; error: unknown }
```

`bind`'s third argument is a **required positional slot holding an optionally-`undefined` value** (typed `(() => unknown) | undefined`, no `?`), so callers must pass it; `from-view` passes the literal `undefined`. Anchors for `if`/`switch`/`repeat` are **trailing markers** — rendered content inserts immediately *before* the anchor.

**Public for the framework's own use, not app-facing.** `trackRange` is public for the same reason `captureScope` is: `Component` calls it. The scope operations (`Scope`, `openScope`, `closeScope`, `withScope`, `inScope`, `drain`) and `Component.adopt` / `deliver` are in the same position: public because the lifecycle, the router and compiled composition call them, not app-facing. `child` called outside any scope is a plain `instance.mount(host)`: no disposal registration and no drain. A dev/test-only live-effect counter (`__liveEffects`) is not on the contract. `currentScope`, `track`, `itemRegistry`, `getInputEventName`, `unstable` (the start-marker guard, §5.4.4), `placeBefore`, `settle`, `deliverBranch` and `report` are `private static` and not on the contract.

### 11.2 `Component`, `Collection`, `ParseResult`

See §4.4 (`Component`, its phases and `LifecycleRecord`), §8 (`Collection<T>` / `CollectionOptions<T>`), and §5.3.4 (`ParseResult<T>` interface + `ok`/`fail`). The five phase callbacks, `element`, `registerCleanup`, `whileMounted`, `debounce` and `throttle` are `protected` (subclass-only); `adopt` and `deliver` are public but `@internal`; the rest of `Component` is public. `update()` is removed *(2.3.0, LC-4)*. `fold`, `Phase`, `Cause` and `LifecycleRecord` are exported for tooling that reads `history()` (§4.7). `ParseResult` exports the value (the const); the interface is reachable through the same specifier.

### 11.3 `@diamondjs/compiler`

```typescript
export { DiamondCompiler, CompileError } from './compiler'
export { TemplateParser, PROPERTY_NAME_MAP } from './parser'
export { CodeGenerator } from './generator'
export { SAFE_SINKS, gateSink } from './security'
export type {
  SourceLocation, BindingType, BindingInfo, SinkOp, Diagnostic, DiagnosticSeverity,
  InterpolationInfo, ElementInfo, TextInfo, TextPart, NodeInfo,
  CompilerOptions, CompileResult, TemplateImport,
} from './types'
export { isElementInfo, isTextInfo } from './types'
```

`TemplateImport` *(v2.1.1, D-5)* is the `@import` result type. `TextPart` and the optional `TextInfo.parts` *(2.2.4, #29)* carry a text node as the static and interpolated pieces the generator emits from.

---

## 12. Diagnostics catalog

The compiler returns `diagnostics: Diagnostic[]` on `CompileResult`; each is `{ code, severity, message, location }` with `location: SourceLocation | null`, plus `property`, `op`, `raw` and `expression` where the gate, the spread site or a converter code sets them. Severity is `error` | `warn` | `declared` | `info`, surfaced by the stink tool as `error` / `stink:warn` / `stink:declared` / `info`. **Message text is authoritative in source**; this table is the contract of *which codes exist, at what severity, on what trigger*. (A handful of codes are constructed dynamically — noted inline.)

### 12.1 Parser diagnostics (all `error` unless noted)

| Code | Trigger |
|---|---|
| `case-outside-switch` / `default-outside-switch` *(built as `${tagName}-outside-switch`)* | `<case>`/`<default>` with no `<switch>` parent |
| `switch-no-on` | `<switch>` missing/empty `on` |
| `switch-extraneous-attr` | attribute other than `on` on `<switch>` / other than `if` on `<case>` / any on `<default>` |
| `switch-bad-child` | non-whitespace text, or a non-`case`/`default` element, directly in `<switch>` |
| `switch-default-not-last` | a `<case>` follows `<default>` |
| `switch-multiple-default` | a second `<default>` |
| `switch-empty` | zero cases and no default |
| `case-no-if` | `<case>` missing/empty `if` |
| `bad-spread` | a `...`-prefixed attr that is neither `...attrs.bind` nor `...attrs.rawBind` |
| `multiple-structural` | two structural directives on one element |
| `bare-update-on` / `bare-error-into` | the attribute is literally `update-on` / `error-into` (unscoped) |
| `bad-error-into` | `error-into` value is not a bare property path |
| `update-on-no-binding` / `update-on-not-inbound` | `update-on` with no matching binding / a non-inbound target |
| `error-into-no-binding` / `error-into-not-inbound` | `error-into` with no matching binding / a non-inbound target |
| `bad-repeat` | `repeat.for` value not `item of items`, or a non-`.for` repeat command |
| `if-no-command` / `elseif-no-command` | any dotted `if.*` / `else-if.*` |
| `bare-else-removed` | attribute named exactly `else` |
| `raw-if-invalid` | `rawIf` (if has no sink) |
| `with-removed` | attribute head `with` |
| `unterminated-interpolation` | `${…` with no closing `}` |
| `attr-interpolation-unsupported` *(v2.1.1, D-3)* | a raw `${` in a plain static attribute value, read from the raw source (§5.2.1) — an entity-encoded `${` does not trigger it *(2.2.4)* |
| `escaped-interpolation` — **info** *(2.2.4, #29)* | each `\${`; located at the backslash's line and column in text, at the attribute in an attribute value; the message suggests `\\${` for the Windows-path case. Never gated |
| `retired-command` | a command in `{one-time, trigger, delegate}` (one code, three message variants) |
| `unknown-command` | a command in neither the active nor retired map |
| `ampersand-removed` | a lone `&` in a binding/spread/interpolation expression |

### 12.2 Generator diagnostics

| Code | Severity | Trigger |
|---|---|---|
| `orphan-else-if` | error | `else-if` not absorbed by a preceding `if`/`else-if` chain (including one separated by non-ASCII whitespace, §5.4.1) |
| `attr-binding-outbound-only` | error | a dashed property bound `bind`/`two-way`/`from-view` (may follow a `stink:warn` from the gate; a `data-*`/`aria-*` name or a `from-view` leg reaches it alone) |
| `malformed-pipe` | error | a pipe segment fails the segment regex (binding site carries a location; interpolation site has `location: null`) |
| `error-into-no-converter` | error | `error-into` set but the binding has no converter to read a `ParseResult` from |
| `pipe-fromview-multi` | error | a `from-view` binding with ≥2 transforms |
| `pipe-two-way-noninvertible` | error | a camelCase/plain-function segment on a `bind`/`two-way` pipe |
| `switch-static-dead` | warn | a static `on=` matches no case with no `<default>`; fails the stink-check gate by severity (§6.5) |
| `stink:declared` | declared | `...attrs.rawBind` (spread site) and `raw`-on-off-list-sink (§12.4) |

### 12.3 Orchestration / `@import` / converter-obligation / composition diagnostics

| Code | Severity | Trigger |
|---|---|---|
| `bad-import-directive` | error | an `@import` name fails the identifier grammar, or an `@import`-shaped comment fails the strict form |
| `import-directive-duplicate` | error | the same name in two `@import` directives |
| `import-directive-unused` | info | an `@import` name matches no pipe transform |
| `converter-unresolved` | info | an import cannot be followed to a readable module (10 detail variants: no import, package specifier, unreadable, circular, >3 hops, package re-export, …) |
| `converter-missing-parse` | error | a converter used on an inbound leg resolves but has no `static parse` within 3 hops |
| `pipe-transform-standalone` | error | a standalone module has pipe heads uncovered by `@import` (`location: null`; added by the Parcel transformer's standalone path, not by `compile()`) |
| `component-composition-unsupported` *(v2.1.1, D-21)* | error | a hyphenated tag whose PascalCase form is imported by the component module — **retired** when §4.5 is ratified |
| `component-self-closing` *(proposed for v2.3.1, §4.5 C-10)* | error | a self-closing component tag |
| `component-children-unsupported` *(proposed for v2.3.1, C-9)* | error | non-whitespace content between a component tag's open and close tags |
| `component-prop-two-way` *(proposed for v2.3.1, C-4)* | error | `.bind` / `.two-way` / `.from-view` on a component tag |
| `component-ref-in-repeat` *(proposed for v2.3.1, C-7)* | error | `ref` inside `repeat.for` |
| `component-prop-reserved` *(proposed for v2.3.1, C-5)* | error | a prop named for a base-class member |

The five `component-*` codes after `component-composition-unsupported` belong to the §4.5 proposal and have no emission site in 2.3.0.

### 12.4 Security-gate diagnostics (compile-time `gateSink`)

| Code | Severity | Trigger |
|---|---|---|
| `raw:redundant` | info | `raw` on an allowlisted or inert-metadata (`data-*`/`aria-*`/`role`) sink |
| `stink:declared` | declared | `raw` on a non-allowlisted sink (baselined) |
| `stink:warn` | warn | an outbound write to a non-allowlisted sink with no `raw` (**hard gate**) — message suggests `rawSet` / `rawBind.to-view` / `rawBind.two-way`; includes static `on*` and off-list attributes *(v2.1.1, D-10)*, except a static inert `href` on `<a>`/`<area>` *(2.2.3, #8)* |

### 12.5 Runtime warnings and throws

Not `Diagnostic` objects but part of the same story. Warnings print through `Print` and are prod-visible unless marked dev:

- **Inbound corruption** (`WARNING`, warn-once): a display-formatted value leaking into the model — the §6.6 backstop, three reasons.
- **Spread unsafe-key skipped** (`WARNING`, warn-once): a non-raw spread hit an off-list key.
- **`@reactive` field repaired** (dev, once per class): a [[Define]]-emitted field was re-routed through its accessor (§7.1).
- **Root mounted into a detached host** (dev `WARNING`, once): `mounted()` will never fire (§4.4).
- **Lifecycle transitions** (§4.7): `FAILURE` for a failed transition, `CRITICAL` for a fault, `WARNING` for a stale callback, `STATE` for a successful one in dev builds only.
- **Router narration** (§17): per-navigation `STATE`, guard decisions, `Pending` acquire/release, the dev startup route table, and the `basePath` mismatch `WARNING`.

Runtime throws: `createTemplate()` not implemented; `Collection.byKey` without a `key` option; `mount()` on a `mounted`, `faulted` or `disposed` instance, before any transition (§4.4 — supersedes the v2.1.1 double-mount guard, D-6; the faulted message names the cleanup that threw); `unmount()` on an instance that is not mounted; a subclass overriding `mount()`/`unmount()`, at construction (§4.4).

### 12.6 Catalog notes

- `pipe-two-way-multi` is **retired** — it exists only as a negative test assertion; do not treat it as emittable.
- The `*-outside-switch` and `retired-command` codes are dynamic/shared as noted; a literal grep for `case-outside-switch` returns nothing in the compiler source.
- Two `stink:declared` emission sites (compiler gate and generator spread) share one baseline record shape (`file:line:property:op`); the spread site records `property: '...attrs'`, `op: 'spread'`.
- `route-check` findings are a separate channel — build errors from a standalone bin, not `Diagnostic` objects. The sixteen rules are listed in §17.11.

---

## 13. Compiled-output conventions

The transparency contract, observed from actual `DiamondCompiler.compile()` output.

### 13.1 Variable naming

`nextVar` emits `${hint}_${counter}`, and element hints are pre-prefixed `el_${tagName}`, giving `el_div_0`, `el_h2_3`, `el_input_0` — the `_` separator keeps tag and counter distinct so `h2` at index 1 never reads as a 21-level heading tag. Every character of a hint outside `[A-Za-z0-9_$]` becomes `_`, so a hyphenated tag yields `el_child_component_0` *(v2.1.1, D-21)*. The counter is a **single global monotonic counter across all node kinds** (elements, text nodes, anchors share it), so indices are not per-tag; a structural's branch bodies are numbered **after** the siblings that follow it in source *(2.2.3, #7)*. Other hint prefixes: `text_N`, `ifAnchor_N`, `switchAnchor_N`, `repeatAnchor_N`, `deadSwitch_N`, `caseRoot_N`, `defaultRoot_N`. Static text takes no variable *(2.3.0, #15)*: `text_N` is an interpolated text node only, so a static-only template numbers nothing but its elements and anchors. `root` is the fixed, uncounted name of a template's combined root (zero or two-plus roots).

### 13.2 `[Diamond]` hint comments

```js
// [Diamond] Compiler-generated instance template method
// [Diamond] Two-way binding: value ↔ name
// [Diamond] Two-way binding: value ↔ amount | Currency | Trim [update-on: blur]
// [Diamond] One-way binding: title ← tooltip
// [Diamond] Set (static one-shot): title = tooltip
// [Diamond] From-view binding (one-way DOM → query): value
// [Diamond] Event binding: click → this.save()
// [Diamond] Capture event: click → this.onCapture()
// [Diamond] Conditional: if="loading" (+1 else-if)
// [Diamond] Switch: on="status" (2 cases + default)
// [Diamond] case if="'a'" → v === 'a'
// [Diamond] case if="progress > 0.5" → this.progress > 0.5 (boolean expression)
// [Diamond] default — renders when no case matches
// [Diamond] Switch on="'ready'" resolved at compile time → case if="ready" (zero runtime cost)
// [Diamond] Switch on="'other'" resolved at compile time → default (no case matched)
// [Diamond] DEAD switch (switch-static-dead): unused code, emitted as an inspectable comment node
// [Diamond] Repeat: repeat.for="item of items"
// [Diamond] Text interpolation: Hello ${name}!
// [Diamond] Attribute spread: ...attrs.bind="myGuts" — runtime-gated: gate FIRST …
// [Diamond] RAW attribute spread: ...attrs.rawBind="x" — allowlist bypassed; developer owns every key (incl. innerHTML/on*)
// [Diamond] <select> wiring follows its <option> children: value needs the options to exist
```

Two conventions worth pinning for a reader/model: **binding hints echo the expression unprefixed** (`value ↔ name`), while **event hints hardcode `this.`** (`click → this.save()`); the from-view hint inverts the arrow (points at the expression, property trails after the colon); the static-switch hint `JSON.stringify`s its `on=` value while the reactive form interpolates bare; `else-if` branches get no comment of their own (they fold into the chain head's `(+N else-if)` counter). A line break inside an echoed expression — a multi-line `if="a &&⏎ b"` — folds, with its surrounding indentation, to one space, so a hint is always one comment line *(2.2.4, #19)*. The text-interpolation hint folds every whitespace run to one space and trims, and echoes the source with its `\${` escapes in place.

### 13.3 The RAW audit comment

A raw sink emits **two lines** — a fixed banner plus the ordinary op hint with a `RAW ` infix:

```js
// [Diamond] raw sink — explicit opt-in (developer-owned, unescaped); recorded for stink-baseline review, no runtime XSS protection here
// [Diamond] RAW One-way binding: innerHTML ← userHtml
DiamondCore.bind(el_div_0, 'innerHTML', () => this.userHtml);
```

The banner describes the mechanism, not a completed audit *(v2.1.1, D-12)*. The raw spread's second line is its own hint (`RAW attribute spread: … — allowlist bypassed; developer owns every key`, §13.2) rather than the non-raw spread hint with an infix.

> ⚠ `rawBind.from-view` emits the `RAW ` tag but **no banner and no `stink:declared`** — a raw usage invisible to the audit trail (§16 D-13).

### 13.4 `bind()` multi-line split

Block-body setters (converter parse + validity gate) are **always** emitted multi-line so the security-load-bearing `if (r.valid)` sits alone on its own line, visually prominent — regardless of width; concise passthrough setters split only past 100 chars (indent-inclusive):

```js
// [Diamond] Two-way binding: value ↔ amount | Currency
DiamondCore.bind(el_input_0, 'value',
  () => Currency.format(this.amount),
  (v) => {
    const r = Currency.parse(v);
    if (r.valid) this.amount = r.value;
  }
);
```

### 13.5 Emission order and text encoding *(2.2.3, #7/#9; 2.2.4, #19)*

- A structural is emitted as: create its anchor → append the anchor to its parent → wire the directive (§5.4.4).
- A `<select>`'s bindings and handlers follow its `<option>` children, behind the hint in §13.2.
- Author text is encoded for the position it lands in (§5.2.2). A tab or other control character inside static text or an attribute value is emitted as an escape (`\t`) instead of the raw character; the value is the same.
- **Static text is emitted as string arguments** *(2.3.0, #15)*. Each parent's children — elements, anchors and static text — are appended in one `append(...)` call, in DOM order; only interpolated text keeps a named `createTextNode`, and a text-only single root (a template or a case body) is a `createTextNode`. A call wider than the §13.4 width is written one argument per line, unless it has a single argument, which a string cannot break. A dropped HTML comment leaves one text run on its two sides, not two arguments. Interpolated text is emitted on one line — a line feed is written as `\n` — so source-map line numbers stay correct.

### 13.6 Mounted-output shape

The DOM a template produces equals its markup with directives erased, plus exactly these framework nodes: one trailing comment anchor per reactive structural directive — `<!--if-->`, `<!--switch-->`, `<!--repeat-->` (a compile-time-resolved `<switch>` leaves no node); an `<!--empty-->` placeholder where a body has no roots (an empty template, `<case>` or `<default>`); the inspectable comment of a statically-dead switch; and the `<!---->` start marker in front of a body that begins with a structural (§5.4.4). A composed component's host element is ordinary markup — the tag the author wrote (§4.5, proposed for v2.3.1). Text is not a framework node: it is exactly the parser's (§5.9).

---

## 14. Packages & LOC budgets

Nine workspace packages, lockstep at **2.3.0**: `@diamondjs/primafacie`, `@diamondjs/runtime`, `@diamondjs/compiler`, `@diamondjs/converters`, `@diamondjs/guards`, `@diamondjs/parcel-transformer-diamond`, and the meta-packages `@diamondjs/dev` (which also carries the toolchain bins), `@diamondjs/app` and `@diamondjs/all` (§17.12).

| Package | Prod LOC | Budget | Usage |
|---|---:|---:|---:|
| `@diamondjs/runtime` | 2,027 | 2,500 | 81.1% |
| `@diamondjs/compiler` | 2,486 | 5,000 | 49.7% |
| `@diamondjs/parcel-transformer-diamond` | 164 | 300 | 54.7% |
| `@diamondjs/converters` | 123 | 500 | 24.6% |
| `@diamondjs/primafacie` | 300 | 400 | 75.0% |
| `@diamondjs/dev` (toolchain) | 545 | 800 | 68.1% |
| **Total (production)** | **5,645** | **9,500** | **59.4%** |

Figures are measured at `07cf171`, the last code change of 2.3.0 (the 2.2.4 baseline at `82bb8bc` was 5,342 / 56.2%). The Lifecycle Contract accounts for the runtime's +281 (against its +300 ceiling) and preserved text (#15) for the compiler's +22. The suite is **956 tests across 64 files** on Node 20.18.1 (859 across 57 at 2.2.4), with the 64 lifecycle tests run a second time under the legacy toolchain shape (`npm run test:lifecycle`) and ten Playwright acceptance tests against Chromium (`npm run test:acceptance`). Composition (v2.3.1) is budgeted at ~200 runtime LOC plus its compiler share, which leaves the runtime about 270 lines under its ceiling. Warning thresholds in `check-loc-budget.ts`: runtime 2,250, compiler 4,500, parcel 250, converters 400, primafacie 350, dev 700. The dev-toolchain budget (800) entered with 2.2.2, raising the total from 8,700 to 9,500. `@diamondjs/guards` has a stated budget of 400 but no row in the budget tool yet.

The batteries (`@diamondjs/converters` — `CurrencyConverter`, `DateConverter`, `PhoneConverter`, `IntConverter`, `SlugConverter` — and `@diamondjs/guards` once it carries mid-classes) are kept separate from the runtime; `ParseResult` stays in the runtime so batteries and user converters import the same contract and it cannot drift.

---

## 15. Logging (`@diamondjs/primafacie`)

`@diamondjs/primafacie` is the isomorphic logging package (named by the author): the `Print(logType, message)` paradigm carried from Stargate — 15 log types, symbol pairs, caller extraction, a padded line format — with a console transport (Node ANSI / browser `%c`) and pluggable sinks (`addSink`; a lazy self-healing `wsSink` browser→server transport; a Node-only `fileSink` under the `./node` subpath so browser bundles never touch `fs`). The tools' summary lines and the Parcel transformer's non-throwing diagnostics print through it; the compiler stays pure (returns diagnostics, prints nothing). The package's public surface is `Print`, `configure`, `addSink`, `LOG_TYPE_SYMBOLS`, `wsSink` and the types `LogType`, `LogRecord`, `LogSink` and `WsLogMessage`; `wsReceiver` and `fileSink` live on `./node`.

**One vocabulary through `Print`** *(v2.2.0, A3 §3)*. `packages/runtime/src/dev-log.ts` is **deleted**. The runtime imports `Print` from `@diamondjs/primafacie` (browser-safe core only; Node transports stay behind `./node`). Build order: primafacie → runtime; acyclic (§10.4). This overturns the v2.1 "runtime adopts only the line format, no dependency" rule: that rule assumed primafacie was tooling, and its reclassification as **production infrastructure** — it ships in `@diamondjs/app`, and stink tagging must be visible in normal operation — removed the premise. The three-channel taxonomy is preserved: compiler `Diagnostic[]` remains pure data; runtime warnings are `Print` calls, not Diagnostics.

**Constraint (normative):** `Print` never lands in a hot reactive path — it captures a stack per call for the caller name. The compiler-injected caller-name memoization is a recorded deferred item.

**v2.2 primafacie additions:** `WsLogMessage.plain` (the line is formatted exactly once, in the browser; `wsSink` sends it); `wsReceiver(sink)` on `./node` — framework-agnostic and **silent** (no server echo; the browser already printed); `fileSink(dir, { datestamped })` rolling `access-YYYY-MM-DD.log` by date-in-filename via per-append string compare, no rotation daemon, default off; the dead `enableDebug` initializer (`(A || B) || true`) fixed so the env vars actually gate (default remains on).

What prints through it: the runtime warnings and lifecycle emissions of §12.5 and §4.7, and the router's narration (§17).

> ⚠ Two reports still bypass `Print`: an effect that throws during a scheduler flush, and a cleanup failure inside `captureScope` or a structural branch — both `console.error` (§16 D-26).

---

## 16. Conformance & known limitations

Shipped v2.3.0 meets the contracts above except for the items below. Each is dispositioned **fix-the-code** (a defect against a sound spec intent), **accept** (a bounded limitation to document), or **correct-the-record** (the earlier record was imprecise; this spec adopts the corrected form). Defects closed since v2.1 are listed at the end of this section; Appendix G carries them by release.

### Open defects (fix-the-code)

- **D-24 — `fold` is a standalone exported function** *(recorded 2.3.0)*. §3.1 #6 requires runtime code to be class methods or static namespaces, never lone exported functions; `fold(history)` ships as one. Disposition deferred to v2.3.1: a static (`Component.fold`), a method on the record, or an accepted exception. The runtime index also exports the `reactive` decorator and the three security helpers (`canonicalizeSinkKey`, `isDataOrAriaKey`, `isInertMetadataKey`) as lone functions; the same disposition covers them (a static namespace, or an accepted exception for decorators and pure predicates).

- **D-23 — `createTemplate()` and `element` are typed `HTMLElement`** *(recorded 2.2.4)*. A template with two or more roots returns a `DocumentFragment`, and the managed range (§5.4.4) may begin with a comment. §4.4 should type both as `Node`; it shows the shipped `HTMLElement` with this pointer. Fix: correct the declarations.

- **D-26 — two reports bypass `Print`** *(recorded 2.3.0)*. §15 requires one logging vocabulary; an effect that throws during a scheduler flush, and a cleanup failure inside `captureScope` or a structural branch, are reported with `console.error`. Fix: route both through `Print` (`FAILURE`); the no-fault rule for branches (§4.6) stands.

- **D-27 — undocumented three-segment synonyms** *(recorded 2.3.0)*. The parser accepts `property.bind.to-view`, `.bind.from-view` and `.bind.two-way` (non-raw) as synonyms of the two-segment commands; §5.1 defines the three-segment form only for `rawBind`. Disposition pending the author's ruling: remove them from the command map, or admit them in §5.1.

- **D-28 — `<switch>` whitespace test is not ASCII-only** *(recorded 2.3.0)*. §5.9 (b) consumes ASCII whitespace between cases, the class (a) and (c) use; the shipped parser uses `trim()`, so a non-breaking space there is consumed too. Fix: the ASCII class.

### Accepted limitations (document, don't smooth over)

- **D-4 — `repeat` render is O(n) DOM mutations per update.** `Collection`'s append is genuinely O(1) (10k pushes → one flush), but the render re-inserts the whole ordered list before the anchor each run (201 `insertBefore` after one push into a 200-row list). Nodes are reused, not rebuilt (churn, not a correctness bug) — but never transcribe "O(1) append" next to the Neuron bar without this caveat.

- **D-11 — VLQ source maps are unreachable on the default toolchain.** The compiler generates real maps, but the Parcel transformer passes `sourceMap = false` and has no `setMap` call (stale "Phase 0/1" comments remain). The seam exists; the wiring does not.

- **D-13 — `rawBind.from-view` is invisible to the audit trail, and `from-view` is gate-exempt.** The inbound raw form emits the `RAW ` tag but no banner and no `stink:declared` (deliberate — inbound is a different contract), and `from-view` is exempt from the compile-time gate (sound: no sink write). §6.4 row 1's coverage claim is read with this documented exemption.

- **D-14 — `SAFE_SINKS` is design-derived, not empirically hardened.** Byte-for-byte the Phase-1 starter set; the empirical probe against NetPad (below, under "Open by design") has not run. Describe the list as unrefined. The first application surfaced four candidates (`rows`, `cols`, `list`, `for`), recorded for ratification and not added.

- **D-16 — `computed` is dead public surface.** Public but not compiler-emitted, and its caching is defeated: the getter re-runs on every dependency change and again on read, and its tracking effect is never disposed. **D-17 —** nested-effect `activeEffect` nulling (rather than save/restore) silently untracks any read *after* a nested effect is created; no current codegen reads-after-building, so nothing triggers it today — a trap for future primitives. *(No disposition recorded since v2.1.)*

- **D-18 — `isDiamondTemplate` blind spot.** Narrowed in v2.2.0 by the `<outlet` token: an `if=`-only template with zero bindings, interpolations, switches, repeats and outlets stays undetected, which also covers `else-if`-only and `case`/`default`-only fragments. Rationale unchanged: bare `if=` is a false-positive risk on non-Diamond HTML.

- **D-19 — `generateNodes` re-accretion.** The complexity debt is closed, but the v2.1 switch guard restored the loop to depth 3 / CC 8–10; a fifth structural sibling clause reopens it. The proven remedy is the same extraction (fold the switch guard into `generateStructural`-style dispatch). *(No disposition recorded since v2.1.)*

- **D-21 — Template component composition.** Proposed for v2.3.1 (§4.5). Until then, the compiler errors `component-composition-unsupported` on an imported hyphenated tag; the runtime seam (`DiamondCore.child`) ships with the Lifecycle Contract.

- **SPA Back is not intercepted by `Pending`** (§17.8). Departure with active holds through Back narrates a `WARNING`; the `canLeave` veto is deferred (Appendix F).

### Open by design (carried from v2.1 — three of four still open)

- Structured `ParseResult.error` `{code, message}` (i18n seam) — still bare `string | null`.
- Plugin `asset.setMap` source-map offset wiring (see D-11).
- The empirical allowlist probe — **NetPad** remains the designated stress test (hardest XSS surface: cross-user real-time content flow); `Collection` and `delegate` (§8, §9) now exist to build it on. This probe is also the refinement D-14 records as not-yet-done.
- ~~Double-`mount()` guard~~ — closed in v2.1.1 (D-6) and superseded in 2.3.0 by the phase rule of §4.4.

### Closed since v2.1

| ID / issue | Disposition | Release |
|---|---|---|
| D-1 | `if`/`switch` detached branches dispose eagerly; branch cache removed (§5.4) | 2.1.1 |
| D-2 | primitive `repeat` keys: typeof-prefixed value + occurrence index | 2.1.1 |
| D-3 | attribute interpolation diagnosed (`attr-interpolation-unsupported`); read from the raw source in 2.2.4 | 2.1.1 / 2.2.4 |
| D-5 | `TemplateImport` exported | 2.1.1 |
| D-6 | double-mount guarded (adopted "DOM-node leak"); superseded by §4.4's phase rule | 2.1.1 / 2.3.0 |
| D-7 | disposed effects dropped at flush | 2.1.1 |
| D-8 | stink-check routes on severity | 2.1.1 |
| D-9 | budget tool counts production LOC and fails closed | 2.1.1 |
| D-10 | static attributes gated; static inert `<a>`/`<area>` `href` exception (#8) | 2.1.1 / 2.2.3 |
| D-12 | RAW banner reworded | 2.1.1 |
| D-15 / D-20 | normative allowlist invariant in both suites; fail-closed locks for `srcset`, `action`, `formAction`, `cssText` | 2.1.1 |
| D-21 (record) | §4.5 rewritten as design intent; `component-composition-unsupported`; `nextVar` sanitizes identifiers | 2.1.1 |
| #7 | structurals render on first mount (§5.4.4) | 2.2.3 |
| #8 | static link `href` exception; `role` is inert metadata | 2.2.3 |
| #9 | `<select>` wiring after its options | 2.2.3 |
| #10 | `route-check` loads template/style imports as stubs | 2.2.3 |
| #11 | `@reactive` under [[Define]] class fields | 2.2.3 |
| #14 | link interceptor leaves non-navigation anchors to the browser (§17.9) | 2.2.4 |
| #17 | bodies mount and unmount as ranges; the `<!---->` start marker (§5.4.4) | 2.2.4 |
| #18 | `if`/`else-if` chain whitespace (§5.4.1) | 2.2.4 |
| #19 | author text literal in compiled output; hint comments fold line breaks (§5.2.2, §13.2) | 2.2.4 |
| #20 | fragment links left to the browser; query and hash kept (§17.9) | 2.2.4 |
| #25 | fresh-clone build in one pass (§10.4) | 2.2.4 |
| #26 | arrays reactive in place (§7.1) | 2.2.4 |
| #27 | `route-check` on Node 22; tsx ≥ 4.23.15 (§17.11) | 2.2.4 |
| #28 | `navigate(url)`; `href="#"` passes through; scroll after commit (§17.9) | 2.2.4 |
| #29 | literal `${` (§5.2.1) | 2.2.4 |
| D-22 / #15 | template text preserved exactly; the whitespace-as-syntax list (§5.9) | 2.3.0 |
| Lifecycle P-1 | a throw in `createTemplate()` no longer leaves the component marked mounted with live effects (§4.6) | 2.3.0 |
| Lifecycle P-2 | `captureScope` disposes on throw (§7.2) | 2.3.0 |
| D-25 / #38 (lifecycle P-3) | a page whose template root is a structural is placed before `mounted()` and before the router's hash scroll (§5.4.4) | 2.3.0 |
| Lifecycle (found in testing) | `DiamondCore.effect()` did not register into the current scope, so effects created in lifecycle callbacks escaped the inventory (§7.2) | 2.3.0 |
| Lifecycle P-4 | `debounce`/`throttle` cancels survive remount (instance scope, §4.4) | 2.3.0 |
| Lifecycle P-5 | router construction failures dispose already-constructed incoming components (§17.2) | 2.3.0 |
| Lifecycle P-6 | children's teardown cascades from the parent's mount scope (§4.5) | 2.3.0 |

---

## 17. Router

The router, guards, `Pending`, outlets and their tooling *(v2.2.0; Destinations v2.2.1; links, URLs and scroll 2.2.4)*. Subsections keep the v2.2 Router Specification's numbering: Router Specification §n is §17.n here.

### 17.1 Meta-rules

Language-first composition and explicit discriminants are spec-wide meta-rules and live in §1.

### 17.2 The pipeline (normative order)

Every navigation, on **every** vector (pushState nav, initial load, popstate), runs:

1. **Trigger** — the navigation gets a monotonic ID.
2. **Recognize** — specificity match + converter param parsing. A failed `ParseResult` **is** a failed match and falls through toward `not-found`.
3. **Plan** — `Map<outletName, matchedRoute>` from the matched chain.
4. **Guard phase** — all guards, chain order (parent first), across the whole plan, awaited to completion **before anything mounts or constructs**.
5. **Race check** — nav ID still current, else discard silently.
6. **History write** — `pushState`, stamped `{ diamondNavId, index }` (also stamped on `replaceState`) — canLeave forward-compatibility.
7. **Commit** — diff vs. occupancy; unmount outgoing **deepest-first**, mount incoming **parent-first**, synchronous. Mount failure (constructor or mount throw) leaves the previous route intact — defined behavior, tested.
8. **Settle** — scroll (§17.9), then the per-nav `Print('STATE', 'nav → <path> [outlets]')`, on by default; `router.configure({ narrate: false })` quiets it.

**Transaction model:** the plan commits atomically or not at all. Any guard denial anywhere in a multi-outlet plan means **zero DOM mutation anywhere**. Construction precedes unmounting (a constructor throw aborts with the old route untouched); a mount throw rolls the DOM back and restores the URL — on a push the entry was already written, so it is rewritten in place to the previous URL (`replaceState`), and Back then lands on the same page once. `pushState` never fires for a rejected navigation.

**Narration and limits.** No match and no `*` route: a `WARNING`, and the navigation stops with no history write. A Destination chain is capped at 10 hops (`CRITICAL`); an unknown route id, or a `route-path` whose `:param` has no value, is a `FAILURE` and aborts rather than writing a partial URL; a Destination whose path is the current path is dropped. A navigation declined by `Pending` holds narrates `STATE`; a failed commit narrates `EXCEPTION` ("previous route preserved"); an `<outlet>` without a `name` is ignored with a `WARNING`.

**Commit under the lifecycle contract** *(2.3.0)*. Each incoming component is constructed inside a scope of its own and passed through its first framework entry (`ensureConstructed`, §4.4), so `constructed()` runs before any of them mounts; a constructor throw disposes the attempt. Outgoing occupants are unmounted in the commit step; once the commit stands, each departed occupant is `dispose()`d — not before, because a disposed instance cannot be remounted by a rollback. A throw anywhere in a commit disposes the attempt and remounts the previous occupants, leaving occupancy, outlets and DOM identical to before the navigation. A navigation back to a route whose previous occupant faulted builds a fresh instance; the router never reuses a departed instance.

The Router is the **sole history writer**. Transports and app code request navigation via `router.navigate()`, never touch `history`.


### 17.3 RouteMap (keyed-object form, normative)

```ts
type RouteMap = Record<RouteId, RouteDefinition>
type RouteDefinition =
  | { path, redirect }
  | { path, component, outlet, params?, query?, guard?, children? }
// children is recursively a RouteMap
```

**Route IDs** are quoted lowercase kebab-case string-literal keys with a leading letter — `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. Integer-like keys are excluded — by route-check; `RouteId` is `string`, so `satisfies RouteMap` alone does not reject them — so object order never lies. Enforcement: `satisfies RouteMap` in-editor; `route-check` enforces the full grammar with the canonical message:

```
Invalid route ID `querySettings`.
Route IDs must be quoted lowercase kebab-case strings.
Use:
  'query-settings': { ... }
```

**Rejected key forms (negative cases):** unquoted keys, computed `[expr]` keys, uppercase, snake_case.

**`params`:** `{ paramName: ConverterClass }` — required for every `:segment` (by type where expressible, by route-check always). Same `ParseResult` contract as `from-view`. **Divergent policy, stated:** forms keep-last-good; the router **fails the match**. Declared `query` converters (§17.4) deliver their parsed values into the same `params` object — the constructor argument, `GuardContext.params` and the occupancy key; a declared query param that is absent is skipped, so declared query params are optional.

**Params are constructor constants:** `new RouteComponent(params)`. A param change is unmount + remount, always. Conformance note: route components may accept a single params object in their constructor (§4.2's no-arg form is the default, not a prohibition).

### 17.4 Matching: specificity, never declaration order

Segment-wise, left-to-right: **static > `:param` > pattern-exhausted > `*`**. `*` matches last regardless of its declaration position and must be terminal (route-check `wildcard-not-terminal`). Equal specificity over the same URL shape is a **build error** (`ambiguous-routes`), never a positional tiebreak — reordering route blocks never changes behavior.

URL normalization: matching is **path-only**; trailing-slash-insensitive; static segments **case-sensitive**; query params never participate in matching. An optional per-route `query` converter map parses declared query params through `ParseResult` (invalid fails the match); undeclared query params stay in the URL and are passed to nothing.

Path strings are position-relative; a leading slash is cosmetic (`'/corpora'` ≡ `'corpora'` at any nesting level) — pinned by test.

Redirects are Destinations — see §17.5, which governs redirects **and** guard denials with one vocabulary.

### 17.5 Destinations (v2.2.1 — governs redirects AND guard denials)

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

### 17.6 Outlets (closed world)

`<outlet name="x">` compiles as an ordinary element — zero compiler surface. The router discovers declared outlets **at mount time**: root-declared outlets at `start()`, route-declared outlets when their owning component mounts.

Registry shape: `Map<name, { element, ownerRouteId: string | null, active: Component | null }>`; `null` owner = root-declared. Entries whose owner unmounts are deleted with it.

Outlet names are a **statically-declared closed set**. No public dynamic registration. A route may target only a root-declared outlet or one declared by an **ancestor** route's component — build-checked (`unknown-outlet`, `outlet-not-ancestor-owned`, `duplicate-outlet-name`).

`isDiamondTemplate` detects `'<outlet'` (D-18 narrowed): the canonical app shell — static chrome + outlets, zero bindings — is detected and compiled.

### 17.7 Guards

`abstract class Guard` in the runtime — exactly three static members, **no other members, no hook forest — ever** (rejected alternative, recorded):

- `static check(ctx): boolean | Promise<boolean>` — base returns `false` (**fail closed**). A pure predicate: callable from templates, handlers, socket message handlers — second enforcement points welcome.
- `static deny(ctx): Destination` — base returns `{ type: 'route-id', target: 'not-found' }` (**conceal by default**). ALL navigation policy lives here.
- `static timeoutMs = 5000`.

**`Deny` is retired before it ever shipped (v2.2.1):** `deny` returns a `Destination` (§17.5) — data the router executes through the same single executor redirects use, never a guard side effect. Guards get `site-path` and `external-url` denials for free: the OAuth IdP handoff is `{ type: 'external-url', target: authorizeUrl(…) }`.

**The envelope** is a private static on `Router` (not an overridable class method — JS cannot seal statics): fail-closed on `check()` throw (`Print('EXCEPTION')` → deny); fail-closed on timeout (`Print('FAILURE')` → deny); **one structured narration line per decision** (guard class, route id, outcome, reason, duration); result normalization (`false` → `this.deny(ctx)`).

`GuardContext` v2.2: `{ to, from, params, routeId }` — flat, everything real; `to` and `from` are normalized paths without query or hash, and `params` carries parsed query values too (§17.3). Capability namespaces (`ctx.policy`, `ctx.security`, `ctx.tenant`, …) are the named v3 growth path; **no stubs ship** (D-16 lesson).

**Composition:** `guard: typeof Guard | Array<typeof Guard>`, chain order, first non-true wins; parent guards cover subtrees and run once per navigation whose chain contains them (moving between siblings under the same parent runs the parent guard again).

**Denial semantics by vector:** pushState nav → clean abort (nothing happened; the denied URL never enters history; the deny target is then resolved as its own navigation). Initial load / popstate → resolve the deny as a redirect via `replaceState` (no lingering denied entry). Guidance: auth/permission guards return a route-arm `Destination` (with `query: { returnTo }` where appropriate), not bare `false`.

**Principle (normative): client guards predict; servers enforce.** Client guards are UX and telemetry, never the security authority; enforcement lives at the API until Diamond 3.0's server side, after which the same vocabulary runs both sides with asymmetric authority.

**Reserved v3 vocabulary (specified, not shipped):** a `challenge` decision (v2.2 idiom: redirect to a challenge surface with `returnTo`); structured deny reasons (slot into narration now as strings); envelope boundary events beyond navigation (`kind: 'navigation' | 'message'` — socket-borne authorization through the same machinery); fingerprint-as-evidence-never-identity.

**Batteries (tier 2, `@diamondjs/guards`):** converters are the data batteries; guards are the policy batteries. Abstract mid-classes configured at the app tier via static fields (`class ExampleSSO extends OAuthGuard { static issuer = … }`). **2.2.0 resolution:** the project sketches were withdrawn in favor of ideation fixtures, so no battery family had a confirmed real-world inventory — the package ships as a scaffold with zero mid-classes (no stubs, D-16 lesson) — it re-exports the `GuardContext` and `Destination` types and nothing else; candidates recorded: `OAuthGuard`, `WebAuthnGuard`, `CapabilityGuard`, `TenantGuard`. First batteries land in a 2.2.x once the first consuming app's guard inventory exists. Per-route parameterization (`{use, state}`) deferred.

### 17.8 Pending (departure-safety semaphore)

`class Pending`: `static hold(label): () => void` (refcounted, idempotent release); `static until<T>(work, label): Promise<T>` (**passthrough** — returns the same promise; hold releases on settle); `static get active(): boolean`; `static labels(): readonly string[]`.

`active`/`labels` are **reactive** (one micro-proxy version signal, the Collection pattern) — `if="!Pending.active"` works; the departure warning and save-indicator UI read one counter and cannot disagree.

The `beforeunload` handler is installed only while the count > 0 and removed at zero — **a persistent handler disables bfcache; this conditionality is correctness, not economy**. Browsers show generic dialog text; labels are for logs/UI only.

In-app pushState navs: phase-1 check — `Pending.active` → `window.confirm`, abort cleanly on decline. **Known gap, documented:** SPA Back (popstate) is not intercepted (the deferred canLeave problem); departure with active holds narrates `Print('WARNING', 'departure with active holds: <labels>')`, from the popstate path and from the `beforeunload` handler alike. Holds are not cancellation; in-flight promises run to completion.

Every acquire/release narrates via `Print('STATE', …)`.


### 17.9 Links & startup

**Link pattern** (the reason §6.3 keeps `href` off the allowlist)**:** static `href` attribute + click interceptor — a click on an `<a href>`, same-origin, primary button, no modifier keys, not already `defaultPrevented` → `preventDefault` + `navigate()`. Middle-click, modifier clicks, and external hrefs pass through untouched. So do anchors that are not in-app navigation: an anchor with a `download` attribute, a `target` other than `_self`, or a `rel` containing `external`, and any href whose scheme is not `http` / `https` (`blob:`, `data:`, `mailto:`, `tel:`). *(2.2.4, #14)*

**URLs behave as in HTML.** `navigate(url)` parses its argument as a URL: an app-relative path, optionally followed by a query and a hash. An intercepted link calls `navigate()` with the link's path, query and hash, so a link and the equivalent `navigate()` call are one code path. Matching is path-only (§17.4). The query and hash are carried into the history entry unchanged, and a route's declared `query` converters parse the query of the URL being navigated to. Initial load and `popstate` keep the location's query and hash. *(2.2.4, #20/#28)*

**Fragments and scroll.** A link whose URL differs from the current one only by its fragment — including `href="#"` — is not intercepted: the browser scrolls (to the target, or to the top for an empty fragment) and no route work happens. A `popstate` that changes only the hash is likewise ignored. After a route navigation commits, the router scrolls to the element the hash identifies (`#top`, case-insensitive, is the top, as in HTML; a hash naming no element counts as no hash); a push without a hash starts at the top; on the initial load a hash target is scrolled to once the page is in place and, without one, the position is left to the browser. A page whose template root is a structural has that branch placed before the hash lookup (§5.4.4, #38). On Back / Forward the scroll position recorded for the entry being returned to is restored once the page has mounted; an entry the router never left has none, and its hash target, if any, applies instead. *(2.2.4, #28)*

The browser's `history.scrollRestoration` setting is left alone. Because `navigate()` reads a URL, its pathname is percent-encoded as a link's would be (`navigate('/café')` writes `/caf%C3%A9`).

**Startup route table:** `__DIAMOND_DEV__`-gated, one `Print('STATE', …)` **per route row** — line-oriented (greppable; survives wsSink). Columns: id, resolved full path, outlet, params, guard classes, redirect target. Tree flattened with indentation. Absent in prod. Format: Appendix D.

**Socket lifetime idiom (example, not feature):** open in `mounted()` and `registerCleanup(() => socket.close())` — the cleanup lands in the mount scope (§4.4); deferred-close via `Pending.until(flush).then(() => socket.close())` inside a cleanup. Transports request navigation through `router.navigate()` only (sole-history-writer). Boundary events beyond navigation are reserved v3 vocabulary (§17.7).

### 17.10 Exports and instance API (spec §11)

From `@diamondjs/runtime`'s single entry point, no subpaths: `Router`, `Guard`, `Pending`, and types `RouteMap`, `RouteDefinition`, `RouteId`, `Destination`, `QueryParams`, `GuardContext`. `Deny` was retired before it shipped (§17.7).

```typescript
class Router {
  constructor(routes: RouteMap, options?: { basePath?: string });   // §17.15
  configure(options: { narrate?: boolean }): void;                  // quiets per-nav narration
  start(root?: ParentNode): Promise<void>;                          // default: document
  stop(): void;
  navigate(url: string): Promise<void>;                             // app-relative URL (§17.9)
}
```

`start()` is idempotent; `stop()` disposes every occupant deepest-first and removes the click and `popstate` listeners.

### 17.11 Tooling: route-check

Standalone bin (stink-check posture), ships in `@diamondjs/dev` *(bin moved there in 2.2.2)*. **Errors speak route IDs.** Rules, each with pass+fail fixtures:

- **Grammar and structure:** `invalid-route-id`, `duplicate-route-id` (global, flattened), `wildcard-not-terminal`, `ambiguous-routes`, `param-missing-converter`.
- **Outlets:** `unknown-outlet`, `outlet-not-ancestor-owned`, `duplicate-outlet-name`.
- **Destinations** (§17.5): `unknown-redirect-target`, `unresolvable-route-path`, `site-path-shadows-route`, `external-redirect-invalid`, `static-target-has-params`, `redirect-cycle`, `destination-arm-mismatch`.
- **Guards:** `guard-check-not-overridden` (base `check` in use is almost certainly a mistake; the runtime fail-closed remains the backstop).

route-check loads consumer `.ts` route modules through tsx. Template (`*.diamond.html`) and style (`*.css`) imports load as inert stubs on both loader paths — `"type": "module"` consumers and CommonJS ones *(2.2.3, #10)* — verified on Node 20 and Node 22 *(2.2.4, #27)*; `@diamondjs/dev` requires tsx 4.23.15 or newer.

### 17.12 Meta-packages

`@diamondjs/app` = runtime + converters + primafacie + guards. `@diamondjs/dev` = compiler + parcel transformer + tool bins (stink-check, route-check). `@diamondjs/all` = union. **Exact-pin lockstep** at the release version — one tested constellation, never a range. CI check: `npm run check-meta`.

### 17.13 run_mode / `__DIAMOND_DEV__`

The Parcel transformer reads `<projectRoot>/app/config/config.json` → `app.settings.run_mode` (`"dev" | "prod"`) once per build. Dev/prod is a **build-time property**; flipping requires a rebuild. Fail-closed defaults: absent file or absent key → `prod`. Malformed JSON, or a `run_mode` other than `"dev"` / `"prod"` → **build error**, never a silent prod default. Compiled template modules receive `const __DIAMOND_DEV__ = <bool>` and mirror it onto `globalThis` for the runtime's dev-gated surfaces.

### 17.14 Normative reference route map

The reference map is an **ideation-mode fixture**: a hypothetical, project-agnostic application — **"Conveyor", a generic ingest-pipeline app** — whose tree exercises every structural shape the grammar offers: single child, multiple sibling children alternating in one outlet, children nested inside children (depth 3), static-beats-param specificity, converter parse-fail fall-through, a two-hop redirect chain, guard chains with subtree coverage, and a terminal wildcard. This map is the normative worked example; `packages/runtime/tests/router-reference-map.test.ts` exercises it verbatim, including the all-vectors leak-free exit criterion.

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

### 17.15 basePath

`new Router(routes, { basePath })`. Deployments at the domain root omit it (default `''`). An app served from a folder one-or-N levels deep sets `basePath` to the **public prefix as the browser sees it** — e.g. `'/tools/reports'`.

Normative rules:
- App code, RouteMap `path`s, guards, and `navigate()` always speak **app-relative** paths. The router strips/prepends the prefix only at its edges: location reads, history writes, link interception.
- The link interceptor claims only same-origin URLs **under** `basePath`; a sibling app one folder over passes through untouched.
- **Reverse proxies:** `basePath` must equal the prefix in the browser's address bar, not the origin server's filesystem path. If an upstream proxy rewrites paths (public `/app/x` → origin `/x`), configure the PUBLIC prefix. The router narrates a `WARNING` whenever the live location falls outside `basePath` — the misconfiguration tripwire for unreflected proxy rewrites.
- Asset URLs are the bundler's concern (Parcel `--public-url`), not the router's.

---

## 18. Appendices

### Appendix A — v1.5.1 → v2.3.0 token reference

| Concern | v1.5.1 (Aurelia-derived) | v2.3.0 |
|---|---|---|
| Unescaped escape hatch | `unsafe*` | `raw*` (`rawSet`, `rawBind`) |
| Static one-shot assignment | `.one-time` | `.set` / `.rawSet` |
| Directional binding | `.to-view` / `.from-view` | unchanged (+ `raw` counterparts; `from-view` now genuinely one-way) |
| Binding-update timing | `& updateTrigger:'blur'` | `property.update-on="blur"` |
| Handler debounce/throttle | `& debounce:500` | `this.debounce(fn, 500)` (self-registering) |
| `& signal` | `& signal` | make the dependency reactive |
| Value transform | `\| converterName` (resource) | `\| ConverterClass(args)` (static `format`/`parse`) |
| Transform location | `transform_functions/` folder | the import graph (`@import` for standalone) |
| Parse return | raw passthrough on missing `fromView` | `ParseResult<T>`; `parse` required on the inbound leg |
| Conditional | `if.bind="cond"` | bare `if="cond"` |
| Else branch | bare `else` | `else-if="!cond"`; bare `else` removed |
| Exhaustive multi-state | — | `<switch>` / `<case>` / `<default>` |
| List repetition | `repeat.for="x of xs"` | unchanged |
| Event handler | `click.trigger="fn()"` | `click.calls="fn()"` |
| Event delegation (command) | `click.delegate="fn()"` | removed (runtime `DiamondCore.delegate` API instead) |
| Capture-phase listener | `click.capture="fn()"` | unchanged |
| Scope rebinding | `with.bind="obj"` | removed entirely (view-model getter) |
| Dynamic attr/prop spread | — | `...attrs.bind` / `...attrs.rawBind` |
| Validation-error surface | — | `property.error-into="targetProp"` |
| Standalone provenance | (convention folder) | `<!-- @import { … } from './module' -->` |
| Literal `${` in text | — | `\${` or an entity (`&#36;{`) (2.2.4) |
| Lifecycle | constructor, `mount`, `update`, `unmount` (overridable) | constructor, `constructed`, `mounting`, `mounted`, `unmounting`, `unmounted`; `mount`/`unmount`/`dispose` final; `update` removed (2.3.0) |
| In-app navigation | — | static `href` + interceptor; `router.navigate(url)` (v2.2.0; URL form 2.2.4) |
| Template whitespace | trimmed | kept exactly as parsed (2.3.0) |
| Child component | `<child-component name.bind=…>` (design text, never shipped) | `<child-component name.to-view=…>` + `ref`, events via `emit` (proposed for v2.3.1) |

### Appendix B — Framework positioning

Against Aurelia 2.0: same template syntax lineage, but no DI (explicit imports), Proxy + `@reactive` instead of the observer system, `this` everywhere instead of `vm`/`self`/scope, `Collection` for large data, six named phases with one callback each instead of 8 hooks, and self-documenting compiled output. Against React: HTML templates instead of JSX, classes instead of hooks, `this.count` instead of `state`/`setState`, `Collection` instead of `useMemo`/`useCallback`. Against Vue 3: similar template syntax, `@reactive` instead of `ref()`/`reactive()`, no `.value` unwrapping. The unique value: the only framework explicitly designed for human-LLM collaborative development, with compiler-emitted semantic hints, universal `this`, and hybrid reactivity tuned for both small UI state and large datasets.

### Appendix C — Versioning posture

DiamondJS is the SemVer canary for the project fleet: the substrate everything else (Crystallizer, NetPad, the neuron tooling) builds on gets the honest compatibility contract first, and downstream expresses its dependency precisely (`@diamondjs/*@^2.2.0`). The v2.0 major captured the wholesale binding-language and security-model break; v2.1 was additive (switch, spread, collection/delegate, error-into, @import, source maps, primafacie, root cleanup); v2.2 added the router. Because the raw-path architecture means post-stability security hardening turns new raw call sites into audited escape hatches rather than breaking changes, the eventual clean stable line can hold — which is the argument for doing the foundational churn now, pre-stability, where it costs almost nothing.

The lifecycle hooks (§4.4) shipped in v2.3.0. The spec version tracks the published package version, release for release.

### Appendix D — Route-table line format

```
STATE: <ts> - <caller> - ~~~ route table: id | path | outlet | params | guards | redirect ~~~
STATE: <ts> - <caller> - ~~~ home | / | main | - | - | - ~~~
STATE: <ts> - <caller> - ~~~ workspace | /w | main | - | ExampleSSO | - ~~~
STATE: <ts> - <caller> - ~~~   item-detail | /w/items/:id | workspace-body | id:IntConverter | - | - ~~~
STATE: <ts> - <caller> - ~~~ legacy-home | /old | → route-id 'home' ~~~
```

### Appendix E — Rejected alternatives (recorded so they stay dead)

**Router:** Array RouteMap; declaration-order matching; `ComponentOutlet` wrapper class; scoped outlet addressing (`{outlet, owner}`); route-kind enums (`page|modal|toast`); bare guard functions; `dependencies` as a guard field name; guard lifecycle hook forest; `SecurityParticipant` ancestor class; overridable `run()` as the envelope; fluent/builder chains and any `Close()`-style unified teardown verb; URL-as-collaboration-state; hybrid branch cache; runtime-only outlet validation; dynamic outlet registration; guards skipping popstate/initial-load; **bare-string redirect sugar** (two spellings is two grammars — the tag is always present); **shape-inferred destination classification** (the string dual-form was designed, then rejected when `site-path` proved shape-indistinguishable from `route-path` — superseded by explicit tags).

**Structural directives:** the branch cache, and the keep-node/dispose-effects hybrid (§5.4).

**Lifecycle (2.3.0):** `on`-prefixed callback names (LC-2); overridable `mount()`/`unmount()` (LC-3); `update()` as a prop-change hook (LC-4 — the child's own reactivity is the notification); rollback by snapshot or mutation journal (LC-7 — rollback is by inventory).

**Text:** the newline rule (Vue's default) and a block-aware rule for template whitespace, and any compiler option for it (#15 — preserve matched plain HTML on 9 of 9 compared templates; the newline rule fails whenever a formatter turns a typed space into a line break); a whitespace-sensitive escape for `${` (it would break exactly where docs need it: `` `\${x}` ``, `"\${x}"`, `(\${x})`).

### Appendix F — Deferred (recorded)

**Router:** `canLeave` with popstate veto semantics (history stamping ships now as forward-compat); keep-alive/route caching; stacked overlay routing; transitions; data resolvers; compiler-lowered `<outlet>`; `ctx.state` request-scoped store; parameterized guards (`{ use, state }`); the `challenge` decision type; guards battery mid-classes (scaffolded; first families land with the first consuming app's guard inventory). ~~base-path~~ — shipped in 2.2.0 (§17.15). ~~Scroll restoration~~ — shipped in 2.2.4 (§17.9).

**Components (v2.3.1):** template component composition, C-1…C-10 (§4.5); `fold` as a static (D-24). Beyond v2.3.1: slots / content projection; `ref` inside `repeat.for`.

**Lifecycle (out of scope for the Lifecycle Contract record, LC-16):** a mutation journal / value rollback; a `Request` async-operation battery (beside `Pending`, separate package); retained delivery of writes to not-yet-connected targets; a `visible` / has-a-box phase; compiler site ids; a persistence exporter for the lifecycle ring (that is `wsSink`); any prop-batch callback.

**Elsewhere:** attribute-interpolation support (diagnosed since 2.1.1); `Print` caller-name compiler memoization; the mount-outside-`captureScope` leak heuristic (dev warning, primafacie backlog); structured `ParseResult.error`; `asset.setMap`.

### Appendix G — Version changelog

Each entry lists what this specification gained or changed in that release. The narrative account of how each was built is `impl_docs/project_update_log.md`; package-level notes are `CHANGELOG.md`.

**2.3.0** *(this document)*
- §5.9: template text kept exactly as the HTML parser produces it; whitespace consumed as syntax limited to (a)–(d); the lossless property; closes D-22 (#15).
- §13.1 / §13.5 / §13.6: static text takes no variable and is emitted as `append` arguments, one call per parent; mounted-output shape is markup plus the listed framework nodes.
- §4.5: template component composition, C-1…C-10, recorded as a proposal for v2.3.1; §12.3 lists its proposed codes.
- §4: the Lifecycle Contract — six phases, one callback each; `mount`/`unmount`/`dispose` final with a construction-time override guard; `update()` removed; instance and mount scopes; `mounted` means connected; child-first delivery; rollback by inventory; generations; terminal `faulted`/`disposed`; the lifecycle record and its emissions; `DiamondCore.child` (§4.2, §4.4–§4.7, §17.2); `whileMounted`; public `Scope` operations. Closes lifecycle defects P-1…P-6 and #38; records D-24 (deferred to v2.3.1).
- §5.4.4: a root-level structural is placed by the connection drain, before `mounted()` and before the router's hash scroll (#38, D-25). §7.2: `captureScope` disposes on throw; `effect()` registers into the current scope.
- §11: `Scope`, `ScopeFailure`, `fold`, `Phase`, `Cause` and `LifecycleRecord` exported; the scope operations and `child` on `DiamondCore`; `trackRange` gains `nodes()`. §12.5: lifecycle emissions and the detached-root warning; the new runtime throws. §14: figures at `07cf171`.
- §15: `Print` carries the lifecycle emissions. §16: D-23 kept open, D-24 recorded; the lifecycle defects and D-22 listed as closed; D-26, D-27 and D-28 recorded by the 2.3.0 audit of this document against the code. Appendix A: the lifecycle and whitespace rows. Appendices E/F: the rejected lifecycle alternatives and the record's out-of-scope list.

**2.2.4**
- §5.2: literal `${` (#29) and literal author text in compiled output (#19).
- §5.4: `if`/`else-if` chain whitespace (#18); mounted ranges and the `<!---->` start marker (#17) — §5.4.4.
- §5.9: the whitespace-as-syntax list; content trimming recorded as D-22 (#15).
- §7.1: arrays reactive in place (#26).
- §10.4: build order (#25).
- §12: `escaped-interpolation` (info); `attr-interpolation-unsupported` reads the raw source.
- §13: hint comments fold line breaks; control characters emitted as escapes (#19); mounted-output shape (§13.6).
- §17.9: link pass-throughs (#14), URLs behave as in HTML, fragments and scroll (#20, #28); §17.11 Node 22 / tsx ≥ 4.23.15 (#27).
- Consolidation: the v2.1 spec, A3 and the Router Specification become this one document; the router is §17; the specs move to `docs/spec/vX.Y.Z/`.

**2.2.3**
- §5.4.4: structurals render on first mount — anchor appended before wiring; a detached anchor is placed on the next microtask (#7).
- §5.7 / §13.5: `<select>` wiring after its options (#9).
- §6.3: static inert `<a>`/`<area>` `href` exception; `role` is inert metadata; `isInertMetadataKey` (#8).
- §7.1: `@reactive` under [[Define]] class fields (#11).
- §17.11: route-check loads template/style imports as stubs (#10).

**2.2.2**
- §14: first publication of all nine packages; `@diamondjs/dev` carries the full toolchain and the `stink-check` / `route-check` bins; dev-toolchain budget 800 (total 9,500).

**2.2.1**
- §1: explicit-discriminants meta-rule. §17.5: `Destination`, one tagged union for redirects and guard denials; `Deny` retired; the Destination route-check rules.
- `IntConverter`, `SlugConverter`; the `app` / `dev` / `all` meta-packages with exact-pin lockstep (§17.12).

**2.2.0**
- §17: the router — pipeline and transaction model, RouteMap grammar, specificity matching, outlets, guards and their envelope, `Pending`, links, route-check, `run_mode` / `__DIAMOND_DEV__`, the reference route map, `basePath`.
- §1: language-first composition meta-rule. §15: one logging vocabulary through `Print` (A3 §3), primafacie additions. §6.6 / §12.5: runtime warnings prod-visible (A3 §4). §10.2: `<outlet` detection (D-18 narrowed). `@diamondjs/guards` scaffold.

**2.1.1** (Amendment A3)
- Conformance patch: D-1 (dispose on detach), D-2, D-3 (diagnosed), D-5, D-6 (guarded), D-7, D-8, D-9, D-10, D-12, D-15/D-20, D-21 (§4.5 as design intent; `component-composition-unsupported`).

**2.1.0** — the v2.1 specification (`docs/spec/v2.1.0/`): `switch`, gated spread, `Collection`, `delegate`, two-way converter chains, `error-into`, `@import`, VLQ source maps, primafacie. **2.0.0** — the v2.0 Design Decision Record. **1.5.1** and earlier — `docs/spec/v1.5.1/`.

---

*End of specification. The spec is authoritative over the code; §16 is the current conformance delta, not a softening of the contracts above.*
