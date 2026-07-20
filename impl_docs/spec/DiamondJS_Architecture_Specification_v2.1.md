# DiamondJS — Architecture & Design Specification v2.1

**Status:** Ratified · state-of-the-world for shipped `v2.1-implementation` @ `00db3c6` (2026-07-20)
**Author:** Joe Hacobian
**Supersedes:** the v1.5.1 architecture spec, the v2.0 Design Decision Record (with Amendment A1 folded in), and Amendment A2. Those remain the *rationale* archive; this document is the single authoritative *reference*.

**Consolidation basis:** v1.5.1 base architecture → v2.0 DDR (security overhaul; A1 else/switch folded in) → Amendment A2 (the v2.1 implementation record). Every decision below is traceable to one of those; where they conflicted or a later record refined an earlier one, the later governs and the older reasoning is named so it stays settled.

---

## 0. How to read this document

This is a **specification**, and under the project's standing rule the spec is authoritative over the code: where shipped v2.1 diverges from what this document states, the *code* is nonconforming, not the spec. That rule only works if the divergences are visible rather than buried, so two conventions run throughout:

- The **body** states the intended, authoritative contract — what a conforming DiamondJS must do.
- Where shipped v2.1 does **not** currently meet that contract, an inline **⚠ Defect D-n** pointer marks the spot, and the full mechanism, severity, and disposition (fix-the-code vs. accept-as-limitation vs. correct-the-record) live in **§16 (Conformance & Known Limitations)**. Nothing the recon surfaced is smoothed over.

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
17. Appendices

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

---

## 2. Architecture overview

### 2.1 The three-layer model

**Layer 1 — Write-time (human + LLM friendly).** ES2022+ TypeScript; Aurelia-descended template syntax; `@reactive` decorators; explicit imports; component triplets (`.ts` + `.html`/`.diamond.html` + `.css`).

**Layer 2 — Build-time (compiler).** A Parcel 2 transformer compiles templates into an instance `createTemplate()` method injected into the component class; `@reactive` lowers to `DiamondCore.makeReactive()`; `[Diamond]` semantic-hint comments are injected; a compile-time security gate audits every statically-known sink write; VLQ source maps are generated (see §16, D-11, for their reachability).

**Layer 3 — Debug-time (LLM comprehensible).** Explicit `DiamondCore` method calls; `this` refers to the component instance everywhere; no hidden state, no DI container; every transformation carries a `[Diamond]` hint.

### 2.2 What was eliminated relative to Aurelia 2.0

The DI container, the runtime template compiler, the complex observer system, the 8-hook lifecycle, and the decorator-metadata system are all gone — replaced by ES-module imports, build-time compilation, Proxy reactivity + `@reactive`, a 4-hook lifecycle, and compiler transformation respectively. The runtime that remains is a small library of explicit functions (see §14 for actual LOC).

---

## 3. Core constraints

### 3.1 Hard constraints (non-negotiable)

1. **Runtime LOC budget:** < 2,500 production lines.
2. **Compiler LOC budget:** < 5,000 lines (as measured by the budget tool, which counts `src/__tests__/`; see §14).
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

### 3.3 Budget accounting note

The budget tool (`tools/check-loc-budget.ts`) shells out to `cloc` over `packages/*/src`, which for the compiler and parcel plugin includes their `__tests__/` suites. Production-only figures differ materially and are the honest structural numbers (§14). The tool also currently **fails open** on a `cloc` resolution error (§16 D-9).

---

## 4. Component system

### 4.1 File organization

Configurable discovery (`diamond.config.js`) supports `flat` mode (`./components/my-component.{ts,html,css}`) and `nested` mode (`./components/my-component/my-component.{ts,html,css}`). Nested mode uses `component-name.*`, **never** `index.*`, so every open editor tab names its own component (the v1.5.1 fix that eliminated multi-developer filename ambiguity). Scaffolded files carry a `[Diamond]` comment header stating the folder→basename convention.

### 4.2 Canonical component

```typescript
import { Component, reactive } from '@diamondjs/runtime';
import { someService } from '../services/some-service';

export class MyComponent extends Component {
  @reactive name: string = '';       // reactive → drives the UI
  @reactive count: number = 0;
  private service = someService;      // bare → inert bookkeeping

  constructor() { super(); }

  mount(host: HTMLElement) { super.mount(host); /* post-render DOM work */ }
  update(next: Partial<this>) { /* react to prop changes */ Object.assign(this, next); }
  unmount() { super.unmount(); /* extra cleanup */ }

  handleClick() { this.name = 'Updated'; }   // `this` is always the component
}
```

Key decisions: `@reactive` is the single reactivity declaration (decorated drives the UI; bare is inert — no class-level "YOLO mode"); explicit imports, no constructor injection; **4 lifecycle hooks** (constructor, mount, update, unmount); `extends Component`; `this` is `this` everywhere.

### 4.3 The instance-template model

`createTemplate()` is a compiler-generated **instance** method (not a static factory returning a closure). The same `this` appears in the class body and the template — one referent, no `vm`/`self` context-switch. The static-factory pattern was eliminated in v1.5 because it forced two referents for one component (`this.count` in code, `vm.count` in template) to save kilobytes that are negligible for target apps (<50K LOC, 50–200 live instances); `Collection` already handles data scaling.

### 4.4 The `Component` base class contract

```typescript
export abstract class Component {
  protected element: HTMLElement | null;
  createTemplate(): HTMLElement;                  // public; throws until compiler-injected
  mount(host: HTMLElement): void;                 // public
  update(next: Partial<this>): void;              // public — body is Object.assign(this, next)
  unmount(): void;                                // public
  getElement(): HTMLElement | null;               // public
  protected registerCleanup(fn: () => void): void;
  protected debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void;
  protected throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void;
}
```

`mount()` wraps `createTemplate()` in `DiamondCore.captureScope()` and registers the returned disposer, which is what makes **root-level** `bind`/`on`/`if`/`repeat`/`switch` cleanups survive to `unmount()` (without the wrapper, `currentScope` is `null` at the root and `track()` silently discards). `debounce`/`throttle` are `protected` and **self-register** their `cancel` against the cleanup registry at creation time, so the class-field one-liner `handleInput = this.debounce(v => this.query = v, 500)` is leak-safe with no visible timer-cancel burden. This relies on JS field-init order: base fields (`cleanups = []`) initialize during `super()`, before any subclass field initializer runs.

> **Re-mount caveat.** `unmount()` empties the cleanup registry. A component that is unmounted and re-mounted works, but `debounce`/`throttle` cancels registered at *construction* were dropped on the first unmount and are not re-registered. Calling `mount()` twice without an intervening `unmount()` is unguarded and leaks the first DOM subtree (§16 D-6).

### 4.5 Parent–child communication

**Props down, explicit:** `<child-component name.bind="parentName">` compiles to a `child.update({ name: this.parentName })` inside an effect. **Events up, standard DOM:** children `dispatchEvent(new CustomEvent(...))`; parents handle via `event-name.calls="handler($event)"`. No implicit event bus — all communication is explicit and traceable.

---

## 5. Template DSL

This chapter defines the complete v2.1 template grammar. The before/after token reference against v1.5.1 is in Appendix A.

### 5.1 Attribute binding grammar

Bindings are **attribute-based and element-scoped**, not statement-based. An attribute name is split on `.` into **2 or 3 segments**:

- **2-segment** `property.command` — e.g. `value.set`, `value.bind`, `value.to-view`, `value.from-view`, `value.two-way`, `value.rawSet`, `click.calls`, `panel.capture`.
- **3-segment** `property.command.qualifier` — the raw *directional* escape hatch: `innerHTML.rawBind.to-view`, `innerHTML.rawBind.from-view`, `innerHTML.rawBind.two-way`.

> **parse5 lowercases attribute names.** `innerHTML.rawBind.to-view` reaches the compiler as `innerhtml.rawbind.to-view`. The camelCase legibility of `rawBind`/`rawSet` is a **source-only affordance**; the property segment is canonicalized through `PROPERTY_NAME_MAP` and command matching is lowercase-keyed. Internally a binding is `{ type, raw }` where `type` is the operation and `raw` is a boolean — the source surface stays three-segment; flattened tokens like `rawTo-view` never exist.

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

> ⚠ **Attribute interpolation is not supported and currently fails silently** (§16 D-3). `<div title="Hello ${name}">` compiles the literal string `Hello ${name}` with no diagnostic. Use `title.to-view="'Hello ' + name"` (or a getter). A conforming compiler must diagnose or support attribute interpolation; v2.1 does neither.

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

#### 5.3.3 Contextual parse obligation (§5.6)

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

From-view runtime semantics: `valid: true` → write `value` to the model; `valid: false` → **do not write** (model keeps its last good value), **keep `raw` in the input** (never clobber mid-type text), expose `valid`/`error` to the validation surface. Parse owns **type/format** validity only ("is this a valid currency string"), not business rules ("amount < $10,000") — those live in the component, or the battery stops being reusable.

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

#### 5.4.1 `if` / `else-if`

`if="condition"` **conditionally includes the element in the DOM** (removes it entirely when false — not `display:none`). Bare `if`, no suffix: `if` has no sink (the boolean never flows into the DOM as content → no injection surface → no `raw` variant, and `rawIf`/`if.set`/`if.bind` are all errors), and `if` is always reactive. `if` is a JS reserved word, so it cannot collide with a property named `if` — which is also how the parser recognizes the structural form.

`else-if="condition"` is retained; **bare `else` is removed** (`bare-else-removed` error). Bare `else` is a valueless positional marker whose pairing must be resolved by scanning upward through arbitrary nesting — a whole bug class with no compile-time signal (the structured-programming argument restated for template DSLs). `else-if` survives because its condition is self-describing: a model reading `<div else-if="hasError">` knows the meaning without lookback. The catch-all case is written as an explicit standalone negated `if` (`if="!isLoading && !hasError && !isReady"`), which documents the asserted state space and breaks loudly when a new state is added — strictly more informative than "none of the above." For exhaustive multi-state with a guaranteed catch-all, use `switch` (§5.4.3).

Lowering: `DiamondCore.if(anchor, branches)`, where each branch is `{ when, make }`; a residual bare-`else` equivalent is a final branch with `when: () => true`.

> ⚠ **A toggled-off `if`/`else-if` branch is detached but its reactive effects stay subscribed** (§16 D-1). This is a real defect, not intended behavior; disposal currently happens only at containing-scope teardown.

#### 5.4.2 `repeat.for`

```html
<li repeat.for="user of users">${user.name}</li>
```

The one and only looping construct — no `while`, no `repeat-until`, no `forEach` variant. Lowering: `DiamondCore.repeat(anchor, itemsGetter, makeItem)`. Reconciliation **keys on item identity** (which is why `Collection` never proxies its items — a proxy wrapper would break keying and the `itemRegistry` that `delegate` resolves through).

> ⚠ **Two shipped defects touch `repeat`** (§16): keying on the raw item means **duplicate primitive items** (repeated strings/numbers) render extra rows that accumulate on every update and orphan nodes (D-2); and the render path **re-inserts every node on every update** (O(n) DOM mutations per change), so the "O(1) append" property belongs to `Collection` the data structure, not to the render (D-4).

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
- **Full erasure:** all three elements are compile-time erased — no DOM container ships; multi-root case bodies mount as `DocumentFragment`s via `combineRoots`. Any attribute beyond `switch[on]` / `case[if]` is an error (the elements have no DOM target).

**Lowering (Option B + Option A fast path):** reactive `on=` lowers to `DiamondCore.switch(anchor, onGetter, cases, defaultMake?)`, mirroring `if()` (lazy `captureScope` builds, branch cache, detach-not-destroy). The **static fast path** applies iff `on=` is a **pure literal** AND every case is equality-kind — then only the winning branch's DOM code is emitted, zero runtime cost. A statically-dead switch (static `on=` matching no case, no `<default>`) emits a **`switch-static-dead` warning** plus an inspectable DOM comment carrying the dead source — never silently dropped, never a build blocker.

> ⚠ Same detached-branch defect as `if` (§16 D-1). Also: `switch-static-dead` is a `warn`-severity, non-`stink:` code and currently slips the stink gate (§16 D-8).

### 5.5 Events

Two commands, both naming what they do without a misleading actor:

```html
<button click.calls="save()">      <!-- bubble phase (default) -->
<div panel.capture="intercept()">  <!-- capture phase -->
```

`.calls` (not `.trigger`): "click **calls** save" reads left-to-right subject-verb-object with the event as grammatical subject — the correct causation direction. `.trigger` implied framework-as-actor; `.triggers` collides with jQuery's *dispatch* sense (a model with jQuery in weights hallucinates a conflict); `.on` is correct but reads as idiom rather than prose. `.capture` is its own command (not a modifier) — the event capture phase is a real DOM primitive with no other access path, semantically distinct enough from default-phase to warrant explicitness. Both lower to `DiamondCore.on(el, event, handler, capture?)` (`addEventListener`); neither is sink-gated (no sink write). Event hints are the one family that prints the `this.` prefix (`click → this.save()`).

The Aurelia `.delegate` event-command is **removed** (`delegate` is a hard parse error suggesting a per-node `.calls`). Note the name is simultaneously *retired template grammar* and a *live runtime API* — see §9.

### 5.6 Attribute spread

```html
<input type="text" ...attrs.bind="myGuts">
```

Only two forms exist; anything else is `bad-spread`. The compiler emits `DiamondCore.spread(el, () => expr[, true])` in **attribute source order** relative to sibling bindings (mount-time "source order wins"; after mount, standard reactive last-effect-wins). Per key at runtime: **gate FIRST** (canonicalize, then `SAFE_SINKS ∪ data-*/aria-*`; unknown keys fail closed with a dev-only warn-once), **branch SECOND** (`canonical in el && !data/aria` → property; else `setAttribute(String(value))`, or `removeAttribute` on nullish). Security stays orthogonal to precedence: source order picks *which value*, the allowlist picks *whether it is allowed at all* — so `{type:'password'}` wins over `text` by order while a co-occurring `{onclick}` fails closed. `...attrs.rawBind` bypasses the runtime gate entirely (developer owns every key) and emits a heavy `stink:declared`. Key-removal reconciliation restores property keys to their pre-spread snapshot and removes attribute keys; the reactive proxy gains `ownKeys` + `deleteProperty` traps (an `ITERATE_KEY` sentinel) so key add/delete on a spread source retriggers.

### 5.7 Binding timing & handler timing

The two concerns Aurelia overloaded onto `&` are cleaved:

- **Binding-update timing** — *when a two-way binding samples the DOM* — is `property.update-on`, property-scoped in the `property.command` grammar: `<input value.two-way="amount | Currency('USD')" value.update-on="blur">`. Bare `update-on` is an error (ambiguous on multi-binding elements). It lowers to the 5th `eventName` argument of `DiamondCore.bind`, applied only to the inbound listener. A *validating* parser wants `update-on="blur"` (per-keystroke validation of mid-type text is hostile).
- **Handler timing** — *debouncing a handler* — leaves the template for visible class code: `handleInput = this.debounce(v => this.query = v, 500)` (§4.4). The common real-time case picks the right half automatically: a debounced search wants the *model* live and the *side-effect* debounced.

`&` is **gone, not relocated.** A lone `&` (not `&&`) anywhere in a binding/interpolation/spread expression is a **hard error** (`ampersand-removed`), and this includes bitwise `&`: a template is a declarative binding surface, not a computation surface (there is no legitimate bitwise `&` in a binding any more than in a SQL `WHERE` or CSS selector). Both bitwise and behavior-`&` should leave the template; the diagnostic redirects both (bitwise → view-model getter; behavior → `update-on` / `this.debounce` / a reactive dependency). Softening this to a warning was rejected — softening a security-adjacent error is how holes open. Aurelia's `signal` maps to *making the dependency reactive* (no hidden re-eval trigger); `oneTime` maps to `set`.

### 5.8 Standalone templates & `@import`

A standalone `.diamond.html` compiled to a module cannot import a named pipe transform (its only import is `DiamondCore`), so uncovered pipe heads error `pipe-transform-standalone`. The `@import` directive supplies provenance from the raw template text:

```html
<!-- @import { CurrencyConverter, Trim } from './converters' -->
```

**v1 restrictions:** named imports only — no aliasing, no default/namespace forms; malformed `@import`-shaped comments error loudly (`bad-import-directive`); duplicates error (`import-directive-duplicate`); unused names are info (`import-directive-unused`). The Parcel wrapper emits the directives as real import lines (specs resolve relative to the asset), `pipe-transform-standalone` fires only for **uncovered** heads, and §5.3.3 obligations are verified against the synthesized imports via the public `DiamondCompiler.verifyObligations()`. `with` is not part of this or any grammar — it was removed outright (TypeScript rejects the `with` statement, strict-mode throws, and a template `with` reproduces exactly the non-local-scope confusion the keyword is reviled for); the one legitimate need (deep repeated access) is a view-model getter.

---

## 6. Security model

The heart of v2.0, carried whole into v2.1. The work that triggered the entire refactor: a security PR addressing XSS via DOM sinks, escalated into a system-wide audit so *every* surface gains security-by-default with an audited `raw` escape hatch.

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

> **This list is design-derived and unrefined, not empirically hardened.** It is byte-for-byte the Phase-1 starter set; the "refine empirically" step (the §11.2 NetPad probe) has **not** happened (§16 D-14). Describe it accordingly.

**Off-list** (require `raw`, fail closed): `innerHTML`, `outerHTML`, `srcdoc`, `href`, `src`, `srcset`, `action`/`formAction`, `style`/`cssText`, all `on*`, and everything unenumerated. `href` is deliberately off-list — SPA links use a static `href` attribute plus a `.calls` click-interceptor, never a dynamic `href` bind.

`PROPERTY_NAME_MAP` is a **canonicalizer, not an allowlist**: it maps lowercase author input to canonical property names (`innerhtml → innerHTML`), and it deliberately contains *dangerous* names so a lowercase-authored `innerhtml` canonicalizes to the exact name the gate rejects and the diagnostic names correctly. Map membership is not blessing. Any safe sink whose camelCase differs from lowercase must appear in the map or it fails closed as a false positive; the invariant `SAFE_SINKS ⊆ PROPERTY_NAME_MAP ∪ lowercase-identical` is tested. *The runtime test (checking `map[lowercase(sink)] === sink`) is normative; the compiler test is weaker (§16 D-15).*

`data-*` / `aria-*` keys pass the gate **through the attribute branch** — inert metadata, never parsed as HTML/script/URL — applied consistently at both the runtime spread gate and compile-time `gateSink`. Inbound ops on dashed names error (`attr-binding-outbound-only`): there is no DOM property to sample. Other dashed names still fail closed.

### 6.4 Coverage map — three threats, three mechanisms

| # | Threat | Mechanism | Where |
|---|---|---|---|
| 1 | Outbound sink writes, statically-known target | Compile-time allowlist gate at codegen | Single choke point upstream of runtime path divergence; covers `set`/`rawSet`/`bind`/`rawBind` (see D-13 for the `from-view` exemption and D-10 for the static-attr gap) |
| 2 | Outbound sink writes, statically-unknown target (attribute spread) | Runtime allowlist gate inside the emitted loop | Dynamic keys are unknowable at compile time |
| 3 | Inbound model writes carrying display-formatted strings | Runtime proxy `set`-trap smell check | The value is only knowable at runtime (§6.6) |

The compile-time gate is a **permission/audit decision, not a transformation**: the emitted bytes for `innerHTML` are identical declared vs. undeclared. "Fails closed" means *blocked at merge/publish by the stink gate*, not *neutered at runtime*. You cannot make `innerHTML` safe with code — only with a declaration; the gate forces that declaration into the reviewed baseline.

### 6.5 Two-tier stink biscuit

- **`stink:warn`** (unresolved unsafe-sink write; nobody declared it) → **hard gate.** A latent bug by definition; the stink-check tool counts these and `process.exit(1)` on any count > 0 (wired into `prepublishOnly`).
- **`stink:declared`** (intentional raw) → **don't gate; baseline it.** A snapshot of the declared-raw set is checked into `stink-baseline.json`. A *new* raw not in the baseline doesn't block the build but **changes the baseline file, and that diff lands in code review.** The tripwire is not "block raw" — it is **"raw cannot be added invisibly."**

> ⚠ Two shipped gaps in that tripwire: static attributes bypass the compile-time gate entirely, so an inline `<div onclick="alert(1)">` compiles with *no diagnostic and no baseline diff* (§16 D-10); and the RAW audit banner asserts "audited in stink-baseline.json" unconditionally even on a binding's first-ever compile (§16 D-12).

### 6.6 Inbound smell check

The runtime proxy `set`-trap runs a **dev-only, warn-once-per-property** heuristic (`NODE_ENV !== 'production'`, string-check first, hoisted regexes) for three corruption shapes: a number receiving a non-numeric string, a canonical ISO date receiving a `/`-formatted date-ish string, and a canonical 10-digit phone receiving a formatted string. This is an explicitly **thin, best-effort backstop** — the real defense is the compile-time §5.3.3 parse-required obligation; heuristic false positives are accepted as dev noise.

### 6.7 The unified mechanism

The pipe (§5.3), the raw path (§6.1), and the audit (§6.5) are **one mechanism, not three features.** A declared, audited XSS escape hatch *is* a sanitizer in a pipe on a raw binding:

```html
innerHTML.rawBind.to-view="userHtml | sanitizeHtml"
```

That single expression says: you're doing `innerHTML` (off-list → forced to `rawBind` → fails closed if forgotten), you routed it through a named transform, and the biscuit records both as one greppable, baseline-diffable line. Keeping the pipe is not in tension with the security work — the pipe is the security work's declaration surface.

---

## 7. Reactivity & binding engine

### 7.1 The model

`@reactive` on a property declares "this drives the UI"; it lowers to `DiamondCore.makeReactive()`. Reactive objects are Proxy-wrapped by a single internal `ReactivityEngine`; reads inside an effect register a dependency, writes retrigger dependents. `DiamondCore.effect(fn)` runs `fn`, tracks its reads, and re-runs on change, returning a disposer. `DiamondCore.reactive(obj)` wraps an object; `DiamondCore.computed(getter)` returns a memoized getter. A `WeakMap` proxy cache preserves referential identity for deep reactivity.

The public reactivity surface is `DiamondCore.effect` / `.computed` / `.reactive` / `.makeReactive`. `ReactivityEngine`, the engine singleton, `ITERATE_KEY`, `Scheduler`, and the scheduler singleton are **internal** — there is no public way to force a synchronous effect flush.

> ⚠ `DiamondCore.computed` is public but **not emitted by the compiler and its caching is currently defeated** (it re-runs on every dependency change) — dead public surface (§16 D-16). The nested-effect `activeEffect` handling is also a latent trap for any future primitive that reads *after* building (§16 D-17); all current codegen reads dependencies before building, so nothing triggers it today.

### 7.2 Scheduling & disposal

Effects are batched onto a microtask queue with `Set` dedupe, so N synchronous mutations collapse into one flush (this is what makes `Collection`'s 10k-push case one render). `DiamondCore.captureScope(fn)` runs `fn` while collecting every `bind`/`on`/`if`/`switch`/`repeat`/`spread`/`delegate` cleanup created during it, returning `{ value, cleanup }`. `Component.mount` wraps `createTemplate()` in `captureScope` and registers the disposer, so **root-level and nested** bindings all dispose on `unmount()`, uniformly with structural-directive subtrees.

> ⚠ **Two disposal defects undercut the uniformity claim** (§16): a mutation in the same synchronous tick as `unmount()` leaves a queued effect that **re-subscribes itself** on its post-unmount flush, retaining the unmounted component and its detached DOM for the reactive object's lifetime — a persistent retention leak on an ordinary route-change/list-removal shape (D-7, highest severity); and `if`/`switch` toggled-off branches keep live effects doing unbounded work until *containing-scope* teardown (D-1). `repeat` row disposal and `captureScope` teardown are both correct — the defect is scoped to the `if`/`switch` toggle path and the disposal/flush race.

---

## 8. Collections

`Collection<T>` is the 2.1a collection-at-scale primitive: tens of thousands of items, sorted/searched/accessed efficiently, O(1) amortized append, **no per-item proxy overhead**. Factory `DiamondCore.collection(items?, { key? })` or `new Collection(...)`.

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

`DiamondCore.delegate` is the 2.1b homogenized event-delegation surface — a clean-slate design, **not** a salvage of Aurelia's removed `.delegate` stub:

```typescript
static delegate<T = unknown>(
  container: Element,
  eventType: string,
  selector: string,
  handler: (item: T, event: Event, node: Element) => void
): () => void;
```

One container listener; `event.target.closest(selector)` + containment check; upward walk to the first node registered in `repeat`'s node→item `WeakMap` (populated at row build, deleted at row disposal); the handler receives the **data item** identically for reactive-array and `Collection` sources (that uniformity *is* the "homogenized" requirement). `container` is `Element` (SVG works); `matchedNode` is the selector match, not the registered row node; a selector match with no registered item is a **silent no-op**; the listener is non-capturing; the cleanup self-registers.

**Runtime-API-only in v2.1** — there is no template grammar for delegation (unspecified by the DDR; also protects the parcel-plugin LOC ceiling). The registry is populated exclusively by `repeat`, so `delegate` resolves items only for `repeat`-produced nodes. Note the naming split: `click.delegate="f()"` in a template is a hard parse error; `DiamondCore.delegate(...)` in TypeScript is the supported API.

---

## 10. Build system

### 10.1 Pipeline

`.diamond.html` / `.html` template → parse5 (HTML→AST) → transform (bindings → `DiamondCore` calls; pipes → composed function calls + provenance; structural directives → `if`/`switch`/`repeat` lowerings; spread → `spread` loop; `@import` → import lines) → generate the instance `createTemplate()` with `[Diamond]` hints → emit with a source map. The compiler is `build-time only`; the browser never sees a parser.

### 10.2 Parcel transformer

`@diamondjs/parcel-transformer-diamond` detects Diamond templates via `isDiamondTemplate`, compiles, and maps diagnostic severities onto `@diamondjs/primafacie` log types. It **throws on `severity: 'error'`** (retired/unknown commands = broken source) and passes `warn`/`declared`/`info` through silently — enforcement is the out-of-band stink-check merge gate, not local dev.

`isDiamondTemplate` detects the v2.0 command surface (`calls`, `set`, `rawset`, `rawbind`, `capture`, `bind`, `to-view`, `from-view`, `two-way`) plus `<switch` and `repeat.for=`, **and retains the retired tokens** (`trigger`, `delegate`, `one-time`) so a stale `.trigger` file is still detected, compiled, and served the helpful rename diagnostic rather than silently shipped as raw HTML. Bare `if=` is deliberately excluded (false-positive claims on non-Diamond HTML would break builds loudly); an if-only template with zero bindings/interpolations is a documented blind spot — which also covers `else-if`-only and `case`/`default`-only fragments (§16 D-18).

### 10.3 Source maps

The compiler emits real base64-VLQ Source Map V3 mappings (hand-rolled, dependency-free, line-level). **Documented caveat:** the map is relative to the bare `createTemplate()` snippet; `compileAndInject` insertion and the Parcel module wrapper shift lines. Full `asset.setMap` wiring is deferred — and the Parcel transformer currently passes `sourceMap = false`, so the maps are **not reachable on the default toolchain** at all (§16 D-11).

---

## 11. Runtime API reference

`@diamondjs/runtime` exposes a single entry point (no subpath exports; deep imports are impossible). Public surface, verbatim:

```typescript
// index.ts
export { DiamondCore } from './core'           // also the default export
export { Component } from './component'
export { Collection, type CollectionOptions } from './collection'
export { reactive } from './decorators'
export { ParseResult } from './parse-result'
export { SAFE_SINKS, PROPERTY_NAME_MAP, canonicalizeSinkKey, isDataOrAriaKey } from './security'
```

### 11.1 `DiamondCore` (static namespace)

```typescript
static captureScope<T>(fn: () => T): { value: T; cleanup: () => void };
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
```

`bind`'s third argument is a **required positional slot holding an optionally-`undefined` value** (typed `(() => unknown) | undefined`, no `?`), so callers must pass it; `from-view` passes the literal `undefined`. Anchors for `if`/`switch`/`repeat` are **trailing markers** — rendered content inserts immediately *before* the anchor. `internal`: `currentScope`, `track`, `itemRegistry`, `getInputEventName` are `private static` and not on the contract.

### 11.2 `Component`, `Collection`, `ParseResult`

See §4.4 (`Component`), §8 (`Collection<T>` / `CollectionOptions<T>`), and §5.3.4 (`ParseResult<T>` interface + `ok`/`fail`). `registerCleanup`/`debounce`/`throttle` are `protected` (subclass-only); the rest of `Component` is public. `ParseResult` exports the value (the const); the interface is reachable through the same specifier.

---

## 12. Diagnostics catalog

The compiler returns `diagnostics: Diagnostic[]` on `CompileResult`; each is `{ code, severity, message, location? }`. Severity is `error` | `warn` | `declared` | `info`, surfaced by the stink tool as `error` / `stink:warn` / `stink:declared` / `info`. **Message text is authoritative in source**; this table is the contract of *which codes exist, at what severity, on what trigger*. (A handful of codes are constructed dynamically — noted inline.)

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
| `retired-command` | a command in `{one-time, trigger, delegate}` (one code, three message variants) |
| `unknown-command` | a command in neither the active nor retired map |
| `ampersand-removed` | a lone `&` in a binding/spread/interpolation expression |

### 12.2 Generator diagnostics

| Code | Severity | Trigger |
|---|---|---|
| `orphan-else-if` | error | `else-if` not absorbed by a preceding `if`/`else-if` chain |
| `attr-binding-outbound-only` | error | a dashed property bound `bind`/`two-way`/`from-view` (fires *in addition to* a prior `stink:warn` from the gate) |
| `malformed-pipe` | error | a pipe segment fails the segment regex (binding site carries a location; interpolation site has `location: null`) |
| `error-into-no-converter` | error | `error-into` set but the binding has no converter to read a `ParseResult` from |
| `pipe-fromview-multi` | error | a `from-view` binding with ≥2 transforms |
| `pipe-two-way-noninvertible` | error | a camelCase/plain-function segment on a `bind`/`two-way` pipe |
| `switch-static-dead` | **warn (non-`stink:`)** | a static `on=` matches no case with no `<default>` — **see D-8: currently slips the stink gate** |
| `stink:declared` | declared | `...attrs.rawBind` (spread site) and `raw`-on-off-list-sink (§12.4) |

### 12.3 Orchestration / `@import` / converter-obligation diagnostics

| Code | Severity | Trigger |
|---|---|---|
| `bad-import-directive` | error | an `@import` name fails the identifier grammar, or an `@import`-shaped comment fails the strict form |
| `import-directive-duplicate` | error | the same name in two `@import` directives |
| `import-directive-unused` | info | an `@import` name matches no pipe transform |
| `converter-unresolved` | info | an import cannot be followed to a readable module (10 detail variants: no import, package specifier, unreadable, circular, >3 hops, package re-export, …) |
| `converter-missing-parse` | error | a converter used on an inbound leg resolves but has no `static parse` within 3 hops |
| `pipe-transform-standalone` | error | a standalone module has pipe heads uncovered by `@import` (`location: null`) |

### 12.4 Security-gate diagnostics (compile-time `gateSink`)

| Code | Severity | Trigger |
|---|---|---|
| `raw:redundant` | info | `raw` on an allowlisted or `data-*`/`aria-*` sink |
| `stink:declared` | declared | `raw` on a non-allowlisted sink (baselined) |
| `stink:warn` | warn | an outbound write to a non-allowlisted sink with no `raw` (**hard gate**) — message suggests `rawSet` / `rawBind.to-view` / `rawBind.two-way` |

### 12.5 Runtime dev-channel warnings (`devWarn`, dev-only, warn-once)

Not `Diagnostic` objects but part of the same story: **inbound corruption** (a display-formatted value leaking into the model — the §6.6 backstop, three reasons), and **spread unsafe-key skipped** (a non-raw spread hit an off-list key). Runtime throws: `createTemplate()` not implemented; `Collection.byKey` without a `key` option.

### 12.6 Catalog notes

- `pipe-two-way-multi` is **retired** — it exists only as a negative test assertion; do not treat it as emittable.
- The `*-outside-switch` and `retired-command` codes are dynamic/shared as noted; a literal grep for `case-outside-switch` returns nothing.
- Two `stink:declared` emission sites (compiler gate and generator spread) share one baseline record shape (`file:line:property:op`); the spread site records `property: '...attrs'`, `op: 'spread'`.

---

## 13. Compiled-output conventions

The transparency contract, observed from actual `DiamondCompiler.compile()` output.

### 13.1 Variable naming

`nextVar` emits `${hint}_${counter}`, and element hints are pre-prefixed `el_${tagName}`, giving `el_div_0`, `el_h2_3`, `el_input_0` — the `_` separator keeps tag and counter distinct so `h2` at index 1 never reads as a 21-level heading tag. The counter is a **single global monotonic counter across all node kinds** (elements, text nodes, anchors share it), so indices are not per-tag. Other hint prefixes: `text_N`, `ifAnchor_N`, `switchAnchor_N`, `repeatAnchor_N`, `deadSwitch_N`, `caseRoot_N`, `defaultRoot_N`.

### 13.2 `[Diamond]` hint comments

```js
// [Diamond] Two-way binding: value ↔ name
// [Diamond] Two-way binding: value ↔ amount | Currency | Trim [update-on: blur]
// [Diamond] One-way binding: title ← tooltip
// [Diamond] Set (static one-shot): title = tooltip
// [Diamond] From-view binding (one-way DOM → query): value
// [Diamond] Event binding: click → this.save()
// [Diamond] Capture event: click → this.onCapture()
// [Diamond] Conditional: if="loading" (+1 else-if)
// [Diamond] Switch: on="status" (2 cases + default)
// [Diamond] Switch on="'ready'" resolved at compile time → case if="ready" (zero runtime cost)
// [Diamond] Repeat: repeat.for="item of items"
// [Diamond] Text interpolation: Hello ${name}!
// [Diamond] Attribute spread: ...attrs.bind="myGuts" — runtime-gated: gate FIRST …
```

Two conventions worth pinning for a reader/model: **binding hints echo the expression unprefixed** (`value ↔ name`), while **event hints hardcode `this.`** (`click → this.save()`); the from-view hint inverts the arrow (points at the expression, property trails after the colon); the static-switch hint `JSON.stringify`s its `on=` value while the reactive form interpolates bare; `else-if` branches get no comment of their own (they fold into the chain head's `(+N else-if)` counter).

### 13.3 The RAW audit comment

A raw sink emits **two lines** — a fixed banner plus the ordinary op hint with a `RAW ` infix:

```js
// [Diamond] raw sink — explicit opt-in (developer-owned, unescaped); audited in stink-baseline.json, no runtime XSS protection here
// [Diamond] RAW One-way binding: innerHTML ← userHtml
DiamondCore.bind(el_div_0, 'innerHTML', () => this.userHtml);
```

> ⚠ The banner's "audited in stink-baseline.json" describes the *mechanism*, not the *state* — the compiler never reads the baseline, so a brand-new never-reviewed raw binding asserts it on its first compile (§16 D-12). And `rawBind.from-view` emits the `RAW ` tag but **no banner and no `stink:declared`** — a raw usage invisible to the audit trail (§16 D-13).

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

---

## 14. Packages & LOC budgets

Six workspace packages, all at **2.1.0**.

| Package | Prod LOC | Budget | Notes |
|---|---:|---:|---|
| `@diamondjs/runtime` | 863 | 2,500 | `core` (321), `reactivity` (176), `collection` (121), `component` (83), `security` (69), `decorators` (38), `scheduler` (24), `parse-result` (14), `index` (12), `dev-log` (5) |
| `@diamondjs/compiler` | 2,202 | 5,000 | `generator` (814), `parser` (619), `compiler` (370), `pipe` (153), `types` (107), `security` (64), `sourcemap` (56), `index` (19) |
| `@diamondjs/parcel-transformer-diamond` | 111 | 300 | `utils` (65), `index` (46) |
| `@diamondjs/converters` | 84 | 500 | `date` (39), `currency` (22), `phone` (20), `index` (3) — opt-in batteries, depend on runtime for `ParseResult` |
| `@diamondjs/primafacie` | 262 | 400 | `primafacie` (168), `ws-sink` (46), `node` (38), `index` (10) |
| **Total (production)** | **3,522** | **8,700** | 40.5%; compiler leads at 44.0% |

> **Budget-tool accounting.** `check-loc-budget.ts` counts `src/__tests__/`, so it reports compiler **4,144** and parcel **300/300 (⚠ WARN)** — the parcel WARN is **entirely test growth**; production is 111 LOC (37%). The reported "0 remaining" is not a real ceiling. Any further transformer-side growth still warrants a deliberate budget decision, but the pressure is on the *measurement*, not the code. The tool also **fails open** on a `cloc` resolution error (§16 D-9). The `generateNodes` complexity-debt item is **closed** (the `collectIfChain` + `generateStructural` extraction shipped ahead of switch), though the switch guard has re-accreted the loop to depth 3 / CC 8–10 — inside soft targets, but one more sibling clause reopens it (§16 D-19).

The batteries (`@diamondjs/converters`) are kept separate from the runtime; `ParseResult` stays in the runtime so batteries and user converters import the same contract and it cannot drift.

---

## 15. Logging (`@diamondjs/primafacie`)

`@diamondjs/primafacie` is the isomorphic logging package (named by the author): the `Print(logType, message)` paradigm carried from Stargate — 15 log types, symbol pairs, caller extraction, a padded line format — with a console transport (Node ANSI / browser `%c`) and pluggable sinks (`addSink`; a lazy self-healing `wsSink` browser→server transport; a Node-only `fileSink` under the `./node` subpath so browser bundles never touch `fs`). Wiring: the tools' summary lines and the Parcel transformer's non-throwing diagnostics print through it. The **runtime adopts only the line format** via a dependency-free `devWarn` (5 LOC, `dev-log.ts`) so it stays lean and tree-shakeable; the compiler stays pure (returns diagnostics, prints nothing).

---

## 16. Conformance & known limitations

Shipped v2.1 (`00db3c6`) meets the contracts above except for the items below. Each is dispositioned **fix-the-code** (a defect against a sound spec intent), **accept** (a bounded limitation to document), or **correct-the-record** (the earlier record was imprecise; this spec adopts the corrected form). The full test suite passes (218/11/30/8/19) except three assertions in an untracked disposal probe (D-1).

### Retention & correctness defects (fix-the-code)

- **D-7 — Post-unmount stale-flush is a persistent retention leak.** A mutation in the same synchronous tick as `unmount()` leaves a queued effect; its microtask flush runs post-unmount and, because effect re-execution re-arms tracking, **re-inserts the disposed effect into the dependency set**. The closure retains the unmounted component and its detached DOM for the reactive object's lifetime — every later mutation of any property the template read keeps writing into a detached tree. Triggered by an ordinary route-change / list-item-removal shape. *Highest severity found.* Fix requires the scheduler and disposal to cooperate (a disposed-effect guard on flush, or a dequeue path).

- **D-1 — `if`/`switch` toggled-off branches stay live subscribers.** Branches are cached one-per-slot (`built[]`) and detached with `.remove()` **without** invoking their cleanup; the cleanup fires only at *containing-scope* teardown. Subscriber count is **bounded** (one per branch), but **work per firing is unbounded** — a cached `repeat` over a `Collection` inside a hidden branch rebuilds on every mutation (49 detached `<li>` builds reproduced). `repeat` is correct (it calls `gone.cleanup()` eagerly); the fix is the symmetric call in `if`/`switch`, which entails also dropping the cached node and rebuilding on re-activation — a genuine cache-vs-correctness tradeoff, not a one-line oversight. The untracked `detached-branch-disposal.test.ts` asserts the desired behavior and currently fails; it should be committed (as a regression marker) once the fix or an accepting amendment lands. **Also correct-the-record:** `working_notes.md:87/:92` and `deferred_work:73` assert structural directives dispose on detach — false for the `if`/`switch` toggle path. A bare `DiamondCore.if()` outside any scope registers no cleanup at all (`track()` is a no-op when `currentScope` is null).

- **D-2 — `repeat.for` over duplicate primitive items grows rows and orphans nodes.** Reconciliation keys on the raw item, so duplicate values (repeated strings/numbers — tags, statuses, counts) collapse to one map slot; extra rows accumulate on every update and survive clearing the collection, effects never disposed. Fix: key on identity+position, or document `repeat` as identity-only and require a `key`-like discriminator for primitives.

- **D-3 — Attribute interpolation compiles to a literal string with zero diagnostics.** `<div title="Hello ${name}">` emits the literal `Hello ${name}`; the failure surfaces only in the browser. The toolchain claims the file (any `${…}` marks it Diamond) then ignores the construct — the one silent-wrong-output the §5.1/DDR reasoning argues hardest against. Fix: diagnose (suggesting `title.to-view`) or support it.

- **D-10 — Static attributes bypass the compile-time gate.** `<div onclick="alert(1)">` emits `setAttribute('onclick', 'alert(1)')` with no diagnostic and **no baseline diff** — an inline handler added invisibly, which is exactly the tripwire DDR §6.5 claims is unbypassable. The gate's coverage is a function of authoring *syntax*, not the sink. Practical severity is bounded (literal author text; attribute interpolation is inert per D-3), but the §3.4/§6.5 "raw cannot be added invisibly" claim does not hold for static attributes. Fix: gate `staticAttrs` for `on*`/off-list names.

- **D-8 — `switch-static-dead` slips the stink gate.** It carries `severity: 'warn'` with a non-`stink:` code, so the stink-check routing (`error` → `stink:warn` → `stink:declared`) drops it silently; it surfaces only via the Parcel transformer. The same structural gap hits any future non-`stink:` warn code. Fix: route on severity, not code prefix.

- **D-9 — `check-loc-budget` fails open.** A `cloc` resolution failure (offline, no npx cache) is swallowed to `0 LOC`, printing green `✅ OK` for every package and exiting success. Fix: fail closed on a `cloc` error.

### Accepted limitations (document, don't smooth over)

- **D-6 — Double-`mount()` leaks a DOM element (correct-the-record).** A2 called this a scope leak; it is not — both scopes' cleanups land on one registry and dispose. What leaks is the **first DOM subtree**: `this.element` is overwritten on the second mount, so `unmount()` only removes the second. Still open (no `mounted` guard). *This spec adopts "DOM-node leak."*

- **D-11 — VLQ source maps are unreachable on the default toolchain.** The compiler generates real maps, but the Parcel transformer passes `sourceMap = false` and has no `setMap` call (stale "Phase 0/1" comments remain). The seam exists; the wiring does not.

- **D-14 — `SAFE_SINKS` is design-derived, not empirically hardened.** Byte-for-byte the Phase-1 starter set; the §11.2 NetPad empirical probe has not run. Describe the list as unrefined. `srcset`/`action`/`formAction`/`cssText` fail closed by construction but have **no dedicated test** — add them to the security test arrays to regression-lock the guarantee (D-20).

- **D-12 — The RAW banner overclaims.** "audited in stink-baseline.json" is emitted from a pure `binding.raw` check; the compiler never reads the baseline. A cold-reading model takes it as a completed-audit attestation. Reword to describe the mechanism, or make emission conditional on a baseline hit.

- **D-13 — `rawBind.from-view` is invisible to the audit trail, and `from-view` is gate-exempt.** The inbound raw form emits the `RAW ` tag but no banner and no `stink:declared` (deliberate — inbound is a different contract), and `from-view` is exempt from the compile-time gate (sound: no sink write). DDR §6.4-row-1 / §3.3's "uniform" coverage language should be read with this documented exemption.

- **D-15 — The allowlist invariant test is asymmetric.** The runtime test checks `map[lowercase(sink)] === sink` and is **normative**; the compiler test only checks the sink appears in `Object.values(map)` and would pass a typo'd key. A2's "enforced in both suites" is technically true but materially weaker on the compiler side.

- **D-4 — `repeat` render is O(n) DOM mutations per update.** `Collection`'s append is genuinely O(1) (10k pushes → one flush), but the render re-inserts the whole ordered list before the anchor each run (201 `insertBefore` after one push into a 200-row list). Nodes are reused, not rebuilt (churn, not a correctness bug) — but never transcribe "O(1) append" next to the Neuron bar without this caveat.

- **D-16 — `computed` is dead public surface.** Public but not compiler-emitted, and its caching is defeated (re-runs on every dependency change). **D-17 —** nested-effect `activeEffect` nulling (rather than save/restore) silently untracks any read *after* a nested effect is created; no current codegen reads-after-building, so nothing triggers it today — a trap for future primitives.

- **D-18 — `isDiamondTemplate` blind spot is wider than A2 §13 states.** Beyond if-only templates, it also misses `else-if`-only and `case`/`default`-only fragments with zero bindings/interpolations. **D-5 —** `TemplateImport` (the `@import` result type) is not re-exported from the compiler index, so a consumer outside the monorepo cannot name it despite `@import` being public grammar; one-line export fix.

- **D-19 — `generateNodes` re-accretion.** The complexity debt is closed, but the v2.1 switch guard restored the loop to depth 3 / CC 8–10; a fifth structural sibling clause reopens it. The proven remedy is the same extraction (fold the switch guard into `generateStructural`-style dispatch).

### Open by design (A2 §17 — all four still open)

- Structured `ParseResult.error` `{code, message}` (i18n seam) — still bare `string | null`.
- Plugin `asset.setMap` source-map offset wiring (see D-11).
- Double-`mount()` guard (see D-6).
- The §11.2 empirical allowlist probe — **NetPad** remains the designated stress test (hardest XSS surface: cross-user real-time content flow); 2.1a/2.1b now exist to build it on. This probe is also the refinement D-14 records as not-yet-done.

---

## 17. Appendices

### Appendix A — v1.5.1 → v2.1 token reference

| Concern | v1.5.1 (Aurelia-derived) | v2.1 |
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

### Appendix B — Framework positioning

Against Aurelia 2.0: same template syntax lineage, but no DI (explicit imports), Proxy + `@reactive` instead of the observer system, `this` everywhere instead of `vm`/`self`/scope, `Collection` for large data, 4 hooks instead of 8, and self-documenting compiled output. Against React: HTML templates instead of JSX, classes instead of hooks, `this.count` instead of `state`/`setState`, `Collection` instead of `useMemo`/`useCallback`. Against Vue 3: similar template syntax, `@reactive` instead of `ref()`/`reactive()`, no `.value` unwrapping. The unique value: the only framework explicitly designed for human-LLM collaborative development, with compiler-emitted semantic hints, universal `this`, and hybrid reactivity tuned for both small UI state and large datasets.

### Appendix C — Versioning posture

DiamondJS is the SemVer canary for the project fleet: the substrate everything else (Crystallizer, NetPad, the neuron tooling) builds on gets the honest compatibility contract first, and downstream expresses its dependency precisely (`@diamondjs/*@^2.1.0`). The v2.0 major captured the wholesale binding-language and security-model break; v2.1 is additive (switch, spread, collection/delegate, error-into, @import, source maps, primafacie, root cleanup). Because the raw-path architecture means post-stability security hardening turns new raw call sites into audited escape hatches rather than breaking changes, the eventual clean stable line can hold — which is the argument for doing the foundational churn now, pre-stability, where it costs almost nothing.

---

*End of specification. The spec is authoritative over the code; §16 is the current conformance delta, not a softening of the contracts above.*
