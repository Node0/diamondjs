# DiamondJS Codebase Ground Truth Brief

*Read-only reconnaissance sweep — June 19, 2026*

---

## Reconciliation Summary

The following table cross-checks the six load-bearing claims from the v1.2.5 Input Brief against the current state of `main`.

| Claim | Status | Proof Reference |
|---|---|---|
| **A** All template-driven DOM writes flow through `DiamondCore.bind()` | **PARTIALLY TRUE** | Reactive bindings do. `one-time` compiles to `el[property] = value`, bypassing it entirely — `generator.ts:199-204` |
| **B** `ReactivityEngine.createProxy()` uses `Reflect.set` unconditionally, no `__proto__` guard | **CONFIRMED** | `reactivity.ts:56-63` — set trap has zero property key filtering |
| **C** `UNSAFE_DOM_SINK_PROPERTIES` Set exists in both compiler and runtime | **REFUTED** | Absent from `main`. Exists only on unmerged remote branch `mmtmn-security-block-unsafe-dom-sink-bindings` |
| **D** `${...}` interpolation compiles to `textContent` (not innerHTML) | **CONFIRMED** | `generator.ts:180`: `DiamondCore.bind(${varName}, 'textContent', () => ${templateExpr})` |
| **E** Events compile to `DiamondCore.on(el, event, () => this.fn())` — never a string eval | **CONFIRMED** | `generator.ts:279` — handler is always a closure, verified in compiled dist |
| **F** `bindUnsafe()` / `.unsafe-bind` mechanism from the PR exists in the code | **REFUTED** | Absent from `main`. PR branch unmerged. `core.ts` has no `bindUnsafe()`, `parser.ts` has no `'unsafe-bind'` in commandMap |

---

## Recon 1 — Version & Identity Ground Truth

### npm Package Versions

All five `package.json` files agree:

| Package | `version` field |
|---|---|
| Root monorepo (`diamondjs-monorepo`) | `0.1.0` |
| `@diamondjs/compiler` | `0.1.0` |
| `@diamondjs/runtime` | `0.1.0` |
| `@diamondjs/parcel-transformer-diamond` | `0.1.0` |
| `@diamondjs/hello-world` | `0.1.0` |

**The npm-package version of DiamondJS is `0.1.0`.** This is the authoritative identity.

### Prose Document Version Claims

| File | Version Claimed | Status |
|---|---|---|
| `README.md` | Spec: v1.5.1, Implementation: v1.5.1 | Active, but contains stale sub-sections (see below) |
| `ROADMAP.md` | "architecture specification v1.2 is complete, implementation beginning" | **Stale** — describes a pre-implementation state |
| `FAQ.md` | "We're working toward a v0.1 proof-of-concept. Current status: Architecture complete, implementation beginning." | **Stale** — implementation is running, not beginning |
| `impl_docs/plans/DiamondJS_Architecture_Specification_v1.3.md` | v1.3, dated Dec 25, 2025 | Exists on disk |
| `impl_docs/plans/DiamondJS_Architecture_Specification_v1.5.1.md` | v1.5.1, dated Feb 9, 2026 | Exists on disk |

### Contradictions

1. **Dead link in README.md**: `README.md:229` references `docs/DiamondJS_Architecture_Specification_v1_5_1.md`. There is no `docs/` directory in the repo. The spec files live in `impl_docs/plans/`, not `docs/`.

2. **ROADMAP.md is pre-implementation**: Describes "Key Milestones" for phases that have already completed, with a "Target: v0.1.0 proof-of-concept" that has been reached. The file was last updated before the implementation phase started.

3. **FAQ.md is pre-implementation**: The phrasing "working toward a v0.1 proof-of-concept" and "Architecture complete, implementation beginning" predates the working codebase. The code is running.

4. **Version skip with no changelog**: The spec history in `DiamondJS_Architecture_Specification_v1.5.1.md` jumps from v1.3 (Dec 25) to v1.5 (Feb 9), with no v1.4 documented anywhere. This is noted in the doc itself but unexplained.

---

## Recon 2 — Actual Code Inventory

### Source File Inventory and Line Counts

*Line counts are raw `wc -l` totals (include comments and blank lines). Actual code LOC (cloc) could not be run — see environmental note below.*

**`@diamondjs/runtime`** — 6 source files

| File | Raw Lines |
|---|---|
| `src/component.ts` | 101 |
| `src/core.ts` | 195 |
| `src/decorators.ts` | 72 |
| `src/index.ts` | 31 |
| `src/reactivity.ts` | 189 |
| `src/scheduler.ts` | 48 |
| **Subtotal (src)** | **636** |

**`@diamondjs/compiler`** — 8 source files

| File | Raw Lines |
|---|---|
| `src/compiler.ts` | 196 |
| `src/generator.ts` | 409 |
| `src/index.ts` | 44 |
| `src/parser.ts` | 258 |
| `src/types.ts` | 108 |
| `src/__tests__/compiler.test.ts` | 226 |
| `src/__tests__/generator.test.ts` | 333 |
| `src/__tests__/parser.test.ts` | 257 |
| **Subtotal (src, incl. tests)** | **1,831** |

**`@diamondjs/parcel-transformer-diamond`** — 3 source files

| File | Raw Lines |
|---|---|
| `src/index.ts` | 48 |
| `src/utils.ts` | 61 |
| `src/__tests__/transformer.test.ts` | 140 |
| **Subtotal (src, incl. tests)** | **249** |

### LOC vs Budget

The README's LOC table (runtime: 210, compiler: 410, parcel: 139, total: 759) cannot be independently verified because `cloc` (used by `npm run check-loc`) requires reinstalling `node_modules` with the correct ARM64 native binaries. These numbers are taken at face value.

| Package | README Claims | Budget | Claimed Headroom |
|---|---|---|---|
| `@diamondjs/runtime` | 210 LOC | 2,500 | 2,290 (91.6%) |
| `@diamondjs/compiler` | 410 LOC | 5,000 | 4,590 (91.8%) |
| `parcel-transformer-diamond` | 139 LOC | 300 | 161 (53.7%) |

**All three packages have massive headroom.** The implementation is extremely early relative to the LOC budgets.

### Test Inventory

Test cases were counted by grepping `it(` in all test files (read-only; tests could not be executed — see environmental note).

| Package / File | `it()` Count |
|---|---|
| `@diamondjs/compiler` — `compiler.test.ts` | 20 |
| `@diamondjs/compiler` — `generator.test.ts` | 23 |
| `@diamondjs/compiler` — `parser.test.ts` | 23 |
| **Compiler subtotal** | **66** |
| `@diamondjs/parcel-transformer-diamond` — `transformer.test.ts` | 19 |
| **Parcel plugin subtotal** | **19** |
| `@diamondjs/runtime` — `core.test.ts` | 15 |
| `@diamondjs/runtime` — `component.test.ts` | 10 |
| `@diamondjs/runtime` — `decorators.test.ts` | 11 |
| `@diamondjs/runtime` — `reactivity.test.ts` | 14 |
| `@diamondjs/runtime` — `scheduler.test.ts` | 5 |
| **Runtime subtotal** | **55** |
| **Grand total** | **140** |

**Discrepancy with README**: README claims 134 tests. The grep count yields 140. The 6-test gap is unresolved (tests cannot be executed to confirm).

### Environmental Blocker — Tests Could Not Be Executed

The `node_modules` tree was installed on a previous Intel Mac. The `@rollup/rollup-darwin-arm64` native binary is absent, preventing vitest from starting on the current ARM Mac. Both `npm test` and `bunx vitest run` fail with the same `MODULE_NOT_FOUND` error. `npm install` would fix this but is excluded by the read-only mission constraint. Test pass/fail status is therefore **unknown** for this sweep.

---

## Recon 3 — The Binding Engine (Claims A, C, F)

### Claim A: DiamondCore.bind() as single choke point

**PARTIALLY TRUE** — and the gap is security-relevant.

`DiamondCore.bind()` is the single choke point for **reactive** DOM property writes. The full path for a reactive binding (`value.bind`, `textContent.to-view`, `value.bind` etc.):

`generator.ts:235-239` (two-way) and `generator.ts:211-215` (to-view):
```typescript
DiamondCore.bind(${varName}, '${binding.property}', () => ${expr}, (v) => ${expr} = v);
```

Inside `DiamondCore.bind()` (`core.ts:98-125`), the effect writes `el[property] = value` on every dependency change.

**The gap**: `one-time` bindings do NOT call `DiamondCore.bind()`. The generator emits a direct property assignment at mount time:

`generator.ts:199-204`:
```typescript
case 'one-time':
  // [Diamond] hint
  this.emitLine(`// [Diamond] One-time binding: ${binding.property} ← ${binding.expression}`)
  this.emitLine(`${varName}.${binding.property} = ${expr};`, binding.location)
  break
```

This compiles `innerHTML.one-time="content"` directly to:
```javascript
el.innerHTML = this.content;
```

No choke point. No security check. Even after the PR's security guard is added to `DiamondCore.bind()`, the one-time path would remain unguarded.

### Claim C: UNSAFE_DOM_SINK_PROPERTIES Set in compiler and runtime

**REFUTED.**

The current `compiler.ts` (196 lines) has no such constant. The `compile()` method at `compiler.ts:37-44` calls `this.parser.parse(template)` and `generator.generate(nodes)` with no intervening security validation step whatsoever.

The current `core.ts` (195 lines) has no such constant. `DiamondCore.bind()` at `core.ts:93-125` has no property guard — it accepts any property name without validation.

These structures exist only on the remote branch `origin/mmtmn-security-block-unsafe-dom-sink-bindings`. That branch has not been merged into `main`.

**Current git branch status (read-only)**:
```
* main
  remotes/origin/HEAD -> origin/main
  remotes/origin/main
  remotes/origin/mmtmn-security-block-unsafe-dom-sink-bindings
```

### Claim F: bindUnsafe() / .unsafe-bind exists in code

**REFUTED.**

Confirmed absent in `main`:

- `core.ts`: No `bindUnsafe()` method. No `UNSAFE_DOM_SINK_PROPERTIES` constant.
- `parser.ts:180-190` (`parseBindingCommand()` map): `'unsafe-bind'` key is absent. The map contains only: `bind`, `one-time`, `to-view`, `from-view`, `two-way`, `trigger`, `delegate`, `capture`.
- `types.ts:19-27` (`BindingType` union): `'unsafe-bind'` is absent.
- `parcel-plugin/src/utils.ts:14` (`isDiamondTemplate` regex): Does not include `unsafe-bind` in the pattern.

On `main`, the binding engine has **no security layer of any kind.** Any property can be bound to any data via any binding command without restriction.

### Existing sink set (current state)

There is no sink set. The property name normalization in `parser.ts:28-45` (`PROPERTY_NAME_MAP`) maps lowercase attribute names to camelCase DOM property names:

```typescript
const PROPERTY_NAME_MAP: Record<string, string> = {
  textcontent: 'textContent',
  innerhtml: 'innerHTML',
  innertext: 'innerText',
  classname: 'className',
  // ... (htmlFor, tabIndex, readOnly, maxLength, etc.)
}
```

`innerHTML` is in the map, meaning `innerhtml.bind="content"` is a recognized, compilable, fully-functional binding today. It will compile to `DiamondCore.bind(el, 'innerHTML', ...)` and execute without error.

---

## Recon 4 — Interpolation Codegen (Claim D — CRITICAL)

**Claim D: CONFIRMED.** No innerHTML path exists anywhere in the compiler.

### The codegen path

`generator.ts:154-186` (`generateText()`):

When a text node contains interpolations:
1. A text node is created: `document.createTextNode('')`
2. A template literal is built via `buildInterpolationExpr()` (`generator.ts:317-325`), which replaces `${expr}` with `${this.expr}` in a JS template literal
3. The binding is emitted as:

```typescript
// [Diamond] Text interpolation binding
DiamondCore.bind(${varName}, 'textContent', () => ${templateExpr});
```

**Confirmed target property: `'textContent'`** — `generator.ts:180`.

### Exhaustive search for innerHTML in compiler

No code path in the compiler produces an `innerHTML` write. `innerHTML` appears in `PROPERTY_NAME_MAP` as a recognized property name (so `innerhtml.bind` is parseable), but `generateText()` exclusively targets `textContent` for interpolation. `generateBinding()` can target `innerHTML` only if an explicit `innerhtml.bind` attribute is present in the template — and even then, the property is treated generically with no special innerHTML-aware logic.

*Inference (not directly observed in code)*: A developer writing `<div innerhtml.bind="html">` on `main` would produce `DiamondCore.bind(div, 'innerHTML', () => this.html, (v) => this.html = v)` — a fully functional, unguarded, two-way innerHTML binding with no error or warning. This is a present-state capability, not a future risk.

---

## Recon 5 — The Reactive Proxy (Claim B)

**Claim B: CONFIRMED.**

### The set trap verbatim

`reactivity.ts:56-63`:
```typescript
set: (target, prop, value, receiver) => {
  const oldValue = Reflect.get(target, prop, receiver)
  const result = Reflect.set(target, prop, value, receiver)
  if (oldValue !== value) {
    this.triggerEffects(target, prop)
  }
  return result
}
```

No guard on `prop`. `__proto__`, `constructor`, `prototype`, `__lookupGetter__` — all pass through unconditionally.

### Production confirmation

The minified bundle `hello-world.a6b608ce.js` was read and contains the same logic:
```javascript
set:(e,t,n,r)=>{let c=Reflect.get(e,t,r),l=Reflect.set(e,t,n,r);return c!==n&&this.triggerEffects(e,t),l}
```

The vulnerability is present in the production build artifact.

### Reachability from real code

`DiamondCore.reactive()` is called directly with plain objects in user code. The `hello-world/src/main.ts` observed pattern:

```typescript
// From compiled dist — Greeting component constructor:
this.name = 'World'  // → stored via @reactive decorator
```

The `@reactive` decorator wraps the backing store via `reactivityEngine.createProxy({value: newValue})` (`decorators.ts:22-23`). If the initial value is an object from a deserialized API response, `__proto__` keys would flow through the proxy unchecked.

Direct call path `DiamondCore.reactive(JSON.parse(apiResponse))` is the concrete attack surface. This is a realistic usage pattern, not a contrived one. The brief correctly identified this.

---

## Recon 6 — Template Binding Command Inventory

### Binding commands recognized by the compiler

`parser.ts:179-190` (`parseBindingCommand()`):

| Command | Compiled Behavior | Status |
|---|---|---|
| `bind` | `DiamondCore.bind(el, prop, getter, setter)` — two-way | **IMPLEMENTED** |
| `one-time` | `el[prop] = expr` — direct assignment at mount | **IMPLEMENTED** |
| `to-view` | `DiamondCore.bind(el, prop, getter)` — one-way reactive | **IMPLEMENTED** |
| `from-view` | `DiamondCore.bind(el, prop, getter, setter)` — with setter | **IMPLEMENTED** |
| `two-way` | Same as `bind` | **IMPLEMENTED** |
| `trigger` | `DiamondCore.on(el, event, handler)` | **IMPLEMENTED** |
| `delegate` | `DiamondCore.on(el, event, handler)` — see note below | **IMPLEMENTED** (partial) |
| `capture` | `DiamondCore.on(el, event, handler, true)` | **IMPLEMENTED** |
| `unsafe-bind` | (none on main) | **ABSENT** — PR branch only |
| `if.bind` | (none) | **ABSENT** — noted in README "What's next" |
| `repeat.for` | (none) | **ABSENT** — noted in README "What's next" |
| `with.bind` | (none) | **ABSENT** — in v1.3 spec, not implemented |
| `${...}` interpolation | `DiamondCore.bind(textNode, 'textContent', () => ...)` | **IMPLEMENTED** |

### Specific attribute targets: href, src, action, formaction, style

None of these attributes are in `PROPERTY_NAME_MAP`. They fall through the `||` fallback:

```typescript
const property = PROPERTY_NAME_MAP[rawProperty] || rawProperty
```

For `href`, `action`, `formaction`, `style`, `src` — the property name is the lowercase attribute name, which equals the DOM property name for these attributes. They are bindable today with no restriction:

- `href.bind="userUrl"` → compiles to `DiamondCore.bind(a, 'href', () => this.userUrl, ...)` — functional, unguarded
- `action.bind="endpoint"` → `DiamondCore.bind(form, 'action', () => this.endpoint, ...)` — functional, unguarded
- `style.bind="userStyle"` → `DiamondCore.bind(el, 'style', () => this.userStyle, ...)` — functional, unguarded

These are not blocked, not warned, and not noted anywhere in the compiler.

### Special element handling: iframe, form, script

None. The parser at `parser.ts:88-133` (`processElement()`) applies the same logic to every element regardless of tag name. `<iframe>`, `<form>`, `<script>` are processed identically to `<div>` — no compile-time awareness of their security implications.

---

## Recon 7 — Compiled Output Reality

### Source for this section

`examples/hello-world/dist/hello-world.3f3e1ebf.js` — the readable dev bundle (1,213+ lines). `Counter.diamond.html` was compiled by the Parcel transformer at build time. Its compiled output was observed at lines 1193–1215 of the bundle.

### Actual compiled output for Counter.diamond.html

Input template (`examples/hello-world/src/Counter.diamond.html`):
```html
<div class="counter">
  <button click.trigger="decrement()">-</button>
  <span>${count}</span>
  <button click.trigger="increment()">+</button>
</div>
```

Actual compiled output (from bundle line 1193):
```javascript
// [Diamond] Compiled from: /Users/joehacobian/my-repos/diamondjs/examples/hello-world/src/Counter.diamond.html
// [Diamond] Compiler-generated instance template method
export function createTemplate() {
  const div0 = document.createElement('div');
  div0.className = 'counter';
  const button1 = document.createElement('button');
  // [Diamond] Event binding: click → this.decrement()
  DiamondCore.on(button1, 'click', (e) => this.decrement());
  // ... static text nodes "-" and "+" ...
  const text4 = document.createTextNode('');
  // [Diamond] Text interpolation binding
  DiamondCore.bind(text4, 'textContent', () => `${this.count}`);
  // [Diamond] Event binding: click → this.increment()
  DiamondCore.on(button5, 'click', (e) => this.increment());
  // ... appendChild chains ...
  return div0;
}
```

### [Diamond] hint format

Observed format: `// [Diamond] <description>` as the line immediately preceding the corresponding runtime call.

Observed variants in the codebase:
- `// [Diamond] Compiler-generated instance template method`
- `// [Diamond] Event binding: click → this.decrement()`
- `// [Diamond] Two-way binding: value ↔ this.name`
- `// [Diamond] One-way binding: textContent ← this.message`
- `// [Diamond] Text interpolation binding`
- `// [Diamond] One-time binding: textContent ← title`
- `// [Diamond] From-view binding: value → this.query`
- `// [Diamond] Event delegation: click → this.handleClick()`
- `// [Diamond] Capture event: click → this.onCapture()`
- `// [Diamond] Compiled from: <filepath>`

### Security audit artifacts

None. No `diamond-security-audit.json` is generated by any build step. No stink logging. No audit mechanism of any kind.

---

## Recon 8 — Build Pipeline & Audit Artifact Reality

### Parcel integration

Functional. The Parcel transformer is correctly wired:

`examples/hello-world/.parcelrc`:
```json
{
  "extends": "@parcel/config-default",
  "transformers": {
    "*.diamond.html": ["@diamondjs/parcel-transformer-diamond"]
  }
}
```

The transformer in `parcel-plugin/src/index.ts:16-48` detects Diamond templates via `isDiamondTemplate()`, calls `compileTemplate()`, converts the asset type from `html` to `js`, and sets the compiled code. Source map support is explicitly noted as "Phase 1" work (currently skipped: `compileTemplate(code, filePath, false)`).

The `.parcel-cache/` directory is present, confirming Parcel has been run successfully at least once. The `dist/` contains two bundles (a content-hashed dev bundle and a minified production bundle), both verifiably contain DiamondCore calls.

### Security report or audit artifact

**None exist.** Comprehensive search of the repo found no `diamond-security-audit.json`, no audit sidecar, no build-time security report of any kind. The LOC budget check (`tools/check-loc-budget.ts`) is the only non-standard build-time tool, and it concerns code size, not security.

### Existing logging/telemetry in the runtime

Two `console.error` calls only, both error-handlers:

- `scheduler.ts` (approx. line 22): `console.error('[Diamond] Effect execution error:', error)` — fires if an effect callback throws
- `component.ts` (approx. line 79): `console.error('[Diamond] Cleanup error:', error)` — fires if an unmount cleanup callback throws

There is no dev-mode logging, no structured log events, no telemetry hooks, no `console.warn`, and nothing resembling the stink-logging infrastructure the brief describes as a design goal. The `[Diamond]` prefix used in these error messages is the only use of that prefix outside of compiled hint comments.

---

## Surprises & Divergences

These are observations the design brief did not anticipate, got factually wrong, or could not have known from documents alone.

### 1. The PR is not merged — the entire security layer is absent from main

This is the most significant divergence. The brief's analysis treated the PR as existing in the codebase. It does not. The security branch (`mmtmn-security-block-unsafe-dom-sink-bindings`) exists as a remote branch, unmerged. Claims C and F are both REFUTED as a consequence.

**Practical implication**: Today, on `main`, any property can be bound to any data expression. `innerhtml.bind="userContent"` is a valid, compilable, executable binding that directly sets `el.innerHTML`. No error, no warning, no log.

### 2. One-time bindings are an unguarded path the brief missed entirely

The brief states "all template-driven DOM writes flow through `DiamondCore.bind()`" without qualification. This is false. `one-time` bindings compile to direct property assignments (`el[prop] = value`) that never touch `DiamondCore.bind()`.

**Security implication**: The security guard the PR adds to `DiamondCore.bind()` would not protect against `innerHTML.one-time="content"`. That would compile to `el.innerHTML = this.content` and execute without any framework interception, even after the PR is merged. The brief's proposed defense — a runtime guard in `DiamondCore.bind()` — has a structural gap on the one-time path.

*This is an observation, not a recommendation.*

### 3. The `delegate` binding command does not use `DiamondCore.delegate()`

`generator.ts:250-259` emits `DiamondCore.on()` for both `trigger` and `delegate` binding types. `DiamondCore.delegate()` exists at `core.ts:161-175` with CSS selector-based event delegation logic, but the compiler never emits a call to it. The compiled output for `click.delegate="handler()"` is `DiamondCore.on(el, 'click', handler)` — a plain event listener with no CSS selector filtering, contrary to what the `delegate` command name implies. This is a pre-existing behavioral gap unrelated to the security work.

### 4. The `docs/` directory referenced by README.md does not exist

`README.md:229` links to `docs/DiamondJS_Architecture_Specification_v1_5_1.md`. This path does not exist. The actual spec files are at `impl_docs/plans/DiamondJS_Architecture_Specification_v1.3.md` and `impl_docs/plans/DiamondJS_Architecture_Specification_v1.5.1.md`. The README has a broken spec link.

### 5. ROADMAP.md and FAQ.md are pre-implementation artifacts

Both files describe a state that no longer reflects reality. ROADMAP.md describes future milestones that have been completed. FAQ.md says "working toward a v0.1 proof-of-concept" with "implementation beginning" — the implementation is running with a compiled hello-world example in `dist/`. These files have not been updated since the implementation phase started.

### 6. The test count disagrees with the README

The README claims 134 total tests. Source-file grep yields 140 (`it()` calls: 66 compiler + 19 parcel + 55 runtime). The 6-test gap is unresolved because tests cannot be executed on this machine. It may indicate the README's count was recorded at a point when the runtime had 49 tests (as claimed) rather than the 55 counted by grep.

### 7. The prototype pollution vulnerability is confirmed live in the production minified bundle

The minified production bundle `hello-world.a6b608ce.js` was read and contains the proxy `set` trap verbatim:
```javascript
set:(e,t,n,r)=>{let c=Reflect.get(e,t,r),l=Reflect.set(e,t,n,r);return c!==n&&this.triggerEffects(e,t),l}
```
The vulnerability described in the brief exists not just in source but in the shipped build artifact.

### 8. The `outerhtml` property mapping is absent from PROPERTY_NAME_MAP

`PROPERTY_NAME_MAP` contains `innerhtml: 'innerHTML'` but not `outerhtml`. This means `outerhtml.bind="x"` would be parsed with property name `outerhtml` (lowercase, unmapped), which would compile to `el['outerhtml'] = value` — a no-op (DOM property is `outerHTML`, not `outerhtml`). The PR's proposed block of `outerhtml` in `UNSAFE_DOM_SINK_PROPERTIES` uses case-insensitive `.toLowerCase()` and would catch this, but currently the property is both "safe" by accident and broken — it silently fails to set the outer HTML.

### 9. The parcel transformer strips source maps in production

`parcel-plugin/src/utils.ts:34`: `compiler.compile(code, { filePath, sourceMap })` — but `parcel-plugin/src/index.ts:34` calls `compileTemplate(code, filePath, false)`, explicitly disabling source maps. The comment says "Source map support requires @parcel/source-map integration — this will be added in Phase 1." Errors from compiled templates currently point to the generated JS, not the `.diamond.html` source.

---

*End of Ground Truth Brief. All findings above are based on direct file reads of repository state at time of sweep. Code is quoted with file paths and line numbers. Inferences are marked as inferences. No changes were made to any file.*
