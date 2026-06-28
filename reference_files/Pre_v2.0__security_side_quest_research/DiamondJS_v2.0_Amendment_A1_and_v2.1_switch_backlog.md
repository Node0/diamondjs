# DiamondJS — Amendment A1 to v2.0 Design Decision Record
# + v2.1 Backlog: `switch` / `case` / `default`

**Amendment status:** Closes §6.2 of the v2.0 DDR. Supersedes the treatment of `else` and `else-if` implied by the original `if.bind → bare if` decision.
**Backlog status:** v2.1 feature, design fully resolved, lowering strategy open.
**Date:** June 28, 2026
**Origin:** Post-DDR design session; decisions derived from first-principles analysis of positional-pairing failure modes and LLM authoring constraints.

---

## Amendment A1 — `if` / `else-if` / no `else`

### What the original §6.2 said

`if.bind` → bare `if`. The suffix carries no information (no sink, always reactive, reserved word). Correct and unchanged.

The original §6.2 left the `else` / `else-if` treatment implicit — inherited from the Aurelia/HTML mental model without explicit examination.

### What this amendment decides

**`else-if="<condition>"` — retained.**
**Bare `else` — removed. Does not ship in 2.0 or any subsequent version.**
**Residual / catch-all cases — explicit negated `if` attribute on a standalone element.**

### The problem with bare `else`

Bare `else` is a positional marker with no value, no `=`, and no RHS. It violates the grammar of every other structural directive in DiamondJS:

- `if="condition"` — attribute with value ✓
- `else-if="condition"` — attribute with value ✓
- `repeat.for="item of items"` — attribute with value ✓
- `else` — bare, valueless, positional ✗

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

Three `else` clauses at three nesting levels. Pairing is resolved by proximity rules the syntax does not encode. A misplaced `else` is syntactically valid and silently wrong. This is a whole class of bugs with no compile-time signal.

**This is the structured-programming argument restated for template DSLs.** Goto is seductive for the same reason bare `else` is seductive — maximum expressiveness, zero locality. Dijkstra's objection was always about locality of reasoning, not power. Bare `else` fails the same test.

### Why `else-if="condition"` survives

`else-if` does not have the pairing problem because its condition is self-describing. A model reading `<div else-if="hasError">` knows what it means without scanning upward. The condition is the locality. The sibling relationship is still positional (it follows the preceding `if` or `else-if`), but the *meaning* is encoded in the attribute value, not in the reader's ability to track scope.

`else-if` is also syntactically uniform with `if` — both are attributes with explicit `=` and a value. The grammar is consistent.

### The residual / catch-all pattern

The catch-all case that bare `else` served is written as an explicit negated `if`:

```html
<div if="isLoading">Loading…</div>
<div else-if="hasError">${errorMessage}</div>
<div else-if="isReady">
  <ul><li repeat.for="node of nodes">${node.label}</li></ul>
</div>
<div if="!isLoading && !hasError && !isReady">Something unexpected happened.</div>
```

The final element is a **standalone `if`**, not chained — which signals to the reader that it is a safety net outside the primary flow, not a branch within it.

This pattern is strictly more informative than bare `else`:
- It names the three conditions it is asserting are simultaneously false
- It documents the developer's assumptions about the state space
- It breaks loudly when a new state is added and this line is not updated
- It gives a debugger at 2am concrete information about what failed

Bare `else` says "none of the above." The explicit negated form says "specifically these named conditions were all false simultaneously." The second is a meaningful assertion. The first is a residual bucket.

### LLM authoring properties

Bare `else` requires the generating model to:
1. Track open `if` scopes as a stack while writing forward
2. Place `else` correctly relative to that stack
3. Verify pairing on readback by reconstructing the sibling chain

`else-if="condition"` requires the generating model to:
1. Write an attribute with a value

Each element is fully self-contained. No stack, no lookback, no pairing. Correct by construction. This is the same property that motivates every other DiamondJS naming decision — a token must predict its own behavior. `else-if="hasError"` predicts its behavior completely. Bare `else` predicts nothing without context.

### What was explored and rejected

**Named string tieback:**
```html
<div if="isLoading" diamond-gate="loading-gate">…</div>
<div else-if="hasError" else="loading-gate">…</div>
<div else="loading-gate">…</div>
```
Solves the positional problem by replacing it with a reference problem. Requires a new cross-element reference system, a new reserved attribute (`diamond-gate` or equivalent), and introduces ordering ambiguity when multiple elements share a gate name. Trades positional magic for reference magic. Also seductive — structurally resembles goto, with the same expressive power and the same locality failure. Rejected.

**Compile-time `else` expansion:**
Expand bare `else` to its negated condition at compile time so compiled output is explicit. Solves the *machine reading* problem, does nothing for the *LLM authoring* problem. The model writes source, not compiled output. The source-level `else` is still positional. Rejected for the same reason.

### Canonical form summary

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

### Non-existent forms — compiler must reject

```html
<div else>…</div>                    <!-- INVALID — bare else removed -->
<div if.bind="cond">…</div>          <!-- INVALID — v1.5.1 dead syntax -->
<div rawIf="cond">…</div>            <!-- INVALID — if has no sink -->
<div if.set="cond">…</div>           <!-- INVALID — if is always reactive -->
```

The compiler should emit a clear diagnostic for bare `else`, suggesting `else-if="!<condition>"` or the `switch` construct (v2.1) as alternatives.

---

## v2.1 Backlog — `switch` / `case` / `default`

**Priority:** Non-urgent. Ships after Collection performance milestone (2.1a) and data-delegation API (2.1b). No dependency on either.
**Design status:** Fully resolved conceptually. One open question on lowering strategy (see below).

### The problem this solves

The removal of bare `else` closes a bug class but leaves one legitimate need unserved: **exhaustive multi-state handling with a guaranteed catch-all**, without requiring the developer to write a compound negated condition.

The explicit negated `if` pattern is correct and encouraged as a discipline — it documents assumptions. But there is a valid case for a construct that guarantees exhaustiveness by construction, particularly for state machines with a bounded, known set of values.

### Why `switch` solves it where bare `else` could not

Bare `else` failed because it requires a sibling-adjacency pairing rule — an invisible scope boundary. `switch` solves this by making the scope boundary **explicit and visible**: the container element. The `default` inside a `switch` element does not need to scan upward; its parent *is* its scope. Nest a second switch three levels down and its `default` is still unambiguous — the container walls it off.

This is the only mechanism that retains a catch-all without introducing positional magic. It pays for `default` by purchasing a scope container.

### Proposed syntax

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

### Design properties

**`on="expression"`** — the switch expression. Evaluated reactively. Cases are checked in document order; first match wins. Mutual exclusion is enforced by the construct, not by the developer.

**`<case if="value">`** — matches when the switch expression equals the case value, OR when the `if` attribute is a boolean expression that evaluates true. Supports both equality matching (`if="loading"`) and expression matching (`if="progress > 0.5"`).

**`<default>`** — valueless, but unambiguously scoped to its enclosing `switch`. No positional scanning required. Renders when no `case` matches.

**Grammar uniformity:** `switch`, `case`, `default` are custom elements (or compile-time-erasable wrappers — see lowering question below). They do not introduce new attribute grammar. They are structural elements with structural semantics.

### Relationship to `if` / `else-if`

These are not competing constructs. They serve different registers:

| Need | Construct |
|---|---|
| Simple boolean conditional | `if="condition"` |
| Linear multi-state, no exhaustiveness required | `if` + `else-if` chain |
| Exhaustive multi-state with guaranteed catch-all | `switch` / `case` / `default` |
| Residual safety net with explicit assertion | `if="!a && !b && !c"` |

The answer to "where is my `else`?" is: for the boolean case, write `else-if="!condition"`. For the exhaustive case, use `switch`. Neither is a workaround — each is the right tool for its register.

### Open design question — lowering strategy

Two options, decision deferred to implementation:

**Option A: Compile-time erasable wrapper**
`<switch>`, `<case>`, `<default>` are compiler-only constructs. The compiler erases them and emits imperative conditional logic, similar to how `with.bind` was erased to text substitution. Zero runtime cost, no new runtime primitives.

Tradeoff: the compiler must handle the full case-matching logic at compile time, which is straightforward for static `on=` expressions but requires runtime support for reactive switch expressions that change value.

**Option B: Thin runtime construct**
`switch` becomes a small runtime component (~50–80 LOC) that handles reactive `on=` updates and case matching. Cases register themselves with their parent switch on mount.

Tradeoff: adds a small runtime surface, but handles reactive switch expressions cleanly and keeps the compiler simple.

**Likely resolution:** Option B for reactive `on=` (the common case), with an Option A fast path for static `on=` expressions the compiler can resolve at build time. This mirrors the `if` / `repeat.for` split — structural directives that are inherently reactive get minimal runtime support, not compile-time erasure.

### LOC budget note

`switch` is a small, well-understood construct. Estimated runtime surface: 60–100 LOC. Well within the 2.5K runtime budget given the remaining headroom after 2.0. Not a budget concern.

### Compiler diagnostic bridge (from Amendment A1)

The compiler's bare `else` rejection diagnostic should mention `switch` / `case` / `default` as the alternative for exhaustive cases:

```
Error: Bare `else` is not valid in DiamondJS 2.0+.
  → For a two-branch conditional: use `else-if="!<condition>"`
  → For exhaustive multi-state with a catch-all: use <switch> / <case> / <default> (v2.1)
```

This makes the removal of bare `else` forward-looking rather than purely restrictive.

---

*Amendment A1 closes the `else` / `else-if` question for the 2.0 implementation session.*
*The `switch` backlog item is design-complete; lowering strategy resolves at 2.1 implementation time.*
