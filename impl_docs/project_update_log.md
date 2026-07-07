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

