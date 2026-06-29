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
- `captureScope(fn)` → `{ value, cleanup }`: collects all teardown registered during `fn`. Structural directives dispose a removed branch/item with it.
- `DiamondCore.if(anchor, branches)`: first truthy `when()` wins; branches built lazily + cached (toggle reuses subtree). Reactive reads (the `when()`s) happen BEFORE `make()` so the master effect tracks condition deps (the engine nulls activeEffect after a nested effect, so reads must precede builds).
- `DiamondCore.repeat(anchor, itemsGetter, makeItem)`: keyed by **item identity** (default). Reuses/reorders nodes via `insertBefore(node, anchor)` in document order; disposes gone items. Known limit: duplicate primitive items collide on identity (acceptable; most repeats are over objects). `itemsGetter()` read before builds for correct dep tracking.

## Known limitation (pre-existing, not worsened)
Top-level compiled bindings still don't auto-clean on unmount (Phase 0/1 behavior). Structural directives DO clean their branch subtrees (via captureScope), which is stricter than the root. A holistic root-cleanup pass is deferred.

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
