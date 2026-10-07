# DiamondJS v1.3 → v1.5.1 Upgrade Instructions

## For: Claude Code CLI Session with Agent Team
## Date: February 9, 2026
## Estimated LOC Delta: +80–150 lines across all packages

---

## CONTEXT FOR THE SESSION

You are upgrading DiamondJS from the v1.3 specification to v1.5.1. This is an **architectural pivot**, not a feature addition. The framework's philosophy has matured and three fundamental patterns are changing. Read the full v1.5.1 spec (`DiamondJS_Architecture_Specification_v1_5_1.md`) before writing any code.

### Current Implementation State (from project_update_log.md)

```
Runtime:      256 / 2,500 LOC   (10.2%)   — 39 tests, 94.77% coverage
Compiler:   1,268 / 5,000 LOC   (25.4%)   — 64 tests, 97.26% coverage
Parcel:       139 / 300 LOC     (46.3%)   — 17 tests, 100% (utils)
Total:      1,663 / 7,800 LOC   (21.3%)   — 120 tests passing
```

### The Three Changes (in dependency order)

| # | Change | Primary Package | Agent Lead |
|---|--------|----------------|------------|
| 1 | Proxy cache fix (WeakMap for referential identity) | runtime/reactivity.ts | compiler-dev |
| 2 | Kill static template factory → instance `createTemplate()` with `this` | runtime/component.ts + compiler/generator.ts | compiler-dev |
| 3 | Add `@reactive` property-level decorator | runtime/decorators.ts (new) + compiler | compiler-dev |
| — | Emit `[Diamond]` hint comments in all compiled output | compiler/generator.ts + compiler/compiler.ts | compiler-dev + llm-comprehension-validator |

---

## TASK 1: Proxy Cache Fix in ReactivityEngine

**Package**: `packages/runtime/src/reactivity.ts`
**Agent**: compiler-dev
**Risk**: Low
**LOC Impact**: +10–15 lines

### What to change

The current `createProxy()` creates a new Proxy on every call. This breaks referential identity for deep property access:

```typescript
// BUG: this.user.profile !== this.user.profile (different proxy wrappers each time)
```

### Implementation

Add a `WeakMap<object, any>` cache to `ReactivityEngine`:

```typescript
private proxyCache = new WeakMap<object, any>();

createProxy<T extends object>(obj: T): T {
  if (this.proxyCache.has(obj)) {
    return this.proxyCache.get(obj);
  }

  const proxy = new Proxy(obj, {
    get: (target, prop, receiver) => {
      this.trackDependency(target, prop);
      const value = Reflect.get(target, prop, receiver);
      // Deep reactivity: wrap nested objects lazily
      if (value !== null && typeof value === 'object') {
        return this.createProxy(value); // Cache handles dedup
      }
      return value;
    },
    set: (target, prop, value, receiver) => {
      const oldValue = Reflect.get(target, prop, receiver);
      const result = Reflect.set(target, prop, value, receiver);
      if (oldValue !== value) {
        this.triggerEffects(target, prop);
      }
      return result;
    }
  });

  this.proxyCache.set(obj, proxy);
  return proxy;
}
```

### Key additions vs. current code

1. **`proxyCache` WeakMap** — check before creating, store after creating
2. **Deep reactivity** — `get` trap returns `this.createProxy(value)` for nested objects
3. **Change guard** — `set` trap only triggers when `oldValue !== value`

### Tests to add

```
✓ Same proxy returned for same object (referential identity)
✓ this.obj.nested === this.obj.nested (deep proxy identity)
✓ Setting same value does NOT trigger effects
✓ Setting different value DOES trigger effects
✓ WeakMap allows GC of unreferenced objects
```

### Verification

After implementing, run: `npm test -- --filter runtime`
All existing 39 tests must still pass. New tests should add 5–8 more.

---

## TASK 2: Kill Static Template Factory → Instance Method

**Packages**: `packages/runtime/src/component.ts` + `packages/compiler/src/generator.ts`
**Agent**: compiler-dev (runtime), compiler-dev (compiler)
**Risk**: MEDIUM — this touches the core compilation pipeline
**LOC Impact**: Net −10 to +5 (simpler component, slightly more generator code)

### 2A: Rewrite Component Base Class

**File**: `packages/runtime/src/component.ts`

**Remove entirely:**
- `private static _templateFactory`
- `static getTemplateFactory()`
- `static createTemplate()` (the static abstract version)
- The `(vm: any) => HTMLElement` type pattern

**Replace with:**

```typescript
export abstract class Component {
  protected element: HTMLElement | null = null;
  private cleanups: Array<() => void> = [];

  /**
   * Compiler-generated INSTANCE method.
   * Uses 'this' to reference component properties and methods.
   */
  createTemplate(): HTMLElement {
    throw new Error(
      `${this.constructor.name} must implement createTemplate(). ` +
      'This should be compiler-generated from the .html template.'
    );
  }

  mount(hostElement: HTMLElement): void {
    this.element = this.createTemplate();
    hostElement.appendChild(this.element);
  }

  update(newProps: Partial<this>): void {
    Object.assign(this, newProps);
  }

  unmount(): void {
    for (const cleanup of this.cleanups) {
      try { cleanup(); }
      catch (e) { console.error('[Diamond] Cleanup error:', e); }
    }
    this.cleanups = [];
    this.element?.remove();
    this.element = null;
  }

  protected registerCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  getElement(): HTMLElement | null {
    return this.element;
  }
}
```

**What changed:**
- `createTemplate()` is now an instance method (no `static`, no `vm` parameter)
- `mount()` calls `this.createTemplate()` directly (no factory lookup, no cast)
- Added `cleanups` array + `registerCleanup()` for proper resource management
- Added `getElement()` accessor

### 2B: Update Code Generator

**File**: `packages/compiler/src/generator.ts`

This is the most critical change. The generator currently emits:

```javascript
static createTemplate() {
  return (vm) => {
    // ... vm.count, vm.handleClick(), etc.
  };
}
```

It must now emit:

```javascript
// [Diamond] Compiler-generated instance template method
createTemplate() {
  const div = document.createElement('div');
  // [Diamond] Binding reactive property 'count' → textContent
  DiamondCore.bind(span, 'textContent', () => this.count);
  // [Diamond] Event binding: click → handleClick()
  DiamondCore.on(button, 'click', () => this.handleClick());
  div.append(span, button);
  return div;
}
```

**Specific changes in generator.ts:**

1. Method signature: Remove `static` keyword. Remove the `return (vm) => {` wrapper and its closing `};`. The method body directly builds and returns the DOM tree.

2. All `vm.` references become `this.`:
   - Binding getters: `() => vm.x` → `() => this.x`
   - Binding setters: `(v) => vm.x = v` → `(v) => this.x = v`
   - Event handlers: `() => vm.fn()` → `() => this.fn()`
   - Interpolations: `vm.prop` → `this.prop`

3. Add `[Diamond]` hint comment generation (see Task 4).

### 2C: Update Compiler Injection

**File**: `packages/compiler/src/compiler.ts`

The `compileAndInject()` method currently injects a static method. Update the regex/injection logic to inject an instance method. The method should NOT have the `static` keyword.

### Tests to update

**Runtime tests (`component.test.ts`):**
- Remove all tests referencing `static createTemplate` or `getTemplateFactory`
- Update test components to use instance `createTemplate()` returning `HTMLElement`
- Remove `vm` parameter from test template factories

**Compiler tests (`generator.test.ts`):**
- Update all snapshot/string assertions from `static createTemplate()` → `createTemplate()`
- Update all `vm.` assertions → `this.`
- Remove assertions about `return (vm) => {` wrapper

**Compiler tests (`compiler.test.ts`):**
- Update `compileAndInject` tests for instance method injection

### Verification

Run full test suite: `npm test`
All tests must pass. This is a breaking change to the compilation output — expect ~30–40 test assertions to need updating.

---

## TASK 3: Add @reactive Property Decorator

**Package**: `packages/runtime/src/decorators.ts` (NEW FILE)
**Agent**: compiler-dev
**Risk**: Low (additive, doesn't break existing code)
**LOC Impact**: +30–50 lines

### Implementation

Create `packages/runtime/src/decorators.ts`:

```typescript
import { DiamondCore } from './core';

/**
 * @reactive property decorator
 *
 * Marks a class property as reactive. When the property changes,
 * any effects or bindings that read it will re-execute.
 *
 * Usage:
 *   @reactive count = 0;       // Drives UI
 *   lastClickTime = 0;         // Inert (no decorator)
 */
export function reactive(
  target: any,
  propertyKey: string
): void;
export function reactive(
  target: any,
  context: ClassFieldDecoratorContext
): (initialValue: any) => any;
export function reactive(
  target: any,
  contextOrKey: ClassFieldDecoratorContext | string
): any {
  // TC39 Stage 3 decorator (TypeScript 5.0+)
  if (typeof contextOrKey === 'object' && contextOrKey.kind === 'field') {
    const context = contextOrKey;
    return function (initialValue: any) {
      // Will be wrapped by DiamondCore.makeReactive in constructor
      return initialValue;
    };
  }

  // Legacy TypeScript decorator (experimentalDecorators)
  // The compiler transforms @reactive into a constructor call:
  // DiamondCore.makeReactive(this, 'propertyKey')
}
```

**NOTE TO AGENT TEAM**: The decorator implementation strategy depends on whether the project uses `experimentalDecorators: true` (legacy) or TC39 Stage 3 decorators. Check `tsconfig.base.json`. The v1.3 implementation used legacy decorators based on the Phase 0 setup. The safest path for Phase 1 is:

1. The `@reactive` decorator is syntactic sugar at write-time
2. The **compiler** transforms it into explicit `DiamondCore.makeReactive(this, 'propName')` calls in the constructor
3. The runtime decorator function itself can be minimal — its primary job is to exist as a valid decorator so TypeScript doesn't complain

### Add `makeReactive` to DiamondCore

**File**: `packages/runtime/src/core.ts`

Add this static method:

```typescript
/**
 * Make a specific property reactive on a component instance.
 * Called by compiler-generated constructor code for @reactive properties.
 */
static makeReactive(target: object, property: string): void {
  const value = (target as any)[property];
  if (value !== null && typeof value === 'object') {
    (target as any)[property] = this.reactive(value);
  }
  // For primitives: the compiler generates getter/setter pairs
  // that call effect tracking. This is handled in the compiler output.
}
```

### Update exports

**File**: `packages/runtime/src/index.ts`

Add: `export { reactive } from './decorators';`

### Tests to add

```
✓ @reactive decorator exists and is a function
✓ DiamondCore.makeReactive wraps object values in proxy
✓ DiamondCore.makeReactive is no-op for primitives
✓ Component with @reactive property triggers effects on change
✓ Component with bare property does NOT trigger effects on change
```

---

## TASK 4: Compiler-Emitted [Diamond] Hint Comments

**Package**: `packages/compiler/src/generator.ts`
**Agent**: compiler-dev (implementation) + llm-comprehension-validator (validation)
**Risk**: Low (additive — adds comments, doesn't change logic)
**LOC Impact**: +40–80 lines in generator

### What to emit

The generator must inject `// [Diamond] ...` comments in all compiled output. These are NOT optional debug flags — they are a first-class feature.

**Hint taxonomy:**

```javascript
// Component-level (top of file)
// [Diamond] Component: UserProfile
// [Diamond] Reactive properties: name, email, avatar

// Before each binding
// [Diamond] Two-way binding: value ↔ this.name
// [Diamond] One-way binding: textContent ← this.message
// [Diamond] Event binding: click → this.handleSave()

// Before control flow
// [Diamond] Conditional: if.bind="isLoggedIn"
// [Diamond] Repeat: repeat.for="item of items"

// Before createTemplate method
// [Diamond] Compiler-generated instance template method

// For alias expansion
// [Diamond] Alias expansion: profile.name → userProfileService.name
```

### Implementation approach

Add a `HintGenerator` utility (or inline into `CodeGenerator`):

```typescript
private emitHint(type: string, detail: string): string {
  return `// [Diamond] ${type}: ${detail}`;
}
```

Call it at each code generation point. The hint precedes the code it documents on its own line.

### Validation step

**IMPORTANT**: After implementing hints, delegate to **llm-comprehension-validator** agent:

> "Analyze the compiled output of a sample component. Verify that [Diamond] hints make every transformation self-documenting. Check that a 32B model reading ONLY the compiled output (no source template) could understand what each DiamondCore call does and why."

The validator should confirm:
- Every `DiamondCore.bind()` call has a preceding hint explaining the binding
- Every `DiamondCore.on()` call has a preceding hint explaining the event
- The component-level hints list all reactive properties
- Hint comments don't inflate bundle size beyond reason (~2% acceptable)

---

## TASK 5: Update Parcel Plugin

**Package**: `packages/parcel-plugin/`
**Agent**: parcel-plugin-dev
**Risk**: Low
**LOC Impact**: +5–10 lines

### What to change

Update the plugin to pass new compiler options:

```typescript
const compiled = compiler.compile(source, {
  filePath: asset.filePath,
  sourceMap: true,
  emitHints: true,         // NEW: enable [Diamond] comments
  methodType: 'instance'   // NEW: instance createTemplate() (not static)
});
```

If the compiler's `compile()` method signature doesn't yet accept these options, the compiler changes in Tasks 2–4 should add them. The plugin just needs to pass them through.

### Tests to update

Update any snapshot tests that assert on compiled output format.

---

## TASK 6: Update Hello World Example

**Package**: `examples/hello-world/`
**Agent**: Any
**Risk**: None
**LOC Impact**: Minimal

Update the example to use the new patterns:
- Component classes use `@reactive` decorator
- `createTemplate()` is an instance method using `this`
- Compiled output shows `[Diamond]` hints

This is the smoke test that proves the full pipeline works end-to-end.

---

## TASK 7: Architectural Health Check

**Agent**: arch-constraint-monitor
**After**: All other tasks complete

Run a full health check:

```
1. LOC budget: runtime still < 2,500? compiler still < 5,000?
2. Test coverage: still > 80% across all packages?
3. All tests passing?
4. Bundle size: still < 20KB gzipped?
```

The v1.5.1 changes should add roughly 80–150 LOC total. Budget utilization should go from ~21% to ~23%. If any constraint is violated, flag it before merging.

---

## TASK 8: Chronicle the Pivot

**Agent**: chronicler
**After**: All tasks complete and verified

Document this architectural pivot. Key narrative elements:

- The overnight reflection that led to killing the static factory
- The "give the developers back their `this`" insight
- The three-way tension: memory optimization vs. cognitive simplicity vs. LLM readability
- How the `Collection` class made the instance method trade-off viable
- The formal rejection of YOLO mode `@reactive` and what it says about the framework's values

---

## EXECUTION ORDER

```
Task 1  →  Proxy cache fix (foundation — other changes depend on clean reactivity)
Task 2  →  Kill static factory (the big one — touches runtime + compiler + tests)
Task 3  →  @reactive decorator (additive — new file + new DiamondCore method)
Task 4  →  [Diamond] hints (additive — enriches compiler output)
Task 5  →  Parcel plugin update (pass-through — new options)
Task 6  →  Hello World update (smoke test)
Task 7  →  Health check (arch-constraint-monitor validates everything)
Task 8  →  Chronicle (chronicler documents the arc)
```

Tasks 1–4 are sequential (each builds on the previous).
Tasks 5–6 can run after Task 4.
Tasks 7–8 run last.

---

## CRITICAL AGENT NOTES

### For compiler-dev

Your system prompt currently references `static createTemplate()` as the correct pattern. **This has been superseded.** The v1.5.1 spec mandates instance methods. Anywhere your training says "use static methods for template factories," override with: **instance `createTemplate()` using `this`**. Static methods remain appropriate for `DiamondCore` API methods — but NOT for template generation.

### For llm-comprehension-validator

Your autoregressive steering check is still valid — OOP consistency is maintained. The change from `static createTemplate()` to instance `createTemplate()` actually IMPROVES LLM comprehension because:
- `this.count` in the class body and `this.count` in the template are the same referent
- No `vm` parameter that an LLM might confuse with a different object
- Standard class instance method pattern — exactly what LLMs are trained on

Your NEW validation responsibility: verify that `[Diamond]` hint comments make compiled output self-documenting without any source template context.

### For parcel-plugin-dev

Minimal changes for you. The compiler API may gain new options (`emitHints`, `methodType`). Your job is to pass them through and ensure the transformer still detects Diamond templates correctly, generates source maps, and handles HMR.

### For arch-constraint-monitor

LOC budgets are unchanged. The decorator file adds ~50 LOC to runtime. Hint generation adds ~60 LOC to compiler. Total increase should be well within budget. Run your full health report after all changes land.

### For chronicler

This is a significant philosophical moment in the framework's history. The static factory pattern was the original "autoregressive steering" solution from v1.1. Killing it in v1.5.1 — because the problem it solved became less important than the problem it created — is the kind of architectural maturation worth documenting with full narrative weight.

---

## SPEC REFERENCE

The authoritative specification is `DiamondJS_Architecture_Specification_v1_5_1.md`. When any instruction in this document conflicts with the spec, the spec wins.

---

## DEFINITION OF DONE

- [ ] All existing tests pass (with updates for new patterns)
- [ ] New tests for proxy cache, decorator, hints
- [ ] Total test count: 120+ → 140+
- [ ] Coverage: > 80% on all packages
- [ ] LOC: within all budgets
- [ ] Hello World example works end-to-end
- [ ] `[Diamond]` hints visible in compiled output
- [ ] `this` used everywhere in compiled templates (zero `vm.` references)
- [ ] `@reactive` decorator importable and functional
- [ ] Health check passes (arch-constraint-monitor)
- [ ] Phase documented (chronicler)
- [ ] project_update_log.md updated with v1.5.1 entry
