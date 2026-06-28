# DiamondJS v2.0 — Design Decision Record

**Status:** Closed. Ready for implementation.
**Baseline:** v1.5.1 (confirmed by Claude Code against structural codebase markers).
**Target:** v2.0.0.
**Trigger:** Security PR addressing XSS injection via DOM sinks, escalated into a system-wide API audit so that *every* DiamondJS surface gains security-by-default with an audited `raw` escape hatch.
**Supersedes:** `DiamondJS_v1.5.2_Design_Change_Record.md` (the "1.5.2" version label was a SemVer violation — see §9).
**Amendments incorporated:** Amendment A1 (June 28, 2026) — folded into §6.2 (`else` / `else-if` treatment) and §7.3 (`switch` / `case` / `default` backlog). Originally issued as a standalone post-DDR amendment; merged here so the record is single-source.

---

## 0. How to read this document

Every decision below ships with its rationale, deliberately. The reasoning is load-bearing: when this document is revisited by you, by a future agent, or by the chronicler, the *why* must travel with the *what* — otherwise the decision gets re-litigated or "fixed" back to a worse state. Where a decision overturned an earlier proposal, the overturned reasoning is named so it stays dead.

The throughline under all of it: **a token must predict its own behavior to a ~32B model, not merely describe it to a human.** Naming is optimized against what a small model will *infer from its training distribution*, not against the dictionary. A technically-correct name that reliably triggers a wrong prior is worse than a plainer name with no competing prior.

---

## 1. The category error that frames everything

The original change record justified most removals with some variant of *"Aurelia needed DI for this."* That is never, by itself, a valid reason, and recognizing why resolves a cluster of decisions at once.

Aurelia's dependency injection is an **implementation consequence of its runtime-resolution architecture**. Aurelia evaluates template expressions against a binding context at runtime, so resolving `| uppercase` or `& debounce` requires looking up a registered resource, and *that lookup* is what drags in the container, the `@valueConverter`/`@bindingBehavior` decorators, and the `toView`/`fromView` protocol. The **syntax** (`|`, `&`, `.delegate`) is independent of all of it.

DiamondJS compiles. It can lower any of these constructs to plain function calls or wrappers with zero DI. Therefore:

> **"Aurelia used DI for X" can never justify removing X's syntax.** The only admissible reasons are DiamondJS-internal: does the *compiled form* stay transparent, does the syntax earn its surface area, does it serve the LLM-legibility thesis.

The sharper version: **DiamondJS value converters were never DI-based.** They already compiled to a plain import plus a plain call. So the correct half of "kill Aurelia's resolution system" was already done *by construction*; the separate, real question was always whether each *token* earns its place on its own merits. Every decision in §§4–6 is that question, asked per-construct.

---

## 2. Governing principles (the meta-decisions)

These are the reusable rules the per-construct decisions fall out of.

1. **Syntax ≠ semantics ≠ architecture.** A construct's surface token, its meaning, and the host framework's implementation choices are three independent things. Never reason from one to another.

2. **Name must predict behavior to a small model.** Optimize against the model's failure mode (confident wrong completion from a training prior), not the dictionary.

3. **Purity vs. statefulness cleave.** Value transforms (pure, referentially transparent) and binding/control mechanics (stateful, temporal) belong in *different syntactic locations*. `|` modifies the value; binding mechanics live in attribute space; handler state lives in visible class code.

4. **Scope introduction must be visible at the use site.** `repeat.for` introduces a *named, visible* loop variable — passes. `with` introduces *anonymous, ambient* rebinding — fails. This rule governs structural-directive decisions.

5. **Allowlist > blocklist for security.** A blocklist enumerates known-bad and fails *open* on everything unforeseen. An allowlist enumerates known-good and fails *closed* on ignorance. The dangerous-sink set is open-ended; the safe set is small and spec-derivable.

6. **Compile-time is the single choke point.** The compiler sees *every* sink write before runtime paths diverge. Runtime guards sit downstream of divergence and develop holes (this is exactly how the original PR's one-time bypass arose).

7. **Provenance lives in the import, not in a magic location.** A convention folder is a mini-registry that hides origin the same way DI does. The `import` statement *is* the registry.

8. **Build-time complexity, runtime transparency.** The compiler absorbs complexity so emitted output is explicit and debuggable by a small model with no framework knowledge.

9. **Reactive-over-static is free.** A reactive binding that references only static values never re-evaluates, so there is no need for a separate one-time variant of a control construct.

---

## 3. The security core

This is the heart — the work that triggered the entire refactor.

### 3.1 `unsafe` → `raw`

`unsafe` is a **verdict** ("you are doing something wrong"). A `rawSet` to a trusted constant isn't wrong at all. `raw` is a **description** — unprocessed, unescaped, developer-responsible — accurate across the whole range from "fine" to "XSS hole." It also reads as a verb-modifier (`rawSet`, `rawBind`) where `unsafeBind` reads as an accusation.

The Rust precedent (`unsafe` = "I've asserted the invariants the compiler can't") was the better connotation *in that domain*. In an XSS-sink context `unsafe` reads as "this is the hole," which is alarmist and frequently false. `raw` wins here.

### 3.2 Allowlist inversion

The original PR was blocklist-shaped (`UNSAFE_DOM_SINK_PROPERTIES` enumerated the known-dangerous). The ground truth already caught it failing open: `outerhtml` isn't in `PROPERTY_NAME_MAP`, silently no-ops, and would slip a naive list — the generic blocklist failure mode.

**Invert it.** Enumerate the *safe* sinks — the small, boring, spec-derived set (`textContent`, `value`, `className`, …):

* On the list → clean output, no stink.
* Not on the list → requires `rawSet`/`rawBind`, emits `stink:declared`.
* Novel / unknown → fails **closed** (treated as raw).

The `outerhtml`-class gap becomes impossible by construction: ignorance fails to raw rather than to allowed.

### 3.3 Coverage map — three threats, three mechanisms, no overlap

| # | Threat | Mechanism | Why there |
|---|--------|-----------|-----------|
| 1 | Outbound sink writes, **statically-known** target | **Compile-time** allowlist gate at codegen | Single choke point upstream of runtime path divergence. Covers `set`/`rawSet`/`bind`/`rawBind` uniformly. **Closes the one-time bypass** (`.set` compiles to a naked `el[prop] = value` that never enters `bind()`, so a runtime guard there cannot see it; the codegen gate sits upstream of that divergence). |
| 2 | Outbound sink writes, **statically-unknown** target (attribute spread) | **Runtime** allowlist gate inside the emitted loop | Dynamic keys are unknowable at compile time. (Ships in 2.1 with spread — see §7.) |
| 3 | **Inbound** model writes carrying display-formatted strings | **Runtime** proxy `set`-trap smell check | The value is only knowable at runtime. (See §5 — `ParseResult` / formatted-value corruption.) |

These are orthogonal legs. `set`/`rawSet` (outbound) and the inbound smell check are neither redundant nor gappy.

### 3.4 Two-tier stink biscuit — CI gate vs. legible doc

The open question was: is the biscuit an enforced gate, or legible documentation an agentic loop can silently bypass? Answer: **the two-tier split is the answer, applied asymmetrically.**

* **`stink:warn`** (unresolved formatted-value corruption; nobody declared it) → **hard gate.** Latent bug by definition; block merge on count > 0. This is the "incomplete" posture with teeth.
* **`stink:declared`** (intentional raw) → **don't gate; baseline it.** Check a snapshot of the declared-raw set into the repo. A *new* `rawBind` not in the baseline doesn't block the build, but it **changes the baseline file, and that diff lands in code review.**

This specifically defeats the agentic-loop bypass: the tripwire isn't "block raw," it's **"raw cannot be added invisibly."** Every new raw escape becomes a reviewed, signed-off event.

---

## 4. Bindings

### 4.1 `.one-time` → `set` / `rawSet`

`.one-time` is not a binding — it is a **static one-shot assignment** with no reactivity. The name should say so. `set` (escaped/safe) and `rawSet` (unescaped, developer-owned, logged) name the operation accurately. Compiles to a direct property write, gated at compile time per §3.3-row-1.

### 4.2 Retained: `bind.to-view` / `bind.from-view` (+ `raw` counterparts)

These name direction of data flow accurately and survive unchanged. `raw` counterparts follow the §3.1 convention.

### 4.3 `&` eliminated entirely

Aurelia's `&` (binding behaviors) implied statefulness via the glyph. Three problems: (a) it is the single biggest cross-language token collision a small model has seen (`&` = address-of / bitwise-AND in C/C++) sitting in the middle of an otherwise clean DSL; (b) the *category* of things it modified is small once you subtract what DiamondJS already removed; (c) keeping value-transformation (`|`) and binding-mechanics (`&`) as two glyphs in one expression string keeps a second grammar living inside the value expression.

**Full inventory of Aurelia's `&` members and where each now goes:**

| Aurelia `&` member | Disposition in DiamondJS 2.0 |
|---|---|
| `oneTime` | → `set` (§4.1) |
| binding-*mode* behaviors | → command suffixes (already) |
| `signal` (force re-eval on external change) | → make the dependency **reactive** instead of signaling — on-thesis, no hidden re-eval trigger |
| `updateTrigger` | → **`update-on` attribute** (binding-update timing) |
| `debounce` / `throttle` | → **`this.debounce` / `this.throttle`** (handler timing, context-aware, self-registering) |

No surviving member requires the glyph. **`&` is gone, not relocated.**

**The cleave inside the category** (Aurelia overloaded these; DiamondJS separates them):

* **Binding-update timing** — *when a two-way binding samples the DOM*. Intrinsically a binding-expression concern. → `update-on`, **property-scoped** in the `property.command` grammar:

  ```html
  <input value.two-way="amount | CurrencyConverter('USD')" value.update-on="blur">
  ```

  Property-scoped (`value.update-on`, not bare `update-on`) for two reasons: it stays in the same `property.command` grammar as everything else, and it is **per-binding by construction** — bare `update-on` is ambiguous on multi-binding elements (`<date-range start.two-way="from" end.two-way="to" update-on="blur">` — which binding?).

* **Handler timing** — *debouncing a handler function*. Leaves the template for visible class code:

  ```ts
  handleInput = this.debounce(v => this.query = v, 500);
  ```

  **Cleanup is automatic.** `this.debounce`/`this.throttle` are context-aware base-class methods that **self-register their `cancel` against the component's teardown registry at creation time.** This is the decisive design move: it makes the class field a genuine one-liner *and* leak-safe, without shifting the timer-cancel burden to the developer (the line an LLM otherwise drops, because nothing visible signals an outstanding timer). The sugar's value was never ergonomics — it was owning the cleanup the hand-written version forgets; making `this.debounce` self-register captures that value without the glyph.

> **NetPad note:** the common real-time case picks the right half automatically. A debounced search wants the *model* live and the *reaction* debounced — `value.two-way="query"` immediate, `this.debounce` on the side-effect — not a debounced binding write.

---

## 5. Template formatting/parsing (née "value converters")

The name "value converter" was an Aurelia resource concept and was the source of real confusion. The construct is now called **template formatting/parsing methods**, and that name is load-bearing.

### 5.1 The corruption the design closes

Under Aurelia-like optional-inbound semantics, a `format*` with no `parse*` on a two-way binding lets the raw view value flow back to the model. Concretely:

| Type | Model holds | User edits → model receives | Loss |
|---|---|---|---|
| Currency | `1234.56` (number) | `"$1,250.00"` (**string**) | type |
| Phone | `"5551234567"` (canonical) | `"(555) 123-9999"` (**formatted**) | canonical form |
| Date | UTC instant | naive local wall-clock string | **information** (offset unrecoverable — DST/travel) |

The reason this justifies a **hard compile error** rather than a runtime check: a *tolerant* formatter is idempotent on its own output, so the **demo looks correct** while the model silently holds the wrong type. The failure surfaces only when something *else* reads the model (a sum, a comparison, a DB write). You cannot reliably catch a non-throwing silent corruption at runtime — you catch it at compile time by requiring the parser to exist. (Dates can't even be masked this way: a tolerant `formatDate` re-parsing the string must *assume* an offset, which means it is secretly `parseDate` — the shadow-parse anti-pattern in disguise.)

The "separate display from value" escape doesn't help: the DOM gives no second typed slot on a text input, so a shadow value means the framework holds the number and re-derives display — but maintaining that shadow *is* the parse, hidden in the runtime, which is strictly worse than an explicit `parseCurrency` in the binding.

### 5.2 Shape (b): one class, two static methods, `format` / `parse`

Chosen over (a) two free functions and (c) one function branching on direction.

```ts
class CurrencyConverter {
  static format(value: number, currency: string): string { /* number → string */ }
  static parse(raw: string, currency: string): ParseResult<number> { /* string → number, validated */ }
}
```

* **Naming:** `format`/`parse` over Aurelia's `toView`/`fromView` (abstract, direction-relative to an implicit container — ambiguous from whose frame) and over `set`/`get` (collides with §4.1 `set`; direction ambiguous). `format`/`parse` name the actual operation (number↔string) and are unused as binding commands. Every LLM understands the `format*`/`parse*` prefix distinction.
* **Static methods**, not instances — consistent with the OOP-steering principle; the class is a namespace bundling the pair so they can't drift. Compiled output is `CurrencyConverter.format(this.amount, 'USD')` — bare, no instance allocation, no "what is this object" question.
* **Nothing mandates use.** No `|` → no class. The construct is opt-in.

### 5.3 The pipe `|` survives on Unix-pipe merits

Not a "value converter" (an Aurelia resource) but a **Unix pipe**: left is data, right is a transform, output flows through. `${value | parseRaw | clamp | formatPercent}` lowers to `formatPercent(clamp(parseRaw(this.value)))` — pure function composition, zero framework concepts, strictly more legible than a framework-method alternative, and semantics every developer and 32B model already knows.

The non-obvious payoff: **the pipe pays for its surface by making the audit cheap.** A bare `formatCurrency(this.price)` buried in an arbitrary expression forces the compiler into real static analysis to find transforms; a pipe makes "this token is a transform" *syntactically* true, so the format/parse pairing check is trivial. The ergonomic syntax and the correctness machinery are one decision.

### 5.4 Pipe argument syntax: parens, threaded to static methods

```
value.two-way="amount | CurrencyConverter('USD')"
```

* **Parens over the colon** (`:'USD'`) because they delimit cleanly for the multi-arg case: `CurrencyConverter('USD', 'en-GB')` is bounded; `:'USD', 'en-GB'` is not.
* **Sugar for additional static-method arguments, NOT construction.** Compiles to `CurrencyConverter.format(value, 'USD')` — *not* `new CurrencyConverter('USD')`. Construction would reintroduce per-binding allocation, instance lifecycle, and a "what is this object" question, cutting against §5.2.
* **Same args thread to both legs:** format → `CurrencyConverter.format(this.amount, 'USD')`, parse → `CurrencyConverter.parse(raw, 'USD')`. The currency code is bound once and **guaranteed consistent across format and parse** — round-trip consistency for free. Doesn't complicate the pairing check (compiler still just verifies the methods exist; args pass through).

### 5.5 `transform_functions/` folder is deleted

A magic convention folder is a mini-registry hiding provenance, the same thing DI does (§2.7). The **import graph is the registry**: `CurrencyConverter` lives wherever it's imported from; the compiler follows that import and reads the module's exports to verify the pair. No special location, strictly more transparent.

### 5.6 Contextual enforcement (not universal pairing)

Drop "every `format*` must have a `parse*`" — over-constrained (`formatFileSize`, `formatRelativeTime`, `formatDuration` have no sane inverse; a stub parser to satisfy the compiler is noise). Enforce **only where direction demands**:

* `format*` on the **outbound leg of a two-way binding** → require `parse*` in the same class → **hard compile error** if missing. (This is where corruption lives.)
* `format*` in interpolation / one-way binding → no inbound leg → no parser, no check. **One method, or no class.**

The compiler already knows binding direction and can read the class's method list — the check is trivial.

### 5.7 `ParseResult<T>` and validation-in-parse

**Parse already had to validate** — you cannot convert `"abc"` to a number without deciding it isn't one. Making that implicit responsibility explicit gives `parse` a strong reason to exist and makes it DiamondJS's client-side validation story.

```ts
interface ParseResult<T> {
  valid: boolean;
  value: T | null;
  raw: string;        // user's in-progress text — never clobbered
  error: string | null;
}
```

Ship `ParseResult.ok(value, raw)` and `ParseResult.fail(raw, message)` constructors so nobody hand-assembles the shape and it can't drift.

**From-view runtime semantics:**

* `valid: true` → write `value` to the model.
* `valid: false` → **do not write** (model retains last good value); **keep `raw` in the input** (never clobber what the user is typing); expose `valid` + `error` to the validation surface. (`raw` exists in the shape precisely to allow showing `"$1,2"` mid-type while the model stays clean.)

**Validation scope:** parse owns **type/format validity** ("is this a valid currency string"). It does **not** own business rules ("amount < $10,000 for this field") — those are field-specific and live in the component, or the battery stops being reusable. Keep that seam clean.

**What defining this shape commits to:** it *establishes the validation-error seam* (whatever renders field errors consumes `valid`/`error` off this object) while *deferring the rendering surface*. `error: string` for v2 (renders directly); noted seam to structured `{code, message}` for i18n later.

> **Timing bridges to §4.3.** A *validating* parser firing per-keystroke rejects `"$1,2"` mid-type — hostile. Validating parsers want `value.update-on="blur"` (or commit), not `input`. The validation decision and the `update-on` mechanism are the same concern from two angles.

### 5.8 Batteries included

Ship `format`/`parse` pairs for the most consequential cases. They fortify the common path *and* serve as the canonical worked examples of validate-in-parse (the library teaches the pattern by demonstration).

| Battery | Strategy |
|---|---|
| **Currency** | Lean on `Intl.NumberFormat` — thin wrapper, don't reimplement CLDR. |
| **Date** | Lean on `Intl.DateTimeFormat`. **Highest-value battery**: a correct `parseDate` handling calendar validity *and* the offset-reconstruction problem is exactly what most devs get wrong. The hard case is the one batteries justify hardest. |
| **Phone** | **No `Intl` equivalent**; libphonenumber is 200KB+ and detonates the bundle/LOC ethos. Ship a deliberately-simple North American formatter with a clearly-marked "implement your own for other regions" seam — small enough to read, so the limitation *is* the teaching example. |

Note: validation gives `parse` a reason to exist *for fields with an inbound leg*. It does **not** resurrect `parse` for pure-display formatters (`formatFileSize` has no input to validate) — consistent with §5.6.

---

## 6. Structural directives & events

### 6.1 `with` — gone outright

Three independent nails, weakest to strongest:

1. **Legibility:** bare-name rebinding (`<div with.bind="user">${name}`) makes `${name}` mean something *other than what it locally says*, resolvable only by looking *up* the tree to an invisible enclosing `with`. Violates §2.4 (scope must be visible at the use site) — the exact confident-wrong-completion failure the framework designs against.
2. **Naming audit:** "with" names a scope-confusion feature after the most notorious scope-confusion construct in JS. The name is *apt for a thing you don't want*.
3. **Hard incompatibility (decisive):** TypeScript **rejects the `with` statement outright** (compile error under any modern config), and the post-ES2022 strict-mode baseline — which ES modules and class bodies are *unconditionally* — **throws** on it. The authoring layer won't compile it and the output context won't run it.

DiamondJS has **no `with` concept at all** — not the keyword (impossible), not a template construct *named* `with` (inherits the reviled keyword's baggage). Aurelia gets away with its template `with` only because it compiles to lookup machinery rather than a literal `with` statement — but it borrows the name of a forbidden construct for a feature that reproduces exactly the non-local-scope confusion that got the keyword reviled. The name is accurate, and that's the problem.

**Replacement for the one legitimate need** (deep repeated access, `${user.profile.settings.theme.color}` ×N): a view-model getter.

```ts
get themeColor() { return this.user.profile.settings.theme.color; }
// template: ${themeColor}
```

Explicit, local, *testable*, visible at the use site. The escape hatch for the one real need is strictly better than the feature.

**Nothing in the 2.0 design depends on `with`.** Every other construct resolves through explicit references or introduces its own named scope. It's a standalone convenience nothing is built on. Removal cost is ~zero today (near-zero external users, no template corpus) — the cheapest it will ever be.

### 6.2 `if.bind` → bare `if`; `else-if` retained, bare `else` removed

`if.bind="isLoggedIn"` **conditionally includes the element in the DOM** (removes it entirely when false — not `display:none`). The `.bind` suffix described the *RHS mechanism*, not the *DOM effect* — which is why it's misread as "if this element is bound" (a 32B model makes the same slip).

Drop the suffix entirely:

```html
<div if="isLoggedIn">
```

Justification that the suffix carries *no information*:

* **`if` has no sink.** The condition is a boolean controlling whether a subtree *exists*; it never flows into the DOM as content. No sink → no injection surface → **no raw variant** (`rawBind-if` would be *meaningless* — "raw" only ever modified sink writes). The bind/rawBind axis does not apply.
* **`if` is always reactive**, and reactive-over-static is free (§2.9) → no `if.set` needed.

Always-reactive + no-sink → no command suffix distinguishes anything. `if` is a JS reserved word, so it can't collide with a component property named `if` — the same fact that lets the parser recognize the structural form. Cleaner than both `if.bind` and the considered-and-rejected `bind-if` (which overloads "bind" and implies a spurious raw variant).

#### `else-if` retained, bare `else` removed (Amendment A1)

> **Amendment A1 (June 28, 2026), folded in.** The original §6.2 settled `if.bind` → bare `if` but left the `else` / `else-if` treatment *implicit* — inherited from the Aurelia/HTML mental model without explicit examination. This sub-decision closes that gap and **supersedes** the implied inheritance of bare `else`. Derived from first-principles analysis of positional-pairing failure modes and LLM authoring constraints.

**Decision:**

* **`else-if="<condition>"` — retained.**
* **Bare `else` — removed.** Does not ship in 2.0 or any subsequent version.
* **Residual / catch-all cases — an explicit negated `if` attribute on a standalone element.**

**The problem with bare `else`.** Bare `else` is a positional marker with no value, no `=`, and no RHS. It violates the grammar of every other structural directive in DiamondJS:

* `if="condition"` — attribute with value ✓
* `else-if="condition"` — attribute with value ✓
* `repeat.for="item of items"` — attribute with value ✓
* `else` — bare, valueless, positional ✗

The deeper problem is not aesthetics — it is **positional pairing at arbitrary nesting depth**. The compiler, the developer, and the LLM authoring the template must all scan upward through the tree to find which `if` a given `else` belongs to. In a flat sibling list this is manageable. In any real component with nesting:

```html
<div if="isConnected">
  <div if="isLoading">…</div>
  <ul else>                    ← pairs with which if?
    <li repeat.for="n of nodes">
      <span if="n.isActive">…</span>
      <span else>…</span>      ← pairs with which if?
    </li>
  </ul>
</div>
<div else>…</div>              ← pairs with which if?
```

Three `else` clauses at three nesting levels. Pairing is resolved by proximity rules the syntax does not encode. A misplaced `else` is syntactically valid and silently wrong — a whole class of bugs with no compile-time signal.

**This is the structured-programming argument restated for template DSLs.** Goto is seductive for the same reason bare `else` is seductive — maximum expressiveness, zero locality. Dijkstra's objection was always about locality of reasoning, not power. Bare `else` fails the same test.

**Why `else-if="condition"` survives.** `else-if` does not have the pairing problem because its condition is self-describing. A model reading `<div else-if="hasError">` knows what it means without scanning upward — the condition *is* the locality. The sibling relationship is still positional (it follows the preceding `if` or `else-if`), but the *meaning* is encoded in the attribute value, not in the reader's ability to track scope. `else-if` is also syntactically uniform with `if` — both are attributes with an explicit `=` and a value. The grammar is consistent.

**The residual / catch-all pattern.** The catch-all case that bare `else` served is written as an explicit negated `if`:

```html
<div if="isLoading">Loading…</div>
<div else-if="hasError">${errorMessage}</div>
<div else-if="isReady">
  <ul><li repeat.for="node of nodes">${node.label}</li></ul>
</div>
<div if="!isLoading && !hasError && !isReady">Something unexpected happened.</div>
```

The final element is a **standalone `if`**, not chained — which signals to the reader that it is a safety net outside the primary flow, not a branch within it. This pattern is strictly more informative than bare `else`:

* It names the conditions it asserts are simultaneously false.
* It documents the developer's assumptions about the state space.
* It breaks loudly when a new state is added and this line is not updated.
* It gives a debugger at 2am concrete information about what failed.

Bare `else` says "none of the above." The explicit negated form says "specifically these named conditions were all false simultaneously." The second is a meaningful assertion; the first is a residual bucket.

**LLM authoring properties.** Bare `else` requires the generating model to (1) track open `if` scopes as a stack while writing forward, (2) place `else` correctly relative to that stack, and (3) verify pairing on readback by reconstructing the sibling chain. `else-if="condition"` requires the model to (1) write an attribute with a value. Each element is fully self-contained — no stack, no lookback, no pairing, correct by construction. This is the same property that motivates every other DiamondJS naming decision (§2.2): a token must predict its own behavior. `else-if="hasError"` predicts its behavior completely; bare `else` predicts nothing without context.

**What was explored and rejected.**

* **Named string tieback** —

  ```html
  <div if="isLoading" diamond-gate="loading-gate">…</div>
  <div else-if="hasError" else="loading-gate">…</div>
  <div else="loading-gate">…</div>
  ```

  Solves the positional problem by replacing it with a reference problem. Requires a new cross-element reference system, a new reserved attribute (`diamond-gate` or equivalent), and introduces ordering ambiguity when multiple elements share a gate name. Trades positional magic for reference magic — structurally resembles goto, with the same expressive power and the same locality failure. **Rejected.**

* **Compile-time `else` expansion** — expand bare `else` to its negated condition at compile time so the compiled output is explicit. Solves the *machine reading* problem, does nothing for the *LLM authoring* problem: the model writes source, not compiled output, and the source-level `else` is still positional. **Rejected for the same reason.**

**Canonical form summary.**

```html
<!-- Two-branch boolean -->
<div if="isLoggedIn">Welcome back, ${user.name}</div>
<div else-if="!isLoggedIn">Please sign in</div>

<!-- Multi-state -->
<div if="isLoading">Loading…</div>
<div else-if="hasError">${errorMessage}</div>
<div else-if="isReady">…content…</div>

<!-- Residual catch-all (standalone, not chained) -->
<div if="!isLoading && !hasError && !isReady">Unexpected state.</div>

<!-- Nested — no pairing ambiguity -->
<section if="isConnected">
  <div if="isLoading">Loading…</div>
  <div else-if="hasError">${errorMessage}</div>
  <ul else-if="nodes.length > 0">
    <li repeat.for="node of nodes">
      <span if="node.isActive">${node.label}</span>
      <span else-if="!node.isActive">${node.label} (inactive)</span>
    </li>
  </ul>
</section>
<section else-if="!isConnected">Disconnected.</section>
```

**Non-existent forms — compiler must reject.**

```html
<div else>…</div>                    <!-- INVALID — bare else removed -->
<div if.bind="cond">…</div>          <!-- INVALID — v1.5.1 dead syntax -->
<div rawIf="cond">…</div>            <!-- INVALID — if has no sink -->
<div if.set="cond">…</div>           <!-- INVALID — if is always reactive -->
```

The compiler emits a clear diagnostic for bare `else`, suggesting `else-if="!<condition>"` or the `switch` construct (§7.3, v2.1) as alternatives:

```
Error: Bare `else` is not valid in DiamondJS 2.0+.
  → For a two-branch conditional: use `else-if="!<condition>"`
  → For exhaustive multi-state with a catch-all: use <switch> / <case> / <default> (v2.1)
```

This makes the removal of bare `else` forward-looking rather than purely restrictive.

### 6.3 `repeat.for` — kept

```html
<li repeat.for="user of users">${user.name}</li>
```

The structural model worth pinning: **template control flow is attribute-based and element-scoped, not statement-based and marker-delimited.** `repeat.for` is an *attribute on the repeated element*; the element's own open/close tags *are* the loop body delimiters. **There is no terminator** (`endRepeat`) because HTML already has `</li>` — the DOM is already a bounded tree.

* **Exactly one looping construct.** No `while`, no `repeat-until`, no `forEach` variant. One iteration primitive a model learns once.
* There is nothing to homogenize across loop terminators because no template control-flow construct *has* one — the DOM's nesting *is* the uniformity. `if` removes its element; `repeat` repeats its element; both bounded by host tags.

**Naming:** `repeat.for` *stutters* (says "iterate" thrice: `repeat` + `.for` + `for...of` body) but does not *mislead* (unlike `if.bind`). Stutter is a redundancy problem, not a correctness problem — lower severity, not worth churning a name that is honest and familiar. Kept as-is.

### 6.4 `.delegate` (Aurelia event-delegation command) — removed

> **CRITICAL DISTINCTION — do not conflate two different `delegate`s.**
> This section is about **Aurelia's event-delegation *command*** (`click.delegate="save()"`), the event-handling sibling of `.trigger`/`.on`. This is **removed in 2.0**.
> It is **NOT** the new homogenized reactive+Collection data-delegation API — that is a *different, new, future* thing (§7.2, **2.1b**). Conflating them would either delete something kept or ship the broken thing killed.

**Why removed:** event-delegation's two reasons to exist are both *structurally absent* in DiamondJS:

* Performance (amortize one listener across a huge list) → subsumed by Collection + virtual scrolling capping live node count (~viewport-bounded), so there are never thousands of listeners to amortize.
* Dynamic content (handle events on nodes that didn't exist at bind time) → subsumed by the compiler emitting per-node `.calls` during `repeat.for` codegen.

A plain `addEventListener` per live node is *more* fish-brain-concrete than a delegated listener doing runtime selector matching.

**Current state (ground truth):** the `delegate` command *is* in the parser's commandMap, `DiamondCore.delegate()` *exists* in `core.ts` with real selector-matching logic, **but the generator emits `DiamondCore.on()` for it and never calls the delegate method.** It is a **hollow stub wired to a fallback**: it parses, produces running code, and that code silently degrades to a plain listener.

**Action:** delete the command **and** the orphaned `DiamondCore.delegate()` runtime method. **Build no replacement in 2.0** — per-node `.calls` codegen covers the repeat case. (The clean-slate 2.1b design is strictly better than salvaging this stub anyway — the stub's runtime selector-matching isn't necessarily what the Collection path wants.)

### 6.5 `.trigger` → `.calls`

`.trigger` describes the **wrong direction of causation** — "trigger" reads as *the framework triggers something* (framework-as-actor), but the semantics are the reverse: *the event happens, you respond.*

Candidates and why `.calls` won:

* **`.on`** — correct, universal idiom (`onClick`, `addEventListener`, jQuery `.on`), and *not* Aurelia cruft. But reads as idiom rather than left-to-right prose.
* **`.triggers`** — third-person fixes the causation direction ("click triggers method"), and is technically true. **Rejected:** jQuery `.trigger()` means *dispatch* an event — the opposite of handling. A model with jQuery in its weights will **hallucinate a conflict that isn't there**, reading `click.triggers` as "click dispatches a save event." A technically-correct name with a competing prior is worse than a plainer name with none (§2.2).
* **`.calls`** ✓ — "call" is unambiguously function invocation across every corpus; **no competing prior.** `click.calls="save()"` reads strict left-to-right as subject(click)-verb(calls)-object(save) — the event is the grammatical subject and is first, the correct causation direction. Self-documenting, on the framework's prose-bias thesis.

```html
<button click.calls="save()">
```

> Note the avoided defect: jQuery got *word order* right (`.on('click', handler)`, not `.click('on', handler)`). The thing to avoid was the modifier floating ahead of the event; `.calls` sidesteps it. The rejection of `.triggers` is purely about the dispatch-sense prior, not word order.

### 6.6 `.capture` — own command

**Capture is neither `preventDefault` nor lifecycle-related.** It is the **event capture phase.** DOM dispatch has three phases: capture (event travels *down* from `window` to the target's parent), target, then bubble (*up* — the default). `addEventListener(type, fn, {capture: true})` fires during the descent.

* Orthogonal to `preventDefault` (which cancels the browser's *default action* — nothing to do with phase).
* Orthogonal to lifecycle (it's per-dispatch).
* Its uses have **no substitute**: intercepting an event *before* a descendant sees it, or catching events whose targets call `stopPropagation` in their bubble handlers.

Unlike `.delegate` (removable because non-functional/redundant), capture is a **thin alias for a real DOM primitive with no other access path** — rare but irreplaceable. **Own command**, deliberately chosen over an `.on:capture`/`.calls:capture` modifier (explicitness over command-count-minimization — capture-phase is semantically distinct enough from default-phase to warrant its own command).

```html
<div panel.capture="intercept()">
```

### 6.7 Final event surface

```html
<button click.calls="save()">        <!-- bubble phase (default) -->
<div backdrop.calls="dismiss()">     <!-- bubble phase -->
<div panel.capture="intercept()">    <!-- capture phase -->
```

Two commands — `.calls` and `.capture` — both naming what they do without a misleading actor or a competing prior. `.delegate` gone.

---

## 7. Deferred to v2.1 (additive, non-breaking)

> These are **2.1, not "nice to have."** The Neuron and Crystallizer applications need the hot path sooner than intuition suggests. They are filed with explicit dependency ordering so the urgency is actionable rather than aspirational.

### 7.1 Attribute spread `...attrs` (independent 2.1 item)

JSX-familiar dynamic attribute/property binding:

```html
<input type="text" ...attrs.bind="myGuts">
```

The compiler recognizes the spread token and emits a runtime loop over the object's keys. **The metabolic cost:** the compiler can no longer statically guarantee which attributes are bound, so resolution defers to runtime iteration — which is **exactly why the allowlist had to be runtime-capable** (§3.3-row-2).

**Security — the naive loop is insecure; gate FIRST, branch SECOND:**

```js
for (const [key, val] of Object.entries(guts)) {
  if (!SAFE_SINKS.has(key)) continue;    // fail closed; only rawBind bypasses
  if (key in div) div[key] = val;        // safe property (value, className, …)
  else div.setAttribute(key, val);       // safe attribute (data-*, aria-*)
}
```

Without the gate, `{innerHTML: '<img onerror=…>'}` takes the `key in div` branch → XSS; `{onclick: …}` slips through `setAttribute`. `...attrs.bind` → runtime allowlist, unknown keys fail closed. `...attrs.rawBind` → developer owns all keys, emits a **heavy `stink:declared`** ("dynamic raw spread").

**Precedence: source order wins** (the JS rule). `{x, ...s}` → spread wins (last); `{...s, x}` → `x` wins (last). Emit in source order, last-write-wins falls out. This yields *both* JSX patterns (defaults-then-override and override-then-defaults) instead of one. Security stays orthogonal: source-order picks *which value*, allowlist picks *whether it's allowed at all*. (`{type:'password'}` wins over `text` by order; a co-occurring `{onclick}` fails closed by allowlist. Both rules fire.)

**Dependency:** the 2.0 allowlist (runtime-enforcement half). Independent of the Neuron track — can land in parallel.

### 7.2 The Neuron hot path — Collection-at-scale + data-delegation

The race is **Collection-at-scale**; data-delegation is its API expression. The dependency that governs sequencing:

> **The Neuron hot path is gated on Collection, not on the binding refactor.** Real data-delegation across reactive proxies and Collection requires Collection's high-performance path (O(1) append, no proxy overhead at scale) to *exist as a mature substrate first* — you cannot homogenize an API across two things when one isn't built out.

| Item | What | Dependency | Notes |
|---|---|---|---|
| **2.1a** | **Collection performance path to Neuron's bar** | 2.0 | **The real blocker — data-structure work, not binding-refactor.** Tens of thousands of cogits, sorted/searched/accessed efficiently against 200MB+ JSON. This is what the applications are actually waiting on. Named as its own deliverable so the prerequisite is tracked, not hidden inside "delegation." |
| **2.1b** | **Homogenized reactive + Collection data-delegation API** | **2.1a** | The hot-path event surface. Principle-of-least-surprise: `delegate` means the same thing on reactive proxies and Collection, so a developer transitions without learning new terrain. **Clean-slate design** against mature Collection's actual shape — *not* a salvage of the removed Aurelia stub (§6.4). |

**Neuron substrate trajectory:** start **DOM/SVG**, then move to **WebGL** (200MB+ JSON → tens of thousands of cogits demand it). The DOM/SVG phase is the **peak justification** for data-delegation (per-node listeners thrash on every layout tick; one delegated container listener with `.closest()` matching is the answer virtualization can't provide here). WebGL removes DOM nodes entirely (hit-test against the canvas), so DOM-delegate goes moot *for Neuron specifically* at that point — but mid-size dashboards and update-churn persist, so the API stays justified regardless.

### 7.3 `switch` / `case` / `default` (from Amendment A1 backlog)

> **Priority:** Non-urgent. Design fully resolved conceptually; lowering strategy open. Ships after the Collection performance milestone (2.1a) and the data-delegation API (2.1b), but has **no dependency** on either. Filed here so the bare-`else` removal (§6.2) is forward-looking rather than purely restrictive.

**The problem this solves.** Removing bare `else` (§6.2) closes a bug class but leaves one legitimate need unserved: **exhaustive multi-state handling with a guaranteed catch-all**, without forcing the developer to write a compound negated condition. The explicit negated `if` pattern is correct and encouraged as a discipline — it documents assumptions — but there is a valid case for a construct that guarantees exhaustiveness *by construction*, particularly for state machines with a bounded, known set of values.

**Why `switch` solves it where bare `else` could not.** Bare `else` failed because it requires a sibling-adjacency pairing rule — an invisible scope boundary. `switch` makes the scope boundary **explicit and visible**: the container element. The `default` inside a `switch` does not scan upward; its parent *is* its scope. Nest a second switch three levels down and its `default` is still unambiguous — the container walls it off. This is the only mechanism that retains a catch-all without introducing positional magic: it pays for `default` by purchasing a scope container.

**Proposed syntax.**

```html
<switch on="status">
  <case if="loading">
    <div>Loading…</div>
  </case>
  <case if="error">
    <div>${errorMessage}</div>
  </case>
  <case if="ready">
    <ul><li repeat.for="node of nodes">${node.label}</li></ul>
  </case>
  <default>
    <div>Unexpected state: ${status}</div>
  </default>
</switch>
```

**Design properties.**

* **`on="expression"`** — the switch expression, evaluated reactively. Cases are checked in document order; first match wins. Mutual exclusion is enforced by the construct, not by the developer.
* **`<case if="value">`** — matches when the switch expression equals the case value, OR when the `if` attribute is a boolean expression that evaluates true. Supports both equality matching (`if="loading"`) and expression matching (`if="progress > 0.5"`).
* **`<default>`** — valueless, but unambiguously scoped to its enclosing `switch`. No positional scanning required. Renders when no `case` matches. (This is precisely why `default` is admissible where bare `else` is not — the container supplies the scope the bare marker lacked.)
* **Grammar uniformity:** `switch`, `case`, `default` are custom elements (or compile-time-erasable wrappers — see below). They introduce no new attribute grammar; they are structural elements with structural semantics.

**Relationship to `if` / `else-if`.** Not competing constructs — they serve different registers:

| Need | Construct |
|---|---|
| Simple boolean conditional | `if="condition"` |
| Linear multi-state, no exhaustiveness required | `if` + `else-if` chain |
| Exhaustive multi-state with guaranteed catch-all | `switch` / `case` / `default` |
| Residual safety net with explicit assertion | `if="!a && !b && !c"` |

The answer to "where is my `else`?" is: for the boolean case, write `else-if="!condition"`; for the exhaustive case, use `switch`. Neither is a workaround — each is the right tool for its register.

**Open design question — lowering strategy** (decision deferred to implementation):

* **Option A — compile-time erasable wrapper.** `<switch>`/`<case>`/`<default>` are compiler-only; the compiler erases them and emits imperative conditional logic (the way `with.bind` was erased to text substitution). Zero runtime cost, no new runtime primitives. *Tradeoff:* the compiler must handle full case-matching at compile time — straightforward for static `on=` expressions, but reactive `on=` that changes value still needs runtime support.
* **Option B — thin runtime construct.** `switch` becomes a small runtime component (~50–80 LOC) handling reactive `on=` updates and case matching; cases register with their parent switch on mount. *Tradeoff:* adds a small runtime surface, but handles reactive switch expressions cleanly and keeps the compiler simple.
* **Likely resolution:** Option B for reactive `on=` (the common case), with an Option A fast path for static `on=` the compiler can resolve at build time. This mirrors the `if` / `repeat.for` split — inherently-reactive structural directives get minimal runtime support, not compile-time erasure.

**LOC budget.** Small, well-understood construct. Estimated runtime surface 60–100 LOC — well within the 2.5K runtime budget given the headroom after 2.0. Not a budget concern.

**Diagnostic bridge.** The bare-`else` rejection diagnostic (§6.2) already names `switch` / `case` / `default` as the alternative for exhaustive cases — this backlog item is the forward reference that diagnostic points at.

---

## 8. The synthesis worth keeping in view

The pipe (§5.3), the raw path (§3), and the audit (§3.4) are **not three features — they are one mechanism.** The declared, audited XSS escape hatch *is* a sanitizer in a pipe on a raw binding:

```html
innerHTML.rawBind.to-view="userHtml | sanitizeHtml"
```

That single expression says: you're doing `innerHTML` (not on the allowlist → forced to `rawBind` → **fails closed if you forget**), you've routed it through a named transform, and the biscuit records both facts as one line:

> *raw innerHTML at SearchBar:8, sanitized via sanitizeHtml*

The whole security story collapses into one legible, greppable, baseline-diffable record. **Keeping the pipe is not in tension with the security work — the pipe is the security work's declaration surface.**

---

## 9. Versioning

### 9.1 "1.5.2" was a SemVer violation

SemVer is MAJOR.MINOR.PATCH: PATCH = backward-compatible fixes only, MINOR = backward-compatible additions, MAJOR = breaking changes. This refactor is *nothing but* breaking changes (`unsafe`→`raw`, `.one-time`→`set`, `.delegate` removed, converter semantics replaced, `&` eliminated, `with` removed, `.trigger`→`.calls`). That is a **MAJOR** bump.

### 9.2 The version is a name, and it was failing the audit

By the standard applied to `unsafe` and `.one-time`, a version number is a *name for the release's maturity and risk*. "v1.5.2" said "stable line, trivial patch" while meaning "breaking foundational overhaul." The version was lying. Fix it the same way: make the name accurate.

### 9.3 Decision

* **This refactor = `2.0.0`.** Earned: a security model giving *every* API surface XSS defense by default with an audited `raw` escape hatch, replacing the binding language wholesale, is the textbook definition of a breaking architectural change.
* **Attribute spread = `2.1.0`** (additive).
* **DiamondJS is the SemVer canary** for the project fleet. This is dependency-correct: SemVer communicates compatibility *to dependents*, and the thing at the bottom of the stack (the substrate Crystallizer, NetPad, and the neuron tooling all build *on*) is the one whose versioning contract carries the most weight. The deepest dependency gets the honest contract first; downstream then expresses its dependency precisely (`@diamondjs/core@^2.0.0`).
* The raw-path architecture means *post-stability* security hardening won't force major bumps (existing `raw` call sites become audited escape hatches, not breaking changes) — so the eventual clean `2.0.0` can genuinely hold stable. This is the argument for doing the foundational churn *now*, pre-stability, where it costs ~nothing.

---

## 10. Before/after token reference (implementation cheat sheet)

| Concern | v1.5.1 (Aurelia-derived) | v2.0 | Section |
|---|---|---|---|
| Unescaped escape hatch | `unsafe*` | `raw*` (`rawSet`, `rawBind`) | §3.1 |
| Static one-shot assignment | `.one-time` | `set` / `rawSet` | §4.1 |
| Directional data binding | `bind.to-view` / `bind.from-view` | **unchanged** (+ `raw` counterparts) | §4.2 |
| Binding-update timing | `& updateTrigger:'blur'` | `value.update-on="blur"` (property-scoped attr) | §4.3 |
| Handler debounce/throttle | `& debounce:500` | `this.debounce(fn, 500)` (self-registering class field) | §4.3 |
| `& signal` | `& signal` | make the dependency reactive | §4.3 |
| Value transform | `\| converterName` (value-converter resource) | `\| ConverterClass(...args)` (static `format`/`parse`) | §5 |
| Transform location | `transform_functions/` folder | import graph (no magic folder) | §5.5 |
| Parse return | raw passthrough on missing `fromView` | `ParseResult<T>`; `parse` required on two-way leg | §5.6–5.7 |
| Conditional DOM inclusion | `if.bind="cond"` | `if="cond"` (bare) | §6.2 |
| Conditional else-branch | `else` (Aurelia, bare) | `else-if="!cond"`; **bare `else` removed** | §6.2 |
| List repetition | `repeat.for="x of xs"` | **unchanged** | §6.3 |
| Event handler | `click.trigger="fn()"` | `click.calls="fn()"` | §6.5 |
| Event delegation (command) | `click.delegate="fn()"` (hollow stub) | **removed** (+ delete `DiamondCore.delegate()`) | §6.4 |
| Capture-phase listener | `click.capture="fn()"` | **unchanged** (own command) | §6.6 |
| Scope rebinding | `with.bind="obj"` | **removed entirely** (no `with` concept) | §6.1 |
| Dynamic attr/prop spread | — | `...attrs.bind` / `...attrs.rawBind` (**2.1**) | §7.1 |
| Exhaustive multi-state w/ catch-all | — | `<switch>` / `<case>` / `<default>` (**2.1**) | §7.3 |

---

## 11. Implementation sequencing & open unknowns

### 11.1 Sequence

1. **Baseline confirmed:** codebase is at **v1.5.1** (CC, against structural markers). The 1.5.1→2.0 diff is therefore a *real* diff against real code — a true migration guide and accurate ground truth, not a spec written against assumptions. The reconnaissance claims (delegate stub wired to fallback, `outerhtml` no-op, one-time bypassing `bind()`) are now **checkable facts** — verify before cutting against them.
2. **Execute 2.0** — the closed boundary in §§3–6, §9.
3. **2.1a** — Collection performance path to Neuron's bar. *The real first domino for the applications.*
4. **2.1b** — homogenized reactive+Collection data-delegation API (depends on 2.1a).
5. **2.1 (parallel)** — attribute spread (depends only on the 2.0 allowlist; independent of the Neuron track).
6. **2.1 (parallel, non-urgent)** — `switch` / `case` / `default` (§7.3). Design-complete; lowering strategy (compile-time-erasable vs. thin runtime) resolves at implementation. No dependency on 2.1a/2.1b.

### 11.2 The load-bearing unknown: allowlist contents

What is *actually on* the safe-sink list is the open empirical question the whole security model inverts against.

* **Outbound DOM sinks → tractable.** Trusted Types gives most of the sink inventory to invert against.
* **Reactive-proxy surface → genuine unknown-unknowns.** This is the part you'll be *discovering* rather than transcribing. And it is the same surface Collection exists to route *around* at scale — so **2.1a and the security unknown are the same empirical probe wearing two labels.** The reason Collection bypasses the proxy is the reason the proxy's behavior at scale is the open question. Run the probe once.

### 11.3 Where to run it

**NetPad** is the right stress test: cross-user real-time content flow is the **hardest XSS surface**, and it exercises both the performance bar and the injection surface at their most demanding — while the foundation is still cheap to change.

---

*End of record. The boundary is closed; the rest is implementation.*
