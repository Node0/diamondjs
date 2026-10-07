# DiamondJS v2.0 — Implementation Working Notes

Implementation-discovery details that are **not** specification. The phase specs live in the approved plan and reference only the DDR + Amendment A1. This file captures parser/tooling/runtime realities discovered during implementation.

---

## Parser / grammar realities

- **parse5 lowercases all attribute names.** Both the property segment and the command segments arrive lowercased. So source `innerHTML.rawBind.to-view` reaches the parser as `innerhtml.rawbind.to-view`. The camelCase legibility of `rawBind`/`rawSet` is a **source-only affordance**; the compiler never sees the casing.
  - Normalize the property segment through `PROPERTY_NAME_MAP` (already used for `textcontent`→`textContent`, etc.).
  - Command matching is **lowercase-keyed**.
- **Three-segment attribute grammar (DDR §8/§10).** Attribute names may now have 2 or 3 dot-segments. Parse by splitting the attr name on `.`:
  - 2-segment: `property.command` — e.g. `value.set`, `value.bind`, `value.to-view`, `value.from-view`, `value.two-way`, `value.rawSet`, `click.calls`, `panel.capture`.
  - 3-segment: `property.command.qualifier` — the raw directional escape hatch: `innerHTML.rawBind.to-view`, `innerHTML.rawBind.from-view`, `innerHTML.rawBind.two-way` (and the §10 directional `bind.to-view`/`bind.from-view` if authored property-prefixed).
- **Internal representation:** `BindingInfo` carries `{ type, raw }` where `type` is the operation enum and `raw` is a boolean. This is NOT a flattened token — the *source surface* stays three-segment (`rawBind.to-view`). The flattened tokens `rawTo-view`/`rawFrom-view`/`rawTwo-way` must never appear (spec correction #1). Mapping:
  - `set`→{set,false}, `rawSet`→{set,true}
  - `bind`→{bind,false}, `rawBind`(.dir)→{<dir or two-way>,true}
  - `to-view`/`from-view`/`two-way`→{same,false}
  - `calls`→{calls,false}, `capture`→{capture,false}
- **Kill the silent `|| 'bind'` fallback** in `parseBindingCommand`. Unknown/retired commands (`one-time`, `trigger`, `delegate`, typos) become hard `error` diagnostics, not a silent two-way bind (fail-open is unacceptable in a security release).

## Security gate (Phase 1)

- New compiler module houses `SAFE_SINKS` + the pure gate decision + diagnostic types. SAFE_SINKS contents are the §11.2 "load-bearing unknown" — starter set below, refine empirically.
- **Gate runs for the four OUTBOUND sink ops** (`set, bind, to-view, two-way`). NOT for `calls`/`capture` (addEventListener, no sink), `if`/`else-if`/`repeat.for` (no sink, §6.2), or **`from-view`** (inbound — see correction below).
- ~~`core.ts bind()` always runs the view-update effect, so `from-view` is also an outbound sink write → gated.~~ **CORRECTED (Phase 2 review):** this was a bug. See "from-view one-way fix" below.

### from-view one-way fix (Phase 2 review — security correction)
The Phase 1 generator wired `from-view` as `DiamondCore.bind(el, prop, () => expr, (v) => expr = v)` — i.e. **two-way**, because `bind()` unconditionally ran the to-view getter effect. That let the model push into the sink, contradicting the construct's name and silently bypassing a developer's intentional inbound-only security boundary (e.g. `innerHTML.rawBind.from-view` for a validated inbound path — a websocket/sibling write to the model would reach `innerHTML` unvalidated).
- **Fix:** `bind()` getter is now `(() => unknown) | undefined`; the to-view effect runs ONLY when a getter is passed. `from-view` emits `DiamondCore.bind(el, prop, undefined, setter)` — DOM→model only, model never reaches the sink. (Matches Aurelia from-view: view not initialized from the model either.)
- **Consequence:** `from-view` is now genuinely **inbound** → removed from the outbound `SinkOp` set and NOT outbound-gated (§3.3 row 1). Its inbound risk is the runtime smell check (§3.3 row 3, Phase 3). The `raw` flag on `from-view` (`rawBind.from-view`, valid per §4.2 "+ raw counterparts") is preserved as the **inbound-escape hatch** Phase 3 will consume.
- **Principle:** a one-way-named flow must never permit the opposite flow. Tests: runtime `core.test.ts` (model write does not reach the sink) + generator (undefined getter, from-view not outbound-gated).
- **Centralize all sink emission through one helper** so no future code path can emit a property write without passing the gate (this is what permanently closes the one-time bypass).
- Gate decision table (normalize property via PROPERTY_NAME_MAP, then `safe = SAFE_SINKS.has(prop)`):
  - `raw=false, safe=true` → clean, no diagnostic.
  - `raw=false, safe=false` → emit treated-as-raw bytes + **`stink:warn`** (hard gate).
  - `raw=true, safe=false` → raw write + **`stink:declared`** (baselined, no block).
  - `raw=true, safe=true` → clean + `info` (redundant raw).
- Insight: for a non-safe sink, emitted bytes are identical declared vs. undeclared — you can't make `innerHTML` safe with code, only with a declaration. The gate forces the declaration into the reviewed baseline.

### SAFE_SINKS starter set (camelCase canonical)
text: `textContent`, `innerText`; value/state: `value`, `valueAsNumber`, `valueAsDate`, `checked`, `selected`, `selectedIndex`; class: `className`; boolean UI: `disabled`, `readOnly`, `required`, `hidden`, `multiple`, `open`; numeric scalars: `tabIndex`, `maxLength`, `minLength`, `rowSpan`, `colSpan`, `scrollTop`, `scrollLeft`; plain-text descriptors: `placeholder`, `title`, `alt`, `label`, `htmlFor`; constrained tokens: `type`, `name`, `accept`, `autocomplete`, `inputMode`, `step`, `min`, `max`, `pattern`, `id`.

Off-list (require `raw`): `innerHTML`, `outerHTML`, `srcdoc`, `href`, `src`, `srcset`, `action`/`formAction`, `style`/`cssText`, all `on*`, everything unenumerated (fail closed).

**Coupling:** any safe sink whose camelCase ≠ lowercase must also be in `PROPERTY_NAME_MAP` or it fails closed as a false-positive warn. Add missing entries: `minLength`, `scrollTop`, `scrollLeft`, `valueAsNumber`, `valueAsDate`, `inputMode`, `selectedIndex`, `autocomplete`. Ship a unit test asserting `SAFE_SINKS ⊆ keys(PROPERTY_NAME_MAP) ∪ lowercase-identical`.

## Diagnostics surfacing

- Add `diagnostics: Diagnostic[]` to `CompileResult` (additive; existing `{outputCode, result}` consumers unaffected). Parser emits retired/unknown-command errors; generator emits gate diagnostics (only it knows property+op+raw together); `DiamondCompiler.compile()` merges.
- Parcel transformer: **throw on `severity:'error'`** (retired/unknown = broken source); pass `warn`/`declared`/`info` through silently. Enforcement is the merge gate (tools script), not local dev.

## Stink tooling (Phase 1)

- Baseline file at repo root (checked in), sorted for clean diffs. Record per declared raw: `{ id: "file:line:property:op", file, line, property, op, expression }`. `expression` is the §8 human-readable audit record ("raw innerHTML at SearchBar:8, via sanitizeHtml").
- Check script mirrors `tools/check-loc-budget.ts` (tsx). Modes: `--check` (fail on any `error` or `stink:warn` count>0; declared baseline drift surfaces via git diff, does NOT hard-fail per §3.4) and `--update` (rewrite baseline). Wire `stink:check`/`stink:update` npm scripts; add to `prepublishOnly` beside `check-loc`.

## `isDiamondTemplate` detection (parcel utils)

Must add new tokens AND retain retired ones: detect `calls|set|rawset|rawbind|capture|bind|to-view|from-view|two-way` plus retired `trigger|delegate|one-time` — otherwise a `.trigger` file is never detected, never compiled, and the helpful "renamed to .calls" diagnostic never fires (silently served as raw HTML).

## Migration surface (will break on Phase 1 landing)

- `examples/hello-world/src/Counter.diamond.html` uses `click.trigger` → `click.calls`.
- Tests referencing retired tokens: `parser.test.ts`, `generator.test.ts`, `compiler.test.ts`, `transformer.test.ts` (one-time/trigger/delegate assertions).

---

# Phase 2 — Structural directives (working notes)

## Parser representation
- New `ElementInfo.structural?: { type: 'if' | 'else-if' | 'repeat'; expression; location; itemName?; itemsExpression? }`. At most one structural per element (diagnostic if two).
- Single-segment attrs: `if`→structural if; `else-if`→structural else-if; `else`→**error** (bare else removed → suggest `else-if="!cond"` or switch v2.1); `with`→**error** (removed → VM getter); `rawif`→**error** (if has no sink/raw).
- `repeat.for` special-cased BEFORE binding-command parsing (segments[0]==='repeat'): parse `"item of items"` via `/^\s*(\w+)\s+of\s+(.+)$/`.
- Misuse: `if.<anything>` / `else-if.<x>` → error ("takes no command; use bare"); `with.bind` → error (with removed); `repeat.<not-for>` → error.

## Generator
- `prefixExpression` rewritten to a token-aware identifier prefixer (handles conditions with operators: `!a && !b`, `nodes.length > 0`, `progress > 0.5`). Regex matches string-literals | `.tail` | identifier-root; only prefixes identifier-roots that are NOT keywords, NOT in-scope loop vars. Keywords set includes `this,true,false,null,undefined,typeof,instanceof,in,of,new,void,NaN,Infinity`.
- `scopeVars: Set<string>` — loop variables in scope; pushed around repeat bodies so `${user.name}` and `select(user)` reference the closure param, not `this`.
- `generateNodes` groups consecutive `if` + `else-if` siblings (skipping whitespace) into ONE conditional; orphan `else-if` → error.
- `generateElement(element, ignoreStructural)` — when building a branch/item body, ignore the element's own structural attr (already consumed by the enclosing construct).
- Conditional → `const a = document.createComment('if'); DiamondCore.if(a, [{when:()=>cond, make:()=>{...; return el}}, ...])`.
- Repeat → `const a = document.createComment('repeat'); DiamondCore.repeat(a, ()=>items, (item)=>{...; return el})`. Index param omitted from generated closure (not in DDR surface).

## Runtime (core.ts)
- Cleanup scope: `currentScope: CleanupFn[] | null`. `bind`/`on`/`if`/`repeat` register teardown via `track()` when a scope is active. Top-level (component root) scope is null → matches existing no-cleanup-at-root behavior.
- `captureScope(fn)` → `{ value, cleanup }`: collects all teardown registered during `fn`. Structural directives dispose a removed branch/item with it. **[Corrected v2.1.1, D-1]** In v2.1 this claim was false for the `if`/`switch` toggle path (branches were cached and detached without cleanup); as of v2.1.1 the branch cache is removed and **detached means disposed** across all three structural directives. Note also: a bare structural directive outside any `captureScope` registers no cleanup at all (`track()` is a no-op when `currentScope` is null).
- `DiamondCore.if(anchor, branches)`: first truthy `when()` wins; branches built lazily; a toggled-off branch is **disposed eagerly** (node removed + captured cleanup invoked, same shape as repeat's `gone.cleanup()`) and rebuilt fresh on re-activation — there is **no branch cache** (removed in v2.1.1, D-1). Reactive reads (the `when()`s) happen BEFORE `make()` so the master effect tracks condition deps (the engine nulls activeEffect after a nested effect, so reads must precede builds).
- `DiamondCore.repeat(anchor, itemsGetter, makeItem)`: keyed by **item identity** (default). Reuses/reorders nodes via `insertBefore(node, anchor)` in document order; disposes gone items. Known limit: duplicate primitive items collide on identity (acceptable; most repeats are over objects). `itemsGetter()` read before builds for correct dep tracking.

## Known limitation (pre-existing, not worsened)
Top-level compiled bindings still don't auto-clean on unmount (Phase 0/1 behavior). Structural directives DO clean their branch subtrees (via captureScope) — **as of v2.1.1 (D-1) this holds uniformly, including the `if`/`switch` toggle path**, which is stricter than the root. (In v2.1 the toggle path detached without disposing; the "stricter than the root" claim was false for that path.) A holistic root-cleanup pass is deferred.

---

# Phase 3 — Template formatting/parsing (working notes)

## Pipe segment kind = capitalization (reconciles §5.3 vs §5.4)
DDR-consistent but unstated convention: **PascalCase head** (`CurrencyConverter`) = converter class → directional `.format`/`.parse`. **camelCase head** (`parseRaw`, `clamp`, `formatPercent`) = plain transform function → direct call. §5.3's `formatPercent(clamp(parseRaw(this.value)))` = camelCase direct calls; §5.4's `CurrencyConverter.format(this.amount,'USD')` = PascalCase static methods. Args in parens thread to BOTH legs.

## Pipe grammar (hand-written scanner, NOT regex/split)
- Pipes live ONLY in interpolations `${...}` and value-binding expressions. `if`/`else-if` conditions are a different code path (`generateConditional` calls `prefixExpression` directly) — never pipe-split, so `if="a || b"` is structurally safe.
- `splitTopLevel(src, delim)`: char scanner tracking string state (`'"\`` + `\` escape) and bracket depth `()[]{}`; splits only at depth 0, outside strings. For `|`: skip `||` (logical OR — check prev/next char). Reused for pipe-split (`|`) and arg-split (`,`).
- Precedence: pipe is LOWEST (`cond ? a : b | f` → `f(cond ? a : b)`). Lone `|` is always a pipe (bitwise-OR unsupported in template exprs).
- Heads are **bare imports**, emitted verbatim (NEVER `this.`-prefixed). Only the data leaf (`segments[0]`) and each arg are run through `prefixExpression`. This is the critical fix: passing a whole pipe expr to `prefixExpression` would mangle `CurrencyConverter`→`this.CurrencyConverter`.

## Directional lowering
- **interpolation / to-view / set** (display, outbound): full multi-segment FORMAT chain (left-to-right composition).
- **from-view** (inbound): at most ONE transform. Converter → `.parse` (ParseResult, validated); plain fn → direct call (unvalidated); none → passthrough `(v)=>this.target=v`. Multiple → error.
- **two-way**: exactly ONE segment, must be a PascalCase converter. format=`Conv.format(data,args)`, parse=`Conv.parse(v,args)`. **camelCase on two-way → error** (non-invertible — this is the §5.1 hole the capitalization convention opens). Multi-segment two-way → error.

## From-view / two-way ParseResult codegen (inline, not a helper)
```js
// from-view: value.from-view="amount | CurrencyConverter('USD')"
DiamondCore.bind(input0, 'value', undefined, (v) => { const r = CurrencyConverter.parse(v, 'USD'); if (r.valid) this.amount = r.value; });
// two-way: value.two-way="amount | CurrencyConverter('USD')"
DiamondCore.bind(input0, 'value', () => CurrencyConverter.format(this.amount, 'USD'), (v) => { const r = CurrencyConverter.parse(v, 'USD'); if (r.valid) this.amount = r.value; });
```
"Keep raw on invalid" (§5.7) is FREE: from-view's undefined getter means the model never writes the DOM, so not-writing-the-model on invalid leaves the user's text intact. The `error` rendering surface is deferred (§5.7) — mark the seam, don't build it.

## §5.6 enforcement = in the compiler (user decision: Option A)
§5.5 says "the compiler follows that import." Resolution lives IN `DiamondCompiler`, NOT a separate tool / Parcel:
- **`compile()` (direction):** emits `CompileResult.converterObligations` (name + 'parse' + direction + location) for converters on inbound legs; emits camelCase-on-two-way + multi-segment-two-way errors directly (non-invertibility is visible by inspection — no module access needed).
- **`compileAndInject()` (resolution):** for each obligation, regex-scans `componentSource` for the converter's `import ... from '<path>'` (NOT a TS parse — accepted string-compiler ceiling), resolves `<path>` relative to `options.filePath` (tries `.ts`/`.js`/`/index.*`), reads the module, checks `/static\s+parse\b/`. Emits `error` (`converter-missing-parse`) if absent; soft `info` (`converter-unresolved`) for package specifiers / re-exports / missing files ("verify manually" — fail-soft, not a crash). Uses the same diagnostic pipeline; `fs`/`path` added to the compiler.
- **Standalone path guard:** `CompileResult.pipeTransforms` lists all named pipe heads. The Parcel transformer (`utils.compileTemplate`, standalone `.diamond.html` → module) errors (`pipe-transform-standalone`) if any are present — they'd be undefined symbols in a module that only imports DiamondCore. Converters require the component-inject context (where the author's imports are in scope). Fail-closed on the API surface > runtime ReferenceError.

---

# Phase 4 — Binding/handler timing (working notes)

## `value.update-on="blur"` (binding-update timing, §4.3)
- Property-scoped `property.command` attr: `value.update-on="<event>"`. Pairs with the `value` two-way/from-view binding on the same element; sets which DOM event samples the model (replaces the default input/change).
- Parser: `<prop>.update-on` → collected into a per-element map keyed by canonical property; applied to the matching binding as `BindingInfo.updateOn`. Bare `update-on` (single segment) → **error** (ambiguous on multi-binding elements, §4.3). `update-on` on a property with no inbound (two-way/from-view) binding → diagnostic.
- Runtime: `DiamondCore.bind(el, prop, getter, setter?, eventName?)` — when `eventName` given, the from-view listener uses it instead of `getInputEventName(el)`.
- Generator: from-view/two-way emit the 5th arg `'<event>'` when `binding.updateOn` is set.

## `this.debounce` / `this.throttle` (handler timing, §4.3)
- `protected` Component methods returning a wrapped fn. **Self-register their `cancel`** via `registerCleanup` at creation time → the class-field one-liner (`handleInput = this.debounce(v => this.query = v, 500)`) is leak-safe with no visible timer-cancel burden. Field-init order: base `cleanups = []` runs during super(), subclass `handleInput = this.debounce(...)` runs after → `registerCleanup` is ready.
- Cancel-on-unmount: Component.unmount runs all cleanups → pending timers cleared.

## `&` removed (§4.3) — migration diagnostic
- A lone `&` (not `&&`) in a binding/interpolation expression → **hard error**. Detection: `/(?<!&)&(?!&)/` (excludes `&&`/`||`).
- **Bitwise lone `&` is intentionally flagged too — this is NOT a false positive.** A template is a declarative binding surface, not a computation surface (§2.8): there is no legitimate bitwise `&` in a binding (same reason there's none in a SQL WHERE clause or CSS selector). The redirect is a view-model getter (`get result() { return this.a & this.b }`). Syntactically bitwise-`&` and behavior-`&` are indistinguishable (both lone `&`), so no regex separates them — and that's fine, because BOTH should leave the template. Softening to a warning was rejected (softening a security-adjacent error is how holes open; rare legit uses are trivially fixed with a getter, rare illegit uses sneaking past a warning are the real risk). The message redirects both cases (bitwise → getter; behavior → update-on / debounce / reactive / set).

## Batteries: `@diamondjs/converters` (new package) — shipped
Currency (Intl.NumberFormat; en-US-shaped parse + documented seam), Date (Intl.DateTimeFormat; ISO→UTC-midnight parse + calendar-validity check — rejects Feb 30), Phone (NA-only; canonical 10-digit model + "implement your own" seam). Depends on `@diamondjs/runtime` for `ParseResult`. Opt-in via bootstrapper / one `npm install`. Budget entry added to `check-loc-budget.ts` (500 LOC).

## Inbound smell check (§3.3 row 3 / §5.1) — distinct channel, dev-only
- NOT `stink:warn` (that's a compile-time gated code; reusing it is a category error). Use `console.warn('[Diamond] inbound corruption: ...')`.
- Heuristic: `oldValue` number, `newValue` string, `Number.isNaN(Number(newValue))` (catches "$1,250.00" over 1234.56). Covers only 1 of §5.1's 3 rows (phone string→string and date are invisible) — it's a THIN BACKSTOP; the real defense is §5.6 compile-time.
- Hot-path: guard dev-only (`NODE_ENV !== 'production'`), warn-once-per-property (the reactive `set` trap is the §11.2 perf-sensitive path).

## Batteries home: new `@diamondjs/converters` package
ParseResult stays in `@diamondjs/runtime` (the validation contract; batteries + user converters import the same one so it can't drift). Batteries (Currency/Date/Phone) → new `@diamondjs/converters` (deps: runtime) — tree-shakeable, opt-in, honors "import graph is the registry." Needs a `check-loc-budget.ts` entry.

## Edge cases / DDR gaps (decided conservatively)
- Standalone `.diamond.html` can't import a named transform → emit a diagnostic (named pipe transforms require the component-inject path). Inject path leaves the author's converter imports intact (no auto-import).
- Interpolation extraction regex `/\$\{([^}]+)\}/g` breaks on `}` inside pipe args (`${x | Conv('}')}`) — pre-existing; document, fix later with a brace scanner if needed.
- Compiler checks `parse` EXISTS, not its signature (§5.4 — TS checks arity when the module type-checks).

---

# v2.1 — Implementation working notes (2026-07-07)

Ratified design decisions live in `docs/spec/v2.1.0/DiamondJS_v2.1_Amendment_A2_Design_Record.md`; these are the parser/tooling/runtime realities discovered while implementing them.

## Compiler / parser
- `<switch>`/`<case>`/`<default>` are consumed WHOLE by `processSwitch` in `processChildren` — `<case if>` never reaches `tryStructural`, so it cannot collide with the structural `if`. A `case`/`default` reached via the normal path has, by construction, no `<switch>` parent → `*-outside-switch` error.
- Spread detection must run BEFORE the attr-name dot-split (`'...attrs.bind'.split('.')` shreds into `['','','attrs','bind']` and would fall into unknown-command).
- The @import directive scan runs on the RAW template text in `DiamondCompiler.compile()` — parse5 comments never reach `processChildren`, so the node tree can't carry them. A second `IMPORT_LIKE_RE` pass makes malformed `@import`-shaped comments fail loudly instead of silently no-op'ing.
- `emitBindCall` decides single- vs multi-line: block-body setters are ALWAYS multi-line (the `if (r.valid)` prominence is the point, not line length); concise setters split only past 100 chars.
- `combineRoots` is where the erased-wrapper semantics live (multi-root case bodies → DocumentFragment). `generate()` keeps its fixed `root` name (test-compat); only switch bodies use the hint-named variant.
- Static-switch equality uses strict `===` between the decoded `on=` literal and the decoded case literal — a numeric case `if="3"` matches `on="3"` (both decode to number) but not `on="'3'"`.

## Runtime
- `DiamondCore.switch` slot layout: `built[cases.length]` is the default branch. `onGetter()` runs once per effect; expression-case predicates still read reactive state inside the master effect, so their deps track (same reads-before-builds reasoning as `if()`).
- Spread's property-restore reconciliation snapshots the PRE-first-write property value (`prior`), not the previous spread value.
- `ITERATE_KEY` is a module-level symbol; the set trap triggers it only for NEW keys (`!Reflect.has` before the write) — plain value updates don't wake key-set iterators.
- Collection's version signal is a one-field micro-proxy (`createProxy({n:0})`) — reads/bumps ride the existing engine + scheduler; `rev` is a plain untracked mirror used only for sortBy cache invalidation (bumps also increment it inside `mutate`, which slightly over-invalidates the cache — harmless).
- `repeat` registers node→item in a WeakMap at row BUILD; reused rows keep their mapping; disposed rows are deleted eagerly (WeakMap would GC them anyway, but a still-referenced removed node must not resolve).
- Compiler tests import the runtime through its built dist (workspace resolution) — **rebuild the runtime before compiler tests** whenever security.ts/core.ts change (same stale-dist footgun as parcel-plugin ↔ compiler).

## Tooling
- BSD sed has no `\b`; the rename sweeps used perl.
- stink-check now ignores `reference_files/` (prior-project material was tripping 183 errors / 57 warns).
- npm does NOT topologically order `--workspaces` scripts; the root build explicitly builds runtime + primafacie first.
- parcel-plugin src is at exactly 300/300 LOC (tests count toward the budget) — the §2.2 deliberate-increase decision is now due before ANY further growth.

---

# v2.2.3 — First-real-app findings (2026-09-29)

The first application built on the published 2.2.2 constellation (a hosted single-page map/reduce text processor) surfaced five defects, filed as issues #7–#11. Implementation realities discovered while fixing them:

## Compiler / generator
- **Structural call deferral (#7).** `generateNodes` is unchanged; each *container* (element children in `generateElement`, the root / switch-case fragments in `combineRoots`) pushes an attach frame, and `generateConditional`/`generateSwitch`/`generateRepeat` emit only the anchor declaration inline — the `DiamondCore.if/switch/repeat` call is queued on the innermost frame and emitted by `closeFrame()` right after the container's `appendChild` block. Consequence for readers of compiled output: the global var counter now numbers a structural's branch bodies AFTER the siblings that follow it in source (`ifAnchor_3`, `el_select_4`, …, then `el_div_9` inside the branch). Tests that need exact var names must locate them by regex, not assume source order.
- `combineRoots` now takes NODES (it opens the frame itself); `generate()` passes the fixed name `root` through its third argument (test-compat preserved).
- A structural that IS the template root has no frame — its call is emitted in place, before `return`, and first render relies on the runtime guard (one microtask). Every nested structural renders synchronously on mount.
- Scope vars survive deferral because deferred emitters run inside the enclosing `generateElement` call — the loop variable is still in `scopeVars` when a nested repeat/if body is generated.
- **`<select>` wiring (#9)** is the ONE element whose bindings + handlers are emitted after its children (`generateWiring`), behind a `[Diamond]` hint. Every other element keeps bindings → handlers → children. Composes with #7: a `repeat.for`-generated option list is wired by the attach frame before the select's `value` binding runs.
- **Static `<a href>` (#8)** is a literal-only exception in the static-attr loop (`isInertStaticHref`), not an allowlist change: `href` remains off `SAFE_SINKS`; bound `href.*` still warns. Scope is `a`/`area` only (`<link href>` / `<base href>` still warn). Whitespace/control characters are stripped before the scheme test to mirror the HTML URL parser (`java\nscript:` must still warn; stripping can only make a literal look MORE like a scheme). `INERT_URL_SCHEMES = http, https, mailto, tel` — a fail-closed set; extend deliberately.

## Runtime
- **`DiamondCore.placeBefore` (#7)**: synchronous insert when `anchor.parentNode` exists, else ONE microtask retry that re-reads the directive's live nodes (`active` for if/switch, the `current` map for repeat) and inserts them in current order (re-inserting a placed node before its anchor is a no-op move). No retry loop: an anchor still detached after the microtask stays unrendered until the next change — `Component.mount()` attaches synchronously, so components are always covered.
- **`isInertMetadataKey` (#8)** = `isDataOrAriaKey ∪ role`; both gates and spread's branch decision use it. `isDataOrAriaKey` is unchanged and still exported. Spec §6.3's "37 entries" stays accurate — `role` rides the attribute branch, not the allowlist. The A2 inert-metadata sentence (`data-*`/`aria-*`) is now one token short; amend when the spec is next touched.
- **`adoptDefinedReactiveFields` (#11)** runs at the top of `Component.mount()` — the base constructor is too early (subclass fields are defined after `super()` returns). Legacy path: keys recorded per prototype; TC39 field path: per instance via `context.addInitializer`. Repair = capture own value → `delete` → define an instance accessor only when no prototype setter exists → reassign. The dev report (`__DIAMOND_DEV__`) fires once per constructor (WeakSet) and lists every repaired field.
- vitest/esbuild lower class fields to [[Set]] in this repo, so the tests simulate [[Define]] explicitly with `Object.defineProperty` in the constructor; they are independent of the test toolchain's own field lowering.

## Tooling
- **route-check template stubs (#10)**: `installTemplateStubs()` registers ESM hooks from a `data:` URL (no extra file to ship in `dist/bin`) AND wraps `Module._extensions['.js']`. Why the wrapper: tsx's `tsImport` tags CommonJS filenames with `?namespace=…`, so Node's `findLongestRegisteredExtension` never matches a `.html` key — but tsx's transformer delegates every non-TS file to the `.js` handler it captured at registration, which is ours when installed first. Consumers without `"type": "module"` (the Quick Start's `npm init -y` default) hit the CJS path; a `"type": "module"` consumer hits the ESM path. Both are tested.
- The loader test spawns the real bin from source via `tsx/cli` (resolved through tsx's exports map — `tsx/dist/cli.mjs` is not an exported subpath) against two on-disk fixtures. Fixtures must live inside the repo tree so `@diamondjs/runtime` resolves; copying them to a temp dir would break resolution.

---

# v2.2.4 — Turbine findings, continued (2026-09-30)

## Runtime
- **Link interceptor pass-throughs (#14).** `Router.onClick` now returns before `preventDefault` for anchors with `download`, a `target` other than `_self`, a `rel` token `external` (both compared case-insensitively), and any resolved URL whose protocol is not `http:` / `https:`. The protocol test is what catches `blob:` — a `blob:` URL's `origin` is the creating document's origin, so the same-origin test alone claims it; `data:` / `mailto:` / `tel:` already failed that test (`origin` is `'null'`) and are now pinned by tests rather than incidental. The attribute checks live in `Router.optsOutOfRouting` to keep `onClick` near its previous lint complexity.
- `_top` / `_parent` are passed through like `_blank` even though they equal `_self` in a top-level document: the browser then does an ordinary full-page load of a same-origin URL, which is correct, just not SPA.
- **Spec touch-point for Joe:** Router Specification §9 (and the Work Order's link bullet) enumerate the pass-throughs as "middle-click, modifier clicks, and external hrefs". The #14 set extends that list; the spec text is unchanged here — amend when it is next touched.
- **happy-dom performs the default action of an unprevented anchor click** — it navigates the test document. A pass-through test that clicks a `blob:` link moves `location` to the blob URL and every later `history.replaceState` in the file throws `SecurityError`. The #14 tests add a `window` click listener (runs after the router's `document` listener) that records `defaultPrevented` and then cancels the click itself.
- **Query and hash through the pipeline (#20).** `run()` takes a `UrlTail` (`{ search, hash }`) in place of the old `query` argument and writes `href(path) + search + hash`. Sources: the anchor's URL on a link click (`request()`, the private entry behind `navigate()`), `location` on initial load and popstate, a route-* Destination's `query` (serialized in `runTo`). `currentTail` sits beside `currentPath` so a failed commit restores the whole previous URL. Before this, initial load and popstate rewrote the entry to the bare path — the query and hash were lost on load, not only on link clicks.
- `recognize` / `match` / `parseQuery` take the TARGET's search. `parseQuery` used to read `location.search`, which on a push is still the page being left — a link's `?tab=2` never reached the declared converter.
- A same-document fragment link (`hash` present, pathname and search equal to the location's) is not claimed. `onPopstate` likewise returns early when only the hash differs from `currentTail` — Back / Forward between two hashes of one page fires popstate (and a browser may fire it for the fragment navigation itself; not verified in a real browser here), and running the pipeline there would re-run guards on every in-page anchor. A popstate with an identical URL (a duplicate entry) still runs, so "guards on every vector" holds for real traversals.
- **URLs behave as in HTML (#28).** `navigate(url)` parses its argument with `new URL(url, 'http://app.invalid/')` (the base only lends a parser) and hands `request()` the path plus `{ search, hash }`; the interceptor now calls `navigate()` with the stripped path, query and hash, so a link and the equivalent call are literally one code path. Side effect worth knowing: the URL parser percent-encodes the pathname (`navigate('/café')` writes `/caf%C3%A9`), which is what a link click already produced, so the two now agree.
- `href="#"` resolves to a URL whose `hash` is `''` but whose `href` ends in `#`; `isSameDocumentFragment` tests `url.href.endsWith('#')` as well, so the empty fragment passes through (the browser scrolls to the top).
- **Scroll.** `run()` ends with `settleScroll(vector, hash)` after the commit: a popstate with a recorded position restores it (`window.scrollTo`); else a hash whose element exists gets `scrollIntoView()` (`#top` with no such element scrolls to the top, as HTML); else a push scrolls to the top and an initial load is left to the browser. Positions are recorded per history entry, keyed by the `diamondNavId` the entry's state carries: `rememberScroll()` runs before a push's `pushState` and at the top of `onPopstate` (the page being left is still in the DOM there), and `onPopstate` reads the saved position for `history.state.diamondNavId` BEFORE `run()` stamps the entry with a new id. `currentNavId` is set wherever the entry's state is written, including the failed-commit `replaceState`.
- `history.scrollRestoration` is NOT set to `manual`. The browser's own restoration runs on the page being left (before the commit, so it lands on the old DOM); ours runs after the commit and wins. Leaving it on `auto` keeps a reload's position and the native behaviour of hash-only traversals, which the router still ignores. 'Where possible' therefore means: a position is restored when the router recorded one for that entry (every entry it wrote and left); clamping to the mounted page's height is the browser's.
- happy-dom does no layout: the tests stub `scrollX` / `scrollY` / `scrollTo` on `window` and `scrollIntoView` on `Element.prototype` per test and restore the descriptors after. Forward is simulated as before (re-push the entry WITH the state object the browser would have kept, then a popstate), which is what makes the restore-on-Forward test meaningful.
- happy-dom: `history.back()` / `forward()` work and fire popstate asynchronously, but `replaceState` on a back entry DISCARDS forward history (a browser keeps it) — so after the router's popstate `replaceState`, Forward has to be simulated (re-push the entry + dispatch popstate). A hash-only anchor click sets the hash and fires hashchange but no popstate.
- **Mounted range (#17).** `DiamondCore.trackRange(body, stop?)` → `{ node, remove }` replaces the three `.remove()`-on-the-returned-node sites (`if()`, `switch()`, `Component.unmount()`). It is public for the same reason `captureScope` is: `Component` needs it. The range is a first/last node pair taken BEFORE the insert (a fragment is empty afterwards); `remove()` walks `nextSibling` from first and stops at `last`, at `stop` (the owning structural's anchor — never removed) or at the end of the parent. `Component` has no owning anchor, so there the walk is bounded by `last` or the end of the host only.
- **Why the start needs care, the end does not.** Every structural inserts BEFORE its own anchor and never removes that anchor, so a body's last root is stable whether it is static or an anchor. The first root is not: if the body begins with a structural, its output lands in front of the range. Worse, compiled bodies append the anchors to the fragment and THEN wire the structurals, so a truthy `if` / non-empty `repeat` has already rendered into the fragment by the time `make()` returns — the fragment's first child is then that structural's *output*, which is replaced on the next change (a first/last pair anchored on it loses the whole range). `trackRange` therefore prepends an empty comment when the first node is "unstable": a registered anchor, the first node of a nested mounted range (both in the `unstable` WeakSet) or a repeat row (`itemRegistry`). Checking `nodeType === 8` instead would also mark the `empty` and dead-switch placeholder comments, which need no marker.
- A sole-root structural (`<case><p if></case>`, a template that is only `<div if>`) reaches `trackRange` as the bare anchor, still detached and not yet rendered; it is wrapped in a fragment `[start, anchor]` so the existing detached-anchor microtask placement lands inside the range. Two `first-mount-order` assertions changed accordingly (`<!---->` now precedes the root-level branch) and both now assert the host is empty after `unmount()`.
- Cleanup order is unchanged: `if()` / `switch()` remove the range and then dispose its scope; `unmount()` disposes and then removes. `repeat()` is unchanged — its rows are single elements.

- **In-place array mutation re-runs iterating effects (#26).** `push` on a reactive array goes through the `set` trap twice: once for the new index (a new key, so `ITERATE_KEY` fired — which only `ownKeys` readers track) and once for `length` — but the array exotic object has already bumped `length` when the index was defined, so that second write saw `oldValue === value` and triggered nothing. `Array.from`, `for…of` and `.length` readers track `length` and the existing indices, never the index being added. The trap now also triggers `length` when a new key lands on an array target: a new index IS a length change. `pop`, `shift` and `splice` removals already worked (their `length` write changes the value); `unshift` and `splice` insertions had the same gap as `push` and are covered by the same line. Effects stay batched, so N mutations in one tick are one re-run; the test pins that count.
- Reassignment keeps working and nothing warns on either idiom; `Collection` remains the tool for large lists mutated in place. The hello-world example's `add()` now pushes. Spec wording for §7.1 is proposed in the PR.

## Compiler / parser
- **Literal `${` (#29): syntax is read from the RAW source.** `TemplateParser` keeps the template string and, for each text node and each plain attribute value, takes the raw span (parse5 `sourceCodeLocation`), scans THAT with the shared `scanInterpolations`, and only then entity-decodes each piece. Fast path: a raw span with no `${` is not scanned at all — the parser's own decoded value is used, so a template without interpolation syntax cannot change.
- **Decoding is delegated back to parse5** (`raw-source.ts`), not reimplemented: a text piece is re-parsed with the real parent element as fragment context (so RCDATA `<textarea>` / `<title>`, raw-text `<style>`, legacy entities without `;`, CRLF → LF all match by construction); an attribute piece is re-parsed as an attribute value (`&copy=2` stays literal there). No new dependency.
- **Trust check.** Before the raw span is used, `decode(whole raw span) === parse5's value` must hold; otherwise the decoded value is scanned as before #29 (`scanRaw`). This guards against location quirks rather than assuming there are none. One is known and handled in `rawTextSpan`: for the first text child of `<pre>` / `<textarea>` / `<listing>`, parse5 reports a start offset AFTER the entity when the text begins with one following the dropped leading newline (`<pre>\r\n&amp;x` → span `;x`); the span is taken from the start tag's end, less that one newline.
- **`scanInterpolations` now returns `{ spans, statics, escapes }`.** A backslash run directly before `${` reads by the JS rule (pairs collapse, an odd one escapes); `statics` are already unescaped. `interpolationParts()` lays a scan out as `TextPart[]`; the parser and the generator's hand-built-node fallback share it.
- **`TextInfo.parts`** (new, optional) is what the generator emits from; `content` stays parse5's decoded value (escapes still in place) and is used for whitespace tests and the hint comment only. Hand-built nodes without `parts` behave as before: no `interpolations` → plain text; otherwise `content` is scanned.
- Interpolation locations are unchanged (still the text node's start). The `escaped-interpolation` notice carries the exact line/column of the backslash in text, and the attribute's location in attributes.
- Encoded syntax inside an expression follows the same rule: an encoded quote or `}` in the RAW expression is not seen by the scanner's string/brace tracking (`${a &#125; b}` closes at the real `}`; the body then decodes to `a } b`).
- D-3's `attr.value.includes('${')` is gone; a real raw `${` in a plain attribute is still the error. Binding / structural attribute values are expressions and are never scanned.

## Tooling
- **route-check on Node 22 (#27) — two separate failures, one per loader path.** ESM consumers: tsx's namespaced loader (`tsImport`) appends `?tsx-namespace=<id>` to every URL its `resolve` chain returns, including the `data:` URL the template stub resolves to; in a `data:` URL everything after the comma is module source, so the stub ended in `export default {}\n?tsx-namespace=…` and failed to parse. The hooks module now also exports a `load` hook that serves the stub source for any URL that starts with the stub URL, and the stub source itself ends in a `//` line so an appended tail is a comment either way. The unit test imports the stub with a tail attached in a child node (vitest cannot import a `data:` module through vite-node).
- CommonJS consumers (no `"type": "module"`): with tsx 4.21 under plain Node 22, `tsImport` resolved the routes module's own extensionless imports (`./pages/home`) through the ESM resolver and failed with `ERR_MODULE_NOT_FOUND`. The test spawns the bin through the tsx CLI, whose own loader masked this, which is why the issue reported only the ESM symptom; the compiled bin runs under plain node and hit it. Bisected: 4.21.1 … 4.23.13 fail, 4.23.14 fails with `ERR_UNKNOWN_FILE_EXTENSION`, 4.23.15 passes — so `tsx` moves to `^4.23.15` in `@diamondjs/dev` and the root. The lockfile grows by tsx's nested esbuild 0.28 platform packages; the hoisted esbuild stays on the version tsup and vitest use.
- Also under Node 22 with tsx 4.21, `tsImport` of a CommonJS routes module surfaced `default` = `module.exports` with no named exports beside it (Node 20 listed them), so `mod.routes ?? mod.default` picked the `{ routes }` wrapper and `flatten` read `def.path` of undefined. `pickRouteMap` unwraps that wrapper (and an `__esModule` default) and tells a route literally named `routes` apart by its `path`. tsx 4.23.15 restores the named export, so this is a backstop, kept because it is what the compiled bin sees with any tsx the range admits.
- Verified with the built bin under plain Node 20.18.1 and 22.23.3 on both fixtures, and with the whole suite under both versions.

## Lifecycle contract (Lifecycle Contract design record — six phases, rollback by inventory)
- **Phase 0 recon against `main` @ 82bb8bc.** P-1 (`component.ts:76` set `mounted = true` before `createTemplate()`), P-2 (`core.ts:43` `captureScope` lost its scope on throw), P-3 (`core.ts:298` microtask placement; confirmed with a router scratch test, now #38), P-4 (`component.ts:38` flat `cleanups`; `unmount()` emptied it at 116), P-5 (`router.ts:680` constructed all incoming before anything), P-6 all verified. Divergences from the record's §1: the repo's `examples/` never override `mount()` (only Turbine does, four sites, two `unmount()` overrides); the test environment is happy-dom, not jsdom; and the default vitest run already compiles the runtime tests with TC39 decorators + `[[Define]]` fields (root `tsconfig.base.json` targets ES2022 without `useDefineForClassFields`), while the example tests compile with legacy decorators + `[[Set]]`. The "second tsconfig run" is therefore `vitest.legacy.config.ts` (legacy + `[[Set]]`) over `packages/runtime/tests/lifecycle/`; `npm run test:lifecycle` runs both. Production LOC before: 1,746.
- **Scope (`core.ts`).** `Scope { list, children, scopes, pending, nodes, prev }`; `dispose()` is LIFO, each cleanup in its own `try`, failures returned as `{ index, error }`, every list emptied after. `currentScope` is a `Scope`; `openScope()` records `prev`, `closeScope()` restores it; `withScope()` for callbacks. `captureScope()` keeps its `{ value, cleanup }` shape for the structurals and the tests, adds `scope`, and disposes on throw (P-2). `effect()` now tracks its cleanup (LC-7) — the one defect the new tests found; the structurals' master effects and `bind`/`spread`'s inner effects are created through `reactivityEngine.createEffect` directly so each acquisition is in the inventory once.
- **Placement.** A structural captures `owner = currentScope` when wired. `placeBefore(anchor, nodes, live, scopes, owner)`: anchor in a tree → insert now; else push the placement into `owner.pending` (no microtask — the record's "instead of, not in addition to"), or `queueMicrotask` when there is no owner (hand-written templates, L-37). After every placement `settle()`: anchor in the document → `deliverBranch` each placed scope; else → `owner.scopes.push(...)` so the owner's drain reaches them. Branch and row removal moved INTO the branch/row scope (`scope.add(range.remove)` as the last entry, so LIFO removes first): a disposed branch is a detached one, which is what makes `deliverBranch`'s "the failed branch is gone" one call, and why `if()`/`switch()`/`repeat()` no longer call `remove()` separately.
- **Consequence to know:** a component mounted into a host that is NOT in the document never drains, so a root-level structural does not render there any more (it used to on the next microtask). Tests that did this (`first-mount-order` ×2, `mounted-range` ×2, `switch.test`) now append the host to `document.body`; `switch.test` and the hello-world `taskboard.test` also pinned "nodes stay after the scope is disposed", which is no longer true (the rows/branch leave). Dev builds warn once per class when a root is mounted detached.
- **Drain (`DiamondCore.drain`).** Order: `children` (D8 instances) → `scopes` (branches placed while detached) → `pending` (root-level placements). The record's §5.3 lists children then pending; `scopes` is the extra list the nested case needs (a child inside a branch registers into the BRANCH scope, which the parent's mount scope cannot see without it). `deliverBranch` contains a child's `mounted()` throw (branch disposed, parent stays mounted, L-23/A-7); a direct child's throw propagates through `Component.deliver()` into the parent's rollback.
- **Component.** `lc = DiamondCore.reactive({ phase, generation })` is the snapshot (§5.9, no decorator); `transition()` is the single writer (ring of 32, `Print` per LC-14, `fold()` = last record). `mount()` allows `constructing` as well as `constructed`/`unmounted` (a hand-constructed component's first `mount()` runs `ensureConstructed()` itself — the record's pseudo-code checked the phase before that call). `rollbackMount` is idempotent (`mountScope` null → no-op) because `deliver()`'s catch and `mount()`'s catch both reach it. `unmount()` on a non-mounted instance throws (it used to be a silent no-op). `dispose()` is idempotent and never transitions out of `faulted`. `domPing`: `mounted` ⇔ every range node connected, `mounting` ⇔ not connected, detached phases ⇔ no element and no mount scope. `trackRange` gained `nodes()` for it.
- **Timers (P-4).** `debounce`/`throttle` cancels register in the instance scope (dispose) AND in a `timers` set that `unmount()` runs — so a pending timer is cancelled at unmount as before (the timing tests pin that) and the cancel survives for the remount. `registerCleanup` goes to the mount scope while one is open, else the instance scope.
- **Additions the record did not name, flagged for Joe:** `whileMounted(fn)` (protected) is the generation-bound wrapper LC-9 implies and L-31/A-8 need — nothing else in the runtime had a stale-callback path. `Component.adopt(scope)` (`@internal`) folds the router's construction scope into the instance scope so a constructor that did acquire something is not silently disposed (§3 says constructors acquire nothing; adopting is the forgiving reading). `DiamondCore.inScope()` is how `mount()` knows it is nested (for the detached-root warning).
- **Router.** `construct()` per incoming component: own scope, `adopt`, `ensureConstructed()`; a throw disposes the attempt (P-5). `unmountOutlet(name, occ, final)`: step (b) unmounts (`final = false`) so a rollback can remount the previous occupants — the record's "unmountOutlet calls dispose()" cannot hold during the commit, because a disposed instance is terminal and rollback remounts it; departed occupants are disposed once the commit stands, and `stop()`/rollback dispose outright. The hand-written rollback stays (the record expected ~25 LOC removed; the bookkeeping it does is still needed).
- **A faulted outgoing occupant** cannot be remounted by a rollback (`mount()` throws, `run()` narrates "commit failed … previous route preserved" — but that occupant is gone). A-10 as written ("navigation refused with the faulted instance named; previous route intact") assumed the instance is reused; the router constructs a fresh instance on the return navigation, so A-10 asserts the fault is recorded and named (`cleanup #0 Error: cleanup boom`, one `CRITICAL`) and that the fresh instance mounts.
- **LOC:** 2,027 production (+281 of the +300 ceiling; the record's target was ~170). Where it went: `Scope` + open/close/with + drain/deliverBranch/child/settle (~95 in `core.ts`), the FSM/ring/`transition`/`domPing`/`whileMounted` (~150 in `component.ts`), router `construct` + disposal (~25), the dev counter (+6). Unions and error strings are single-line to stay under the ceiling.
- **Tests:** 64 lifecycle tests in `packages/runtime/tests/lifecycle/` (hooks L-1..L-15, failures L-20..L-28, invariants L-30..L-34 + L-38, router L-26/L-36, scope + L-37, fixtures), green under both configs; L-35 runs in the harness `afterEach`. The harness wraps the prototypes that actually own `addEventListener` in happy-dom (elements, `document`, `window` each have their own; Node's global `EventTarget` sees nothing). The fixtures under `tests/lifecycle/fixtures/` ARE the spec §4.2/§4.4 and README code blocks — `fixtures.test.ts` reads the markdown and fails if they drift. L-34 ran over three in-file components; the `examples/` and Turbine sweeps did not run (Turbine is a separate repo on the published runtime).
- **Acceptance (`tests/acceptance/`, Playwright + Chromium):** a static server (`app/server.mjs`, port 4173, SPA fallback, `/slow` delays 300ms) serves the repo root; `app/index.html` import-maps `@diamondjs/runtime` and `@diamondjs/primafacie` to the built `dist/*.mjs`; `app/app.js` holds one hand-written component per scenario, mirroring Turbine's shapes. A-1..A-10 green (A-6 also as a direct load). **A-9 tolerance:** after a 5-cycle warm-up, 50 cycles of three pages (50 `repeat` rows with a D8 child each, bindings, listeners, an `if`, a debounce, an effect in `mounted()`): DOM nodes 163 → 163, listeners 66 → 66, live page instances (WeakRef census after `HeapProfiler.collectGarbage`) 1, JS heap +5.0% (1,774,596 → 1,863,896 bytes; three isolated reruns all read +5.0%). The assertion allows 20%: a run that overlapped a full `npm run build && npm test` on the same machine failed a 10% bound, and a real leak of the 150 departed pages would be several times the baseline, so the census (`alive ≤ 2`) and the exact node/listener equality are the sharp detectors and the heap bound is the coarse one. Without the warm-up the first measurement sits before the JIT settles and the growth reads +36%, which is not retention. Playwright output dirs are gitignored.
- **Turbine migration** is prepared as a patch (not applied — separate repo on the published runtime): `override mount(host) { super.mount(host); … }` → `override mounted() { … }` (four sites), constructors' `ui.activeTab = …` → `mounting()`, the two `override unmount()` → `unmounting()` with hand-mounted children unmounted when `phase === 'mounted'`. Hand child mounting stays until D8.
