# DiamondJS Implementation Project Log

This is an append-only log tracking implementation progress.

---

## 2026-02-04 - Session Start

### Initial Assessment

**Status**: Greenfield project - architecture specification complete, no implementation code exists yet.

**Architecture Document**: `DiamondJS_Architecture_Specification_v1.3.md` (v1.3)

**Key Architectural Decisions (Locked)**:
- Pure OOP patterns throughout (classes with methods, not standalone functions)
- Hybrid reactivity system (Proxy + Collection class)
- Build-time only compiler (zero runtime parsing)
- Parcel-first strategy for v1.0
- 4-hook lifecycle (constructor/mount/update/unmount)
- Runtime LOC budget: < 2,500 lines
- Compiler LOC budget: < 5,000 lines
- LLM comprehension target: 32B models achieve >80% bug fix rate

**Implementation Phases from Spec**:
- Phase 0: Proof of Concept (One component, end-to-end compilation)
- Phase 1: Core Binding System
- Phase 2: Component System
- Phase 3: Template Controllers
- Phase 4: Hybrid Reactivity System
- Phase 5: Advanced Features
- Phase 6: DX Polish
- Phase 7: Community

### Current Activity

Initiating agent discussion to plan Phase 0 implementation approach.

---

## 2026-02-04 10:30 - Agent Research Complete

### Summary of Agent Findings

Three specialized agents completed parallel research on different aspects of Phase 0 implementation:

#### 1. Parcel Plugin Agent (parcel-plugin-dev)

**Key Recommendations:**
- Use monorepo with pnpm workspaces
- Create two Parcel packages:
  - `parcel-transformer-diamond` (~100-150 LOC) - Compiles .html templates to JS
  - `parcel-resolver-diamond` (~50-100 LOC) - Handles `diamond:manifest` virtual import
- Content detection strategy: Check for binding syntax (`.bind`, `.trigger`) to identify Diamond templates
- HMR via `module.hot.accept()` with DiamondHMR registry for state preservation
- Use `@parcel/source-map` for native Parcel integration
- Use `ThrowableDiagnostic` for rich error messages with code frames

**Critical APIs:**
- `MutableAsset.setCode()`, `setMap()`, `addDependency()` for transformer
- `Resolver.resolve()` with `filePath` + `code` return for virtual modules

#### 2. Compiler Agent (compiler-dev)

**Key Recommendations:**
- Use parse5 with `sourceCodeLocationInfo: true` for HTML parsing
- Two-pass architecture: Parse → Transform → Generate
- String-based code generation for Phase 0 (simpler, within LOC budget)
- Use `@parcel/source-map` for source map generation
- String-based regex injection for `createTemplate()` method (migrate to TS AST in Phase 1+)

**Phase 0 Scope:**
- Transform `value.bind="x"` → `DiamondCore.bind(el, 'value', () => vm.x, (v) => vm.x = v)`
- Transform `click.trigger="fn()"` → `DiamondCore.on(el, 'click', () => vm.fn())`
- Basic `${...}` interpolation
- Source maps pointing to original HTML

#### 3. Architecture Constraint Agent (arch-constraint-monitor)

**Key Recommendations:**
- **Package Manager**: pnpm with workspaces (disk efficiency, strict dependencies)
- **Package Names**: `@diamondjs/runtime`, `@diamondjs/compiler`, `@diamondjs/parcel-plugin`
- **Build Tool**: tsup (zero-config, esbuild-powered, fast)
- **Test Framework**: Vitest (native TS, Vite-powered)
- **LOC Tracking**: cloc with automated budget checker script
- **TypeScript**: Project references for incremental compilation

**Proposed Structure:**
```
diamondjs/
├── packages/
│   ├── runtime/         # @diamondjs/runtime (~2,500 LOC budget)
│   ├── compiler/        # @diamondjs/compiler (~5,000 LOC budget)
│   └── parcel-plugin/   # @diamondjs/parcel-plugin (~200 LOC budget)
├── examples/
│   └── hello-world/
├── tools/
│   └── check-loc-budget.ts
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Consensus Decisions

All agents agreed on:
1. **pnpm workspaces** for monorepo management
2. **parse5** for HTML parsing with location tracking
3. **@parcel/source-map** for source map generation
4. **tsup** for package building
5. **Vitest** for testing
6. **String-based approach** for Phase 0 (simpler, faster to implement)

### User Decisions

1. **Package Naming**: `@diamondjs/*` scoped packages (professional, prevents conflicts)
2. **Setup Scope**: Full monorepo structure (ready for long-term development)
3. **Test Coverage**: High coverage (80%+) with CI enforcement

---

## 2026-02-04 11:00 - Beginning Phase 0 Implementation

### Implementation Plan

**Task 1: Monorepo Infrastructure**
- Initialize pnpm workspace
- Create package directory structure
- Configure TypeScript with project references
- Set up tsup for building
- Set up Vitest with coverage requirements
- Create LOC budget checker script
- Configure ESLint and Prettier

**Task 2: Runtime Package (@diamondjs/runtime)**
- Implement DiamondCore class with reactive(), effect(), bind(), on()
- Implement Component base class with createTemplate() pattern
- Implement scheduler for batched updates
- Unit tests with 80%+ coverage

**Task 3: Compiler Package (@diamondjs/compiler)**
- Implement TemplateParser (parse5 wrapper)
- Implement BindingExtractor
- Implement CodeGenerator with source maps
- Implement class injection for createTemplate()
- Unit tests with 80%+ coverage

**Task 4: Parcel Plugin Package (@diamondjs/parcel-plugin)**
- Implement transformer for .html templates
- Implement resolver for diamond:manifest (if needed for Phase 0)
- Integration tests

**Task 5: Hello World Example**
- Create example app with single component
- Verify end-to-end compilation
- Verify HMR works
- Verify source maps point to original HTML

---

## 2026-02-04 11:45 - Task 1 Complete: Monorepo Infrastructure

### Completed Setup

**Package Manager**: npm workspaces (switched from pnpm due to corepack issues)

**Created Files:**
- `package.json` - Root workspace config with scripts
- `tsconfig.base.json` - Shared TypeScript configuration (ES2022 target)
- `vitest.config.ts` - Test config with 80% coverage threshold
- `eslint.config.js` - ESLint with complexity rules
- `.prettierrc` - Prettier config
- `tools/check-loc-budget.ts` - LOC budget enforcement script

**Package Structure:**
```
packages/
├── runtime/        @diamondjs/runtime   (0% of 2,500 LOC budget used)
├── compiler/       @diamondjs/compiler  (0% of 5,000 LOC budget used)
└── parcel-plugin/  @diamondjs/parcel-plugin (2% of 300 LOC budget used)
```

**Verified:**
- `npm run build` - All packages build successfully
- `npm run check-loc` - LOC checker working correctly

### Current LOC Status
```
Runtime:      1 / 2,500 LOC  (0.0%)
Compiler:     1 / 5,000 LOC  (0.0%)
Parcel Plugin: 6 / 300 LOC   (2.0%)
Total:        8 / 7,800 LOC  (0.1%)
```

---

## 2026-02-04 12:45 - Task 2 Complete: @diamondjs/runtime Core

### Implemented Files

| File | LOC | Description |
|------|-----|-------------|
| `scheduler.ts` | ~45 | Microtask batching for effect execution |
| `reactivity.ts` | ~95 | ReactivityEngine with Proxy-based tracking |
| `core.ts` | ~95 | DiamondCore class with static API methods |
| `component.ts` | ~75 | Component base class with template factory pattern |
| `index.ts` | ~15 | Public exports |

### API Surface

**DiamondCore (static methods)**:
- `reactive(obj)` - Create reactive proxy for state
- `effect(fn)` - Track dependencies, re-run on change
- `computed(getter)` - Cached computed value
- `bind(el, prop, getter, setter?)` - One/two-way DOM binding
- `on(el, event, handler, capture?)` - Event listener
- `delegate(parent, event, selector, handler)` - Event delegation

**Component (abstract class)**:
- `static createTemplate()` - Compiler-generated template factory
- `static getTemplateFactory()` - Cached factory access
- `mount(hostElement)` - Mount to DOM
- `update(newProps)` - Update props
- `unmount()` - Remove and cleanup

### Test Coverage

| File | Statements | Branches | Functions | Lines |
|------|------------|----------|-----------|-------|
| **Overall** | **94.77%** | **94.52%** | **91.42%** | **94.77%** |
| scheduler.ts | 100% | 100% | 100% | 100% |
| reactivity.ts | 100% | 100% | 100% | 100% |
| core.ts | 94.8% | 90.47% | 90% | 94.8% |
| component.ts | 81.39% | 90.9% | 88.88% | 81.39% |

All 39 tests passing.

### LOC Status After Task 2
```
Runtime:      255 / 2,500 LOC  (10.2%)  [+247 LOC from stubs]
Compiler:       1 / 5,000 LOC  (0.0%)
Parcel Plugin:  6 / 300 LOC    (2.0%)
Total:        262 / 7,800 LOC  (3.4%)
```

---

## 2026-02-04 20:50 - Task 3 Complete: @diamondjs/compiler

### Implemented Files

| File | Description |
|------|-------------|
| `types.ts` | Type definitions for compiler (SourceLocation, BindingType, BindingInfo, etc.) |
| `parser.ts` | TemplateParser using parse5 with source location tracking |
| `generator.ts` | CodeGenerator that emits `static createTemplate()` method code |
| `compiler.ts` | Main DiamondCompiler class with compile() and compileAndInject() |
| `index.ts` | Public exports |

### Parser Features

- Uses parse5 with `sourceCodeLocationInfo: true`
- Extracts bindings from `property.command="expression"` syntax
- Supports all binding types: bind, one-time, to-view, from-view, two-way
- Supports event bindings: trigger, delegate, capture
- Extracts `${...}` interpolations from text nodes
- Maps lowercase HTML attributes to camelCase DOM properties

### Generator Features

- Generates `static createTemplate()` method
- Handles single and multiple root elements (uses DocumentFragment)
- Generates code for:
  - Element creation with `document.createElement()`
  - Static attributes
  - Property bindings with `DiamondCore.bind()`
  - Event handlers with `DiamondCore.on()`
  - Text interpolations
- Proper `vm.` prefixing for expressions
- Source map generation

### Compiler Features

- `compile(template, options)` - Compile template to code
- `compileAndInject(template, source, options)` - Inject into existing class
- Automatic DiamondCore import injection
- Class name detection from source

### Test Coverage

| File | Statements | Branches | Functions | Lines |
|------|------------|----------|-----------|-------|
| **Overall** | **97.26%** | **92.06%** | **97.43%** | **97.26%** |
| compiler.ts | 93.39% | 89.28% | 100% | 93.39% |
| generator.ts | 97.52% | 96.82% | 100% | 97.52% |
| parser.ts | 100% | 87.5% | 100% | 100% |
| types.ts | 100% | 100% | 100% | 100% |

All 64 tests passing (parser: 23, generator: 22, compiler: 19).

### LOC Status After Task 3
```
Runtime:      256 / 2,500 LOC  (10.2%)
Compiler:   1,268 / 5,000 LOC  (25.4%)
Parcel Plugin:  6 / 300 LOC    (2.0%)
Total:      1,530 / 7,800 LOC  (19.6%)
```

---

## 2026-02-04 20:53 - Task 4 Complete: @diamondjs/parcel-plugin

### Implemented Files

| File | Description |
|------|-------------|
| `index.ts` | Parcel 2 Transformer for DiamondJS templates |
| `utils.ts` | Utility functions (isDiamondTemplate, compileTemplate) |

### Transformer Features

- Auto-detects DiamondJS templates by checking for binding syntax
- Compiles templates to JavaScript modules
- Generates source maps for debugging
- Exports utilities for external use

### Template Detection

Detects templates containing:
- Binding syntax: `.bind`, `.one-time`, `.to-view`, `.from-view`, `.two-way`
- Event syntax: `.trigger`, `.delegate`, `.capture`
- Interpolation syntax: `${...}`

Plain HTML files pass through unchanged.

### Test Coverage

| File | Statements | Branches | Functions | Lines |
|------|------------|----------|-----------|-------|
| utils.ts | 100% | 100% | 100% | 100% |

Note: Transformer entry point excluded from coverage (tested via integration).
17 tests passing.

### LOC Status After Task 4
```
Runtime:      256 / 2,500 LOC  (10.2%)
Compiler:   1,268 / 5,000 LOC  (25.4%)
Parcel Plugin: 139 / 300 LOC   (46.3%)
Total:      1,663 / 7,800 LOC  (21.3%)
```

---

## 2026-02-04 20:59 - Task 5 Complete: Hello World Example

### End-to-End Pipeline Verified

Successfully created and tested a complete DiamondJS example demonstrating:

1. **Template Compilation**: `.diamond.html` files are compiled by the Parcel transformer
2. **Runtime Reactivity**: Proxy-based reactivity system working
3. **Two-way Binding**: Input bindings update state and UI
4. **Event Handling**: Click events trigger component methods
5. **Component Mounting**: Components mount to DOM correctly

### Example Structure

```
examples/hello-world/
├── src/
│   ├── index.html          # Entry point
│   ├── main.ts             # Application code
│   └── Counter.diamond.html # DiamondJS template
├── .parcelrc               # Parcel transformer config
└── package.json
```

### Components Demonstrated

1. **Counter** (using compiled template)
   - Increment/decrement buttons
   - Reactive count display
   - Template compiled from `.diamond.html`

2. **Greeting** (manual template)
   - Two-way input binding
   - Text interpolation

### Build Output

```
dist/index.html           968 B
dist/hello-world.js     4.31 kB
```

Bundle size is ~4KB, demonstrating the minimal footprint goal.

---

## Phase 0 Complete: Summary

### What Was Built

| Package | LOC | Budget | Tests | Coverage |
|---------|-----|--------|-------|----------|
| @diamondjs/runtime | 256 | 2,500 | 39 | 94.77% |
| @diamondjs/compiler | 1,268 | 5,000 | 64 | 97.26% |
| @diamondjs/parcel-transformer-diamond | 139 | 300 | 17 | 100%* |
| **Total** | **1,663** | **7,800** | **120** | **>80%** |

*Coverage on utils.ts; transformer entry point tested via integration.

### Architecture Compliance

- ✅ Pure OOP patterns (classes with methods, no standalone functions)
- ✅ Proxy-based reactivity system
- ✅ Build-time template compilation (zero runtime parsing)
- ✅ Parcel-first build strategy
- ✅ All LOC budgets within limits (21.3% of total budget used)
- ✅ 80%+ test coverage achieved

### Key Decisions

1. **npm workspaces** instead of pnpm (corepack compatibility)
2. **happy-dom** instead of jsdom (ESM compatibility)
3. **Package renamed** to `@diamondjs/parcel-transformer-diamond` (Parcel naming convention)
4. **Source maps deferred** to Phase 1 (requires @parcel/source-map integration)

### Ready for Phase 1

Phase 0 proof-of-concept is complete. The foundation is solid for:
- Phase 1: Expanded binding system
- Phase 2: Full component system
- Phase 3: Template controllers (if/repeat/etc.)

---

## 2026-02-16 - v1.3 → v1.5.1 Architectural Upgrade Complete

### Upgrade Overview

Implemented the v1.5.1 architectural pivot across all three packages and the example app. This upgrade improves LLM comprehension by switching from a static factory pattern to instance methods with `this` references, adding `@reactive` decorators for explicit reactivity, and emitting `[Diamond]` hint comments in all compiler output.

### Changes by Package

#### @diamondjs/runtime

| File | Change |
|------|--------|
| `reactivity.ts` | Added `proxyCache` WeakMap for referential identity on deep reactivity; removed broken `isProxy()` method |
| `component.ts` | Complete rewrite: removed static factory pattern (`TemplateFactory<T>`, `_templateFactory`, `getTemplateFactory()`, static `createTemplate()`); added instance `createTemplate()` method that uses `this` |
| `core.ts` | Added `makeReactive()` static method for compiler-generated constructor code; fixed JSDoc examples from `vm.` to `this.` |
| `scheduler.ts` | Changed error prefix from `[DiamondJS]` to `[Diamond]` |
| `decorators.ts` | **NEW** — TC39 Stage 3 `@reactive` property decorator with legacy TypeScript fallback |
| `index.ts` | Added `reactive` export from `./decorators` |

#### @diamondjs/compiler

| File | Change |
|------|--------|
| `generator.ts` | Complete rewrite: generates instance `createTemplate()` (not static); `prefixExpression()` emits `this.` instead of `vm.`; emits `[Diamond]` hint comments before every binding/event |
| `compiler.ts` | Updated docstring to reference instance methods and `this` |
| `index.ts` | Updated docstring example to show instance method with `this.` and `[Diamond]` hints |

#### @diamondjs/parcel-plugin

| File | Change |
|------|--------|
| `utils.ts` | Updated `compileTemplate()` to handle new instance method output format; strips `[Diamond]` hint from method body, places it before `export` keyword |

#### examples/hello-world

| File | Change |
|------|--------|
| `main.ts` | Updated to v1.5.1 patterns: `@reactive` decorator, instance `createTemplate()`, `this.` references, removed static factory usage |

### Test Files Modified/Created

| File | Change |
|------|--------|
| `runtime/tests/reactivity.test.ts` | Added 5 proxy cache tests (referential identity, deep proxy identity, same-value no-trigger) |
| `runtime/tests/component.test.ts` | Complete rewrite for instance `createTemplate()` pattern |
| `runtime/tests/decorators.test.ts` | **NEW** — 5 tests for reactive decorator and `makeReactive` |
| `compiler/src/__tests__/generator.test.ts` | Complete rewrite: `vm.` → `this.`, static → instance, added `[Diamond]` hint assertions |
| `compiler/src/__tests__/compiler.test.ts` | Complete rewrite: same changes as generator tests |
| `parcel-plugin/src/__tests__/transformer.test.ts` | Updated assertions for `this.` and `[Diamond]` hints |

### Test Results

**134 tests passing** (49 runtime + 66 compiler + 19 parcel plugin)

| Package | Coverage |
|---------|----------|
| @diamondjs/runtime | 93.82% |
| @diamondjs/compiler | 96.80% |

### LOC Status After v1.5.1 Upgrade

```
Runtime:      210 / 2,500 LOC  (8.4%)
Compiler:     410 / 5,000 LOC  (8.2%)
```

All architectural constraints pass.

### Validation Results

- **Arch-constraint-monitor**: All KLOC budgets within limits, no constraint violations
- **LLM-comprehension-validator**: Grade A, 92% estimated bug-fix success rate for 32B models, zero autoregressive steering issues

### Key Technical Details

1. **Proxy cache**: `WeakMap<object, object>` in `ReactivityEngine` ensures `this.user.profile === this.user.profile` (referential identity for deep reactive objects)
2. **`@reactive` decorator**: Minimal runtime footprint — compiler transforms `@reactive` into `DiamondCore.makeReactive()` calls in constructor
3. **`[Diamond]` hint comments**: Semantic comments emitted before every binding, event, and interpolation to guide LLM comprehension of compiled output
4. **Instance `createTemplate()`**: Methods use `this` directly instead of receiving a `vm` parameter, reducing cognitive overhead for LLMs

### Errors Encountered and Resolved

1. **Parcel plugin tests failed (stale compiler dist)**: Plugin imports from built `dist/` of compiler — must `npm run build` in `packages/compiler` before parcel-plugin tests reflect source changes
2. **Parcel plugin regex issue**: Initial regex for stripping `[Diamond]` hint comment produced `export // [Diamond]...` on one line; fixed by separating hint stripping from function declaration transformation

---

## 2026-02-16 - Fix hello-world Parcel Build & Make @reactive Reactive at Runtime

### Problem

The hello-world example failed to build with Parcel because SWC couldn't parse the `@reactive` decorator syntax — no tsconfig with `experimentalDecorators` existed for Parcel to read. Additionally, the `@reactive` legacy decorator path was a no-op marker, meaning even if parsing worked, button clicks and input changes wouldn't update the DOM at runtime.

### Changes

#### @diamondjs/runtime — `packages/runtime/src/decorators.ts`

| Change | Detail |
|--------|--------|
| Added `reactivityEngine` import | `import { reactivityEngine } from './reactivity'` (no circular dependency) |
| Legacy decorator now defines reactive getter/setter | Uses `Object.defineProperty` on prototype with per-instance backing store via `reactivityEngine.createProxy({ value })` keyed by Symbol |

How the legacy path works:
- Decorator runs at class definition time, defines getter/setter on the prototype
- With `experimentalDecorators`, field initializer `count = 0` becomes `this.count = 0` (assignment), which calls the setter
- Setter creates a `reactivityEngine.createProxy({ value: 0 })` backing store per-instance
- Getter reads from the proxy → tracked by reactivity engine
- Setter writes to the proxy → triggers effects

TC39 Stage 3 path unchanged (compiler hint only — TC39 field decorators can't define getter/setter without `accessor` keyword).

#### New files

| File | Description |
|------|-------------|
| `examples/hello-world/tsconfig.json` | Extends `tsconfig.base.json`, enables `experimentalDecorators` for per-example TypeScript tooling |
| `tsconfig.json` (monorepo root) | Extends `tsconfig.base.json`, enables `experimentalDecorators` — required because Parcel resolves tsconfig from project root (lockfile/`.git` location), not from the source file directory |

#### Tests — `packages/runtime/tests/decorators.test.ts`

Added 6 new tests for legacy decorator behavior:
- Defines reactive getter/setter on prototype
- Stores and retrieves initial values
- Returns `undefined` before first assignment
- Triggers effects when property changes
- Supports multiple reactive properties on same prototype
- Isolates reactivity between instances

### Errors Encountered and Resolved

1. **Parcel ignores per-directory tsconfig.json**: Parcel 2 resolves `tsconfig.json` from the `projectRoot` (determined by `.git`/lockfile walk), not from the source file's directory. The `examples/hello-world/tsconfig.json` alone was insufficient — a root-level `tsconfig.json` was also needed for Parcel's SWC transformer to enable decorator parsing.

### Test Results

**169 tests passing** (55 runtime + 66 compiler + 19 parcel plugin + 29 hello-world)

### Build Verification

- `npm run build` — all packages build successfully
- `npm test` — all 169 tests pass
- Parcel build (`examples/hello-world`): `dist/index.html` (968 B) + `dist/hello-world.a6b608ce.js` (5.16 kB) — built in 977ms

---

## 2026-06-29 — v1.5.1 → v2.0 Migration Complete

Implemented the full v2.0 architecture from `DiamondJS_v2.0_Design_Decision_Record.md` (+ Amendment A1) across five checkpointed phases. v2.0 is a **breaking MAJOR** change: a security-by-default binding language with audited `raw` escape hatches, LLM-legible token renames, removals of footgun constructs, and a converter `format`/`parse` system. Versions bumped to **2.0.0** across all packages (cross-deps at `^2.0.0`; DiamondJS as the SemVer canary, §9.3).

### Phase 1 — Token renames + security spine (§3, §4.1, §6.4–6.6)
- `unsafe`→`raw`; `.one-time`→`set`/`rawSet`; `.trigger`→`.calls`; `.delegate` removed (+ deleted orphaned `DiamondCore.delegate()`); `.capture` kept. Retired tokens emit actionable compile errors (no silent `|| 'bind'` fallback).
- **Safe-sink allowlist** (`compiler/src/security.ts`) + pure `gateSink()` at the single codegen choke point (closes the one-time bypass + `outerHTML` no-op). Three-segment raw grammar (`innerHTML.rawBind.to-view`).
- **Two-tier stink gate** (`tools/stink-check.ts` + `stink-baseline.json`): `stink:warn` hard-gates; `stink:declared` is baselined + diffed (never blocked).

### Phase 2 — Structural directives (§6.1–6.3 + A1)
- Bare `if` / `else-if` → `DiamondCore.if` (reactive include/remove, branch caching); `repeat.for` → `DiamondCore.repeat` (keyed by item identity, per-node `.calls`). `with` removed; bare `else`/`if.bind`/`if.set`/`rawIf` rejected. Token-aware expression prefixer + loop-var scoping. `captureScope` cleanup for removed subtrees.

### Phase 3 — Template formatting/parsing (§5)
- Pipe `|` (depth/string-aware splitter) → function composition; PascalCase = converter `.format`/`.parse`, camelCase = direct call. `ParseResult<T>` (runtime). §5.6 contextual enforcement **in the compiler** (`compileAndInject` follows the import relative to `filePath`, reads the module, checks `static parse` → hard error). New **`@diamondjs/converters`** package (Currency/Date/Phone). Runtime inbound smell check (distinct dev-only channel). **from-view security fix**: from-view is one-way (no getter), removed from the outbound gate.

### Phase 4 — Binding/handler timing (§4.3)
- `value.update-on="blur"` (property-scoped; 5th `bind()` arg); self-registering `this.debounce`/`this.throttle` (leak-safe); `&` removed (hard error redirecting to a view-model getter / `update-on` / `debounce` / reactive dep).

### Phase 5 — Versioning, example, docs
- All packages → 2.0.0. `examples/hello-world` rewritten end-to-end (Tasks compiled template: `set`/`rawSet`/two-way/`.calls`/`if`/`else-if`/`repeat.for`/interpolation; MoneyForm: converter pipe + `ParseResult` + `update-on` + `debounce`). README + this log updated.

### Final state
```
Runtime:    483 / 2,500 LOC    75 tests
Compiler: 2,719 / 5,000 LOC   144 tests
Converters:  84 / 500 LOC      11 tests
Parcel:     213 / 300 LOC      24 tests
Example:                       15 tests
Total:    3,499 / 7,800 LOC   269 tests
```
All LOC budgets within limits · stink gate green (1 declared raw: the example's audited `rawSet`) · example builds via Parcel. Deferred to v2.1: attribute spread, `switch`/`case`/`default`, Collection-at-scale, data-delegation.

---

## 2026-07-07 — v2.0 → v2.1 Complete

Implemented the full v2.1 scope from `deferred_work_for_v2.1.md` (DDR §7/§11 + Amendment A1 backlog + all four architectural advisories + ALL working_notes §3 implementation-discovery deferrals) across seven checkpointed phases on `v2.1-implementation`. Every spec-silent design decision was surfaced, user-ratified, and recorded in **`impl_docs/plans/DiamondJS_v2.1_Amendment_A2_Design_Record.md`** — the spec remains authoritative. All packages bumped to **2.1.0**.

### Phase 0 — Hygiene & foundations
- `nextVar` → `el_<tag>_<n>` (kills the `h2`+`1` → `h21` fake-heading collision); ~26 test assertions swept
- `generateNodes` refactor: `collectIfChain` + `generateStructural` extracted (depth 5/CC 12 → ≤3/≤6) ahead of switch landing in the same loop
- Brace-depth interpolation scanner (`scanInterpolations`) replaces the regex; `${x | Conv('}')}` compiles; new `unterminated-interpolation` error
- Multi-line `DiamondCore.bind()` for block-body setters — the `if (r.valid)` gate is visually prominent
- `Component.mount` wraps `createTemplate` in `captureScope`: root cleanups now dispose on unmount (§3.3 closed)

### Phase 1 — Security spine + primafacie
- `SAFE_SINKS` + `PROPERTY_NAME_MAP` canonical home → `@diamondjs/runtime` (compiler re-exports; new acyclic package dep); `canonicalizeSinkKey` / `isDataOrAriaKey`
- `data-*`/`aria-*` pass BOTH gates via the attribute branch; inbound ops on dashed names → `attr-binding-outbound-only`
- New **`@diamondjs/primafacie`**: the stargate `Print(logType, message)` paradigm (15 types, symbol pairs, caller extraction; isomorphic ANSI/`%c`; `addSink`/`wsSink`/`fileSink`); wired into stink-check/check-loc summaries, transformer diagnostics, and (format-only, dependency-free `devWarn`) runtime dev warnings

### Phase 2 — Attribute spread (§7.1)
- `...attrs.bind` / `...attrs.rawBind`; `DiamondCore.spread` gates FIRST (canonicalize → allowlist ∪ data-/aria-; fail closed, dev warn-once), branches SECOND (property vs setAttribute); key-removal reconciliation; `rawBind` bypass emits a heavy auto-baselined `stink:declared`
- Reactivity gains `ownKeys`/`deleteProperty` traps + `ITERATE_KEY` (shape changes retrigger)

### Phase 3 — switch/case/default (A1 backlog closed)
- Parser `processSwitch` (10 diagnostics); ratified case semantics (bare word = string equality; dotted/operators = expression); full container erasure
- `DiamondCore.switch` (on-value evaluated ONCE per update, first match wins, branch cache mirrors `if()`); Option A static fast path (pure-literal `on=` + all-equality → winning branch only, zero runtime)
- Dead static switch → `switch-static-dead` **warning** + inspectable DOM comment (ratified; not a build blocker)
- Detection tokens `<switch` + `repeat.for=` added (bare `if=` deliberately excluded)

### Phase 4 — Collection (2.1a) + delegation (2.1b)
- `Collection<T>`: never-proxied items (identity preserved → repeat-compatible), one version signal through the existing engine, O(1) `push`, O(1) `byKey`, cached `sortBy` views, `binarySearch`, batch `mutate`, `notify()`; 10k pushes → one flush (verified)
- `DiamondCore.delegate`: one container listener + `closest()` + repeat's WeakMap node→item registry; handler receives the DATA ITEM uniformly for arrays and Collections; runtime-API-only

### Phase 5 — Pipes & inbound channel
- Multi-segment two-way inversion: all-converter chains legal; format L→R, parse R→L fail-fast (`rN…r0`); obligation per segment; `pipe-two-way-multi` retired
- `error-into` (ratified grammar): `value.error-into="amountError"` → `target = r.valid ? null : r.error` (chains: first failure wins); 5 diagnostics
- Inbound smell check widened (best-effort, ratified): + ISO-date and canonical-phone corruption heuristics

### Phase 6 — Compiler infrastructure
- Real VLQ source maps (hand-rolled encoder, ~70 LOC; Phase-0 stub closed; snippet-relative caveat documented)
- §5.6 re-export following: named (+`as`) and star barrels, 3-hop cap, cycle guard; barrel-resolved missing parse HARDENS to error
- `<!-- @import { X } from './mod' -->` provenance (ratified grammar): standalone templates can use pipe heads; only uncovered heads error; obligations verified via new public `verifyObligations()`

### Phase 7 — Versions, example, docs
- All packages → 2.1.0; hello-world gains `<switch>`/spread in Tasks.diamond.html + a TaskBoard (Collection + delegate) component; README updated; Amendment A2 recorded

### Final state
```
Runtime:      863 / 2,500 LOC   119 tests
Compiler:   4,144 / 5,000 LOC   218 tests
Parcel:       300 /   300 LOC    30 tests   ← AT the §2.2 ceiling (deliberate-increase decision now due)
Converters:    84 /   500 LOC    11 tests
Primafacie:   262 /   400 LOC     8 tests   (new package)
Example:                          19 tests
Total:      5,653 / 8,700 LOC   405 tests
```
All LOC budgets within limits · stink gate green (1 declared raw: the example's audited `rawSet`) · example builds via Parcel. Still open (recorded in A2 §17): structured ParseResult errors, plugin `asset.setMap` wiring, double-`mount()` guard, the §11.2 empirical allowlist probe (netpad).

---

## 2026-08-16 — v2.1.1 Conformance Patch (the §16 D-items)

Closed all 12 ratified §16 conformance decisions in individually-reviewable commits, then lockstep-bumped the monorepo to **2.1.1**. The unifying theme: every gate fails CLOSED, and behavior matches what the spec *says*, not what the implementation happened to do.

| D-item | Fix |
|--------|-----|
| D-1 | `if`/`switch` dispose-on-detach — a detached branch is a disposed branch (eager cleanup, no zombie effects) |
| D-2 | `repeat` keys duplicate primitives by value + occurrence index (duplicate-primitive reconciliation) |
| D-3 | Attribute interpolation is diagnosed instead of shipping the literal `${...}` to the DOM |
| D-5 | `TemplateImport` exported from the compiler index |
| D-6 | Double-`mount()` guard on `Component` (A2 §17 backlog item closed) |
| D-7 | Scheduler drops disposed effects at flush (stale-flush retention fix) |
| D-8 | stink-check routes on the severity FIELD, never the code prefix — a non-`stink:` warn like `switch-static-dead` can't slip the gate |
| D-9 | LOC budget tool fails closed (cloc resolution failure exits red, never a green 0-LOC report) and counts production LOC only |
| D-10 | Static attributes pass the compile-time sink gate |
| D-12 | RAW banner describes the mechanism, not a completed audit |
| D-15/D-20 | Allowlist invariant strengthened + fail-closed sink tests |
| D-16/D-21 | Composition boundary recorded honestly: unshipped component composition gets fail-loud diagnostics, not silent wrong output (the "unshipped machinery described as shipped is a defect" lesson) |

---

## 2026-08-16 — v2.2.0: The Routing Release

Implemented the full v2.2 scope from `impl_docs/spec/DiamondJS_v2.2_Implementation_Work_Order.md` across seven checkpointed phases on `v2.1-implementation`, producing the **v2.2 Router Specification** (`impl_docs/spec/`) and **Amendment A3** (`impl_docs/plans/`). v2.2 marks the point where DiamondJS can single-handedly deliver multi-view SPAs. All packages lockstep-bumped to **2.2.0** and tagged.

### Phase 1 — Logging consolidation (overturns A2 §94)
One vocabulary: dev-log deleted; the runtime emits through primafacie's `Print`. Browser→server WebSocket log relay (`wsSink` → `wsReceiver` → datestamped `fileSink`).

### Phase 2 — run_mode / `__DIAMOND_DEV__`
`app/config/config.json` → `run_mode: "dev" | "prod"`; the Parcel transformer injects `__DIAMOND_DEV__`, and every dev-only path (route-table narration, richer diagnostics) is dead-code-eliminated from prod builds.

### Phases 3+4 — Router core + test suite
`packages/runtime/src/router.ts` + `guard.ts` + `pending.ts`: nested routes, multiple named outlets, specificity matching (never declaration order), typed URL params through the converter/`ParseResult` contract (parse failure ⇒ route doesn't match), two-phase atomic commit (ALL guards before ANY mount; deepest-first unmount, parent-first mount), plain-`<a href>` link interception, popstate + initial-load guard coverage. Guards: class-based, fail-closed execution envelope (throw ⇒ deny, hang ⇒ deny after `Guard.timeoutMs`, every decision narrated through `Print`). `Pending` departure safety: passthrough `Pending.until`, reactive `Pending.active`, `beforeunload` handler removed at zero refcount (bfcache preserved).

### Phase 5 — route-check
`tools/route-check.ts`: standalone build-time RouteMap gate in the stink-check posture (red output, nonzero exit). Errors speak ROUTE IDS, not file offsets, with did-you-means. Outlet inventory assembled by scanning templates for `<outlet name="...">`.

### Phase 6 — @diamondjs/guards scaffold
Ships with ZERO battery mid-classes (the D-16 lesson applied prospectively): type re-exports only, candidates recorded (OAuthGuard/WebAuthnGuard/CapabilityGuard/TenantGuard) awaiting a real consuming app's guard inventory.

### Phase 7 — Meta-packages + lockstep CI
`@diamondjs/app` (runtime + converters + primafacie + guards), `@diamondjs/dev` (compiler + transformer), `@diamondjs/all` (both) — exact pins, never ranges; `tools/check-meta-versions.ts` enforces lockstep, fail closed.

### Release decisions (Joe-ratified)
- **Ideation fixtures** replace the withdrawn project route sketches: the normative reference map is "Conveyor", a generic ingest-pipeline app (Router Spec §13), exercised in `router-reference-map.test.ts` including the all-vectors leak-free exit criterion. DiamondJS stays agnostic of downstream projects — consuming-project names appear only in the Work Order as process gates, never in package source or normative spec text.
- **basePath**: `new Router(routes, { basePath })`; basePath = the browser-visible public prefix (reverse-proxy rule + mismatch WARNING, Router Spec §14).

521/521 tests green at tag time.

---

## 2026-08-16 — v2.2.1: The Destination Type & Redirect Taxonomy

Implemented Joe's signed micro work order replacing string redirect targets with the **`Destination` tagged union** — four explicit arms, three concentric circles: `route-id` / `route-path` (inside the router's map), `site-path` (same origin beyond the SPA — hard load), `external-url` (off origin, https-only, static-only: the open-redirect rail).

- **NO string classifier, ever** — `site-path` is shape-indistinguishable from `route-path`; arms are declared, not inferred. Recorded as the explicit-discriminants meta-rule (spec §5 "Destinations").
- `Deny` retired; `Guard.deny()` returns a `Destination` — redirects and guard denials speak one vocabulary.
- Arm-aware route-check rules with did-you-means: `destination-arm-mismatch`, `unknown-redirect-target`, `unresolvable-route-path`, `site-path-shadows-route`, `static-target-has-params`, `external-redirect-invalid`, `redirect-cycle` (across both internal arms; `site-path`/`external-url` terminate the graph).
- tsc-verified type-test (`npm run typecheck` → `tsconfig.typetest.json`).
- `IntConverter`/`SlugConverter` land in `@diamondjs/converters` (the route-param workhorses).

Lockstep **2.2.1**, tagged. **518 tests across 45 files**; production LOC 4,405 / 8,700 (50.6%).

---

## 2026-08-20 — v2.2.2: npm Bootstrap Publication + the Dev Toolchain

The first-ever publication of DiamondJS to the npm registry. Preflight surfaced real defects (the point of preflight); Option A made `@diamondjs/dev` honor its own description; and since npm `name@version` is immutable, everything landed before the first publish as **2.2.2**.

### Preflight repairs (PR #4, commit 1)
- `@parcel/source-map: ^2.2.1` — a nonexistent version: the DiamondJS 2.2.1 lockstep bump accidentally caught an external dependency. Reverted to `^2.1.1`; full-manifest audit found no siblings.
- `package-lock.json` was stale at 2.1.1 with **no entries at all** for the app/dev/all meta-packages. Regenerated; `npm ci` passes clean.
- `eslint.config.js` → `.mjs` (ESM config in a CJS root package — ESLint could not load it, so **the lint gate had never actually run**), plus the two real errors the newly-working gate surfaced (`prefer-const` in runtime decorators; useless regex escape in converters currency).

### Option A: @diamondjs/dev ships the full dev toolchain (PR #4, commit 2)
`npm i -D @diamondjs/dev` now delivers what its description promised:
- `stink-check` + `route-check` moved `tools/` → `packages/dev/src` and published as compiled `#!/usr/bin/env node` bins. route-check loads consumer `.ts` route modules via tsx's `tsImport` (bare package imports resolve through the normal loader — Guard identity preserved for `guard-check-not-overridden`).
- stink-check's compiler is **injected, never imported**: the published bin supplies `@diamondjs/compiler`'s dist; the repo-gate wrapper (`tools/stink-check.ts`) supplies the compiler SOURCE — the gate still never depends on a stale dist build. Root scripts unchanged.
- Toolchain deps: `parcel ^2.12.0`, `typescript ^5.5.0`, `tsx ^4.7.0`, plus exact-pinned runtime + primafacie (check-meta lockstep holds).
- Found bug → coverage: `tools/route-check.test.ts` was never executed by any gate (root `npm test` sweeps workspaces only). Moved to `packages/dev/tests` — 39 tests now run in the sweep. `packages/dev/src` gets a LOC budget (800 / warn 700).

### READMEs + license resolution (PR #5)
- Per-package READMEs for all nine packages (root-README style, each with its own surface); every `files` field had declared a README that didn't exist.
- License conflict found and resolved: LICENSE file said AGPL-3.0 while all nine `package.json` fields said MIT. **Joe's call: MIT everywhere** — LICENSE replaced, root README updated, LICENSE copied per-package so every tarball carries it.
- Root README correctness fix: the Quick Start `.parcelrc` named the transformer unscoped (`parcel-transformer-diamond`), which Parcel cannot resolve → `@diamondjs/parcel-transformer-diamond`.

### The publication
All nine packages published serially in dependency order — `primafacie → runtime → compiler → converters → guards → parcel-transformer-diamond → app → dev → all` — each verified from the registry (`npm view`, dist-tag `latest`) before the next. Exact-pin constellation graphs confirmed live.

Operational lesson worth recording: publishing with 2FA requires a granular access token **with "Bypass two-factor authentication" enabled** (off by default) — without it, every publish demands an OTP even with a valid token.

### Clean-room verification (the test that actually matters)
From directories that had never seen the monorepo:
- **npm**: `npm install @diamondjs/app` + `npm i -D @diamondjs/dev` → tree resolves with a single deduped runtime; `Router`/`Guard`/`Component` import as functions; `IntConverter.parse("42")` returns a valid `ParseResult`; `npx parcel` (2.16.4), `npx tsc` (5.9.3), `npx stink-check` (gate passes), `npx route-check` (correct usage) all work from the registry install.
- **Bun**: `bun add @diamondjs/app` + `bun add -d @diamondjs/dev` → same imports, same results.

### Final state
```
Runtime:      1,551 / 2,500 LOC
Compiler:     2,267 / 5,000 LOC
Parcel:         164 /   300 LOC
Converters:     123 /   500 LOC
Primafacie:     300 /   400 LOC
Dev toolchain:  492 /   800 LOC   (new budget)
Total:        4,897 / 9,500 LOC   557 tests
```
All gates green · all nine `@diamondjs/*@2.2.2` live on npm with dist-tag `latest` · `npm install @diamondjs/app` and `bun add @diamondjs/app` are real for the first time. Still open for a 2.2.x: guards battery mid-classes (first families land once a real consuming app's guard inventory exists).


---

## 2026-09-29 — v2.2.3: First-Real-App Findings

The first application built on the published 2.2.2 constellation — a hosted single-page map/reduce text processor (Elysia/Bun back end, Parcel 2.16 front end) — surfaced five defects within its first day, filed as issues #7–#11. Two blocked the app outright and were worked around locally (a `bun patch` on the runtime; `useDefineForClassFields: false` in its tsconfig). PR #12 fixed all five upstream, one commit per issue, with a fix note posted on each issue via `gh`.

### The five fixes
- **#7 — `if`/`switch`/`repeat` rendered nothing on first mount.** Two facts collided: the generator emitted the `DiamondCore.if/switch/repeat` call BEFORE the parent appended the anchor, and the runtime's first pass runs synchronously inside that call, inserting with `anchor.parentNode?.insertBefore(...)` — a silent no-op on a detached anchor, with the branch index already recorded as active. Compiler: structural calls are deferred through per-container *attach frames* until the container's `appendChild` block has run (emitted order: create anchor → append anchor → wire the directive); every nested structural now renders synchronously on mount. Runtime: `DiamondCore.placeBefore` inserts now when the anchor is attached, otherwise on the next microtask, re-reading the directive's live nodes so a branch replaced or disposed meanwhile is never resurrected — covers a structural at the template root (which nothing can pre-attach) and hand-written templates. Every pre-existing structural test appended the anchor *before* calling the directive — the opposite of compiler order — which is why none caught it.
- **#9 — `<select value.two-way>` bound before its options.** `bind()`'s synchronous first pass assigned `.value` to an option-less select — a no-op — so the initial model value was lost. `<select>` is now the one element whose bindings and handlers are emitted after its children, behind a `[Diamond]` hint; composes with #7 so `repeat.for`-generated option lists select correctly on mount.
- **#8 — static `<a href="/path">` failed stink-check.** Spec §6.3 already said "`href` is deliberately off-list — SPA links use a static `href` attribute plus a click-interceptor, never a dynamic `href` bind"; the D-10 static-attribute gate contradicted that sentence for the very pattern it names. `isInertStaticHref`: a static `href` on `<a>`/`<area>` whose literal target is scheme-less or `http`/`https`/`mailto`/`tel` gates clean; `javascript:`/`data:`/unenumerated schemes still warn (whitespace/control characters stripped first, as the HTML URL parser does — `java\nscript:` must still warn); bound `href` still warns; `href` stays off `SAFE_SINKS`. `role` joins `data-*`/`aria-*` as inert metadata (`isInertMetadataKey`, both gates + spread). Allowlist candidates `rows`/`cols`/`list`/`for` left for ratification.
- **#11 — `@reactive` silent no-op under `useDefineForClassFields: true`.** TypeScript's default for ES2022+ targets, and what Parcel 2.16/SWC emit: fields DEFINED as own data properties shadowed the accessor the legacy decorator installs on the prototype; the hello-world only worked because its older Parcel lowered fields to `[[Set]]` assignments. `reactive()` now records decorated keys (per prototype; per instance on the TC39 field path via `addInitializer`), and `Component.mount()` — the first framework entry after construction — calls `adoptDefinedReactiveFields` to re-route shadowed values through their accessors. Dev builds report the repair once per class. Quick Start / runtime README now require BOTH flags; hello-world sets `useDefineForClassFields: false` explicitly.
- **#10 — `route-check` failed with `ERR_UNKNOWN_FILE_EXTENSION`.** Page components import `*.diamond.html` templates (and `.css`), which tsx cannot load, so the gate only worked for route maps that import no templates — not the recommended layout. The bin now installs inert stubs on BOTH loader paths before importing: an ESM `resolve` hook registered from a `data:` URL, and a wrapped CommonJS `.js` handler — discovery: tsx's `tsImport` tags CJS filenames with `?namespace=…`, so a `.html` key in `Module._extensions` never matches, but tsx delegates every non-TS file to the `.js` handler it captured at registration. Verified with the built bin under plain node for `"type": "module"` and CommonJS consumers; the previous bin fails the same fixture exactly as reported.

### Verification
- 605 tests (557 → +48) across 51 files; new suites: `first-mount-order` (runtime + compiler compile→mount end-to-end), `select-binding-order`, `define-semantics`, `route-check-template-imports` (spawns the real bin per package type), security-gate cases for the href rule and `role`.
- All gates green: `check-loc`, `stink:check`, `check-meta`, `lint`, `typecheck`, `build`.
- The consuming app's five real templates compile with the fixed compiler: 0 errors, 0 `stink:warn` with its nav restored to plain `href`, all 64 structural anchors attached before their calls, all 8 selects bound after their options.

### What the consuming app can now drop
The `patchedDependencies` runtime patch (#7), the `data-route` + `setAttribute('href')` in `mount()` (#8), the `@reactive synced` flags on select-bound getters (#9), and the `route-check` wrapper scripts (#10). Its `useDefineForClassFields: false` stays — it is now the documented configuration.

### Release mechanics
- Lockstep bump 2.2.2 → 2.2.3 across root, hello-world and all nine manifests (exact pins in app/dev/all; `^` ranges in compiler/converters/guards/parcel-plugin/runtime), lockfile regenerated with `--package-lock-only`, `check-meta` green.
- `npm pkg fix` (a ROADMAP v2.2.3 hygiene item): `repository.url` → `git+https://…` in every manifest; `@diamondjs/dev` bin paths normalized.
- `CHANGELOG.md` introduced (Keep a Changelog; backfilled to 2.0.0). README / ROADMAP / FAQ reconciled to v2.2.3. Package source stays agnostic of downstream project names.

### Final state
```
Runtime:      1,625 / 2,500 LOC
Compiler:     2,296 / 5,000 LOC
Parcel:         164 /   300 LOC
Converters:     123 /   500 LOC
Primafacie:     300 /   400 LOC
Dev toolchain:  527 /   800 LOC
Total:        5,035 / 9,500 LOC   605 tests
```

### The publication (2026-09-29, 20:04–20:13 PDT)
All nine packages published serially in dependency order from the tagged `main` (`v2.2.3` = merge of PR #13), each accepted by the registry (`+ @diamondjs/<pkg>@2.2.3`) before the next; visibility verified once at the end — every `dist-tags.latest` reads 2.2.3. Clean-room check from a directory that had never seen the monorepo: `npm i @diamondjs/app@2.2.3` + `npm i -D @diamondjs/dev@2.2.3` resolve to a single 2.2.3 constellation; the registry `route-check` bin validates a route map whose page component imports `*.diamond.html` + `.css` (the #10 shape); the registry `stink-check` passes the README nav pattern (`<a href="/ingest">`, the #8 shape). GitHub release `v2.2.3` carries the changelog section.

Operational lessons, updating the v2.2.2 note:
- The granular-token **"Bypass two-factor authentication"** checkbox silently reverts when the token page is refreshed — verify the ✔ in the *Access Tokens* list before publishing; a token without it fails every publish with `EOTP` even though `npm whoami` succeeds.
- npm now processes a publish **asynchronously**: `npm publish` answers "being processed and may take a few minutes to become available", and `npm view` surfaced each version 2–4 minutes later. Verify visibility once at the end of the batch, not per package, or the batch stalls on a version the registry has already accepted.
- The dependency order is a courtesy to mid-batch installers, not a registry requirement — publish does not check that a package's dependencies are already visible.

## 2026-10-01 — v2.2.4: The Second Hardening Pass

The same application that produced v2.2.3 kept growing, and two more reports arrived the day after that release: a "Save output" button that landed on the not-found page (#14) and prose that rendered as "pressStart jobon" (#15). #14 was a contained router fix. #15 was not: reviewing its suggested regex — in this repo, then adversarially by two other models — turned one compiler report into a decision (template text is preserved exactly; indentation is content) and four prerequisite or adjacent defects, each filed and fixed on its own branch: #17, #18, #19, #20. A fifth, #29, followed from #19. The whitespace change itself is a behaviour change and is held for 2.3; everything it stands on ships here. Six PRs (#16, #21–#24, #30), one issue each.

### The six fixes
- **#14 — the link interceptor routed anchors that are not navigation.** `Router.onClick` claimed every same-origin `<a href>` click. A `blob:` URL reports its creating document's origin, so the usual `<a download href="blob:…">` + `click()` passed the origin test and was navigated to the not-found route. The handler now returns before `preventDefault` for `download`, a `target` other than `_self`, a `rel` token `external`, and any non-http(s) scheme.
- **#20 — hash-only links were claimed; query and hash were dropped.** Found while fixing #14. `run()` now carries a `UrlTail` (`search` + `hash`) into the history write — from the anchor on a click, from the location on initial load and popstate (both used to rewrite the entry to the bare path), from a route-* Destination's `query`. Declared `query` converters parse the TARGET's search (they read `location.search`, which on a push is the page being left). A same-document fragment link is not claimed, and a popstate that only changes the hash returns early. Driven in real Chromium afterwards: fragment links scroll natively, and Chromium does fire popstate on a fragment click, so the early return is required. What it does not do — scroll to the hash after a route navigation, `navigate()` taking a URL, `href="#"` passing through — is #28.
- **#17 — multi-root bodies could not be removed, and structural-only bodies leaked.** A body with two or more roots mounts as a `DocumentFragment`, which is empty once inserted; `switch()` and `Component.unmount()` then called `.remove()` on it. Separately, a body that is ONLY a structural left its output behind even with a single root, because that output sits before the anchor the old code removed. The runtime now tracks the mounted range (`DiamondCore.trackRange`) and `if()`, `switch()` and `Component` remove through it; a body that begins with a structural mounts behind one `<!---->` marker. Done by a separate session in its own worktree (PR #24).
- **#18 — `collectIfChain` consumed whitespace after a finished chain.** Latent: the parser still drops whitespace-only text. Fixed now as groundwork — lookahead without consuming, ASCII whitespace only as a branch separator.
- **#19 — author text in emitted JS had no single encoder.** Interpolated text escaped only the backtick and `${`, so `C:\temp ${x}` rendered a tab and `C:\users ${x}` did not parse. `js-text.ts` now holds one encoder per position (`jsString`, `jsTemplatePart`, `jsCommentText`) and the generator assembles no quotes by hand. Routing the hint comments through it exposed a second defect: a line break inside a quoted expression ended the `// [Diamond]` comment, so a multi-line `if="…"` did not compile.
- **#29 — a literal `${`.** With backslashes literal (#19), `\${name}` on main meant "backslash, then interpolation", while published 2.2.3 rendered `${this.name}`; neither is a way to write a literal `${`, and `&#36;{` was decoded back into an interpolation by parse5. Decision: interpolation syntax is recognized in the RAW source only (an encoded character is never syntax), and `\${` is a literal `${` with the JS backslash-run rule. The parser scans raw spans from parse5's source locations and hands each piece back to parse5, in the same context, to decode — nothing is reimplemented. Shipping this in the same release as #19 means no published version carries the in-between behaviour.

### Verification
- 832 tests (605 → +227) across 55 files; new suites: `js-text` (98, the #19 round-trip corpus), `literal-interpolation` (79, including a zero-diff property test over a hand corpus and 1,500 generated templates), `mounted-range` (16), plus router cases for the #14 pass-throughs and the #20 query/hash paths and generator cases for the #18 lookahead.
- All gates green: `check-loc`, `stink:check`, `check-meta`, `lint` (0 errors), `typecheck`, `build`.
- Compiled code, source maps and diagnostics for the six example + consuming-app templates were byte-identical across each compiler PR (#21, #22, #30).
- Clean-room build from a fresh clone of the release branch, outside the repo: `npm ci` succeeds; the FIRST `npm run build` fails (runtime's DTS build runs before primafacie has types — #25) and `npm test` then fails in three files; a SECOND `npm run build` succeeds and all 832 tests pass. A single build is not enough on a fresh clone.
- `npm pack --dry-run` for all nine packages: each tarball holds `package.json`, `README.md`, `LICENSE` and `dist/` only (the two meta-packages have no `dist/`).

### What is deliberately not in this release
- **#15** (whitespace between inline elements) — decided, not shipped: 2.3.
- **#26** (`push()` on a reactive array does not re-run `repeat`) — needs a spec decision.
- **#27** (`route-check` on Node 22.22.2) and **#25** (first build on a fresh clone) — tooling, next patch.
- **#28** (router scroll + `navigate()` as a URL) — follow-up to #20.

### Release mechanics
- Lockstep bump 2.2.3 → 2.2.4 across root, hello-world and all nine manifests (exact pins in app/dev/all; `^` ranges in compiler/converters/guards/parcel-plugin/runtime), lockfile regenerated with `--package-lock-only`, `check-meta` green.
- `CHANGELOG.md`: `[Unreleased]` → `[2.2.4]`, with the #18 and #19 entries that their PRs had left out (to avoid conflicting `[Unreleased]` edits), a Changed list for the #29 behaviour changes, and a Known issues subsection (#15, #27, #26).
- README / ROADMAP / FAQ reconciled to v2.2.4; package READMEs updated where 2.2.4 made them stale (runtime, compiler, Parcel transformer).
- Spec amendments are Joe's: Router Specification §9 (pass-throughs, query and hash, fragment links) and the literal-`${` rule. Proposed wording is in PRs #16, #23, #30 and issue #28.

### Final state
```
Runtime:      1,690 / 2,500 LOC
Compiler:     2,464 / 5,000 LOC
Parcel:         164 /   300 LOC
Converters:     123 /   500 LOC
Primafacie:     300 /   400 LOC
Dev toolchain:  527 /   800 LOC
Total:        5,268 / 9,500 LOC   832 tests
```

### Status at pause — 2026-10-01 (read this first when resuming)
**v2.2.4 is NOT released.** The release PR (#31, branch `release-v2.2.4`) is open and unmerged; nothing is tagged and nothing is published. Work stopped here for the day on Joe's instruction.

- **Five issues are open again: #15, #25, #26, #27, #28.** They were closed for a short time on 2026-10-01 and Joe reopened them the same day. None of them is fixed.
- **New instructions are coming** (next session) to address those issues as part of preparing v2.2.4. Until they arrive, do not merge PR #31, do not tag, do not publish, and do not start any of the five on your own initiative.
- **Everything in this section above is provisional as a result.** "What is deliberately not in this release", the changelog's `[2.2.4]` entry (its date, its Known issues list for #15 / #27 / #26), the README's Known issues pointer, the ROADMAP's v2.2.5 hygiene list, the LOC table and the test count were all written for a 2.2.4 that excludes those five issues. Whatever the new instructions bring into 2.2.4 has to be moved out of "known issues / not in this release" and into the fixes, and the release branch re-verified (gates, clean-room build, `npm pack --dry-run`) before it is merged.
- **What is settled and does not need redoing:** the six fixes on main (#14, #17, #18, #19, #20, #29); the #15 decision (template text preserved exactly, recorded on the issue) and its checkpoint requirement; the publish procedure (v2.2.3's, plus: token only through a temporary npmrc, never printed; never `git clean -x` in the repo; on a tree with no `dist/` the build must run twice until #25 is fixed).
- **Remove this subsection** when the release is finalized; "The publication" takes its place.
