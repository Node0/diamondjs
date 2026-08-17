# DiamondJS Architecture & Design Specification v1.5.1

**Date**: February 9, 2026  
**Status**: Working Draft  
**Author**: Joe Hacobian  

**Revision History**:
- v1.0 (Nov 2, 2025) — Initial comprehensive specification
- v1.1 (Nov 2, 2025) — **FIX**: Corrected tendency of codegen to drift out of OOP patterns.
- v1.2 (Nov 6, 2025) — **PERFORMANCE**: Introduced hybrid reactivity system with Collection class for large datasets.
- v1.3 (Dec 25, 2025) — Added `with.bind` & required aliasing for ergonomic composition of complex state.
- v1.5 (Feb 9, 2026) — **ARCHITECTURAL PIVOT**: Eliminated static template factory in favor of instance methods. Restored universal `this` binding. Adopted property-level `@reactive` decorator. Introduced compiler-emitted semantic hint comments. Fixed proxy cache for referential identity. Formalized the Zen of DiamondJS.
- v1.5.1 (Feb 9, 2026) — **FIX**: Nested component convention changed from `index.*` to `component-name.*` to eliminate filename ambiguity in multi-developer workflows.

---

## Executive Summary

DiamondJS is the first JavaScript framework explicitly designed for the human-LLM collaborative development era. It achieves outsized developer productivity by optimizing for two complementary goals:

1. **Human Ergonomics**: An intuitive, low-friction component model where the framework is "barely noticed"
2. **LLM Comprehension**: Radically transparent compiled output that even 32B parameter models can debug instantly

**Core Innovation**: Separation of ergonomics (write-time) from transparency (debug-time) via build-time compilation, with compiler-emitted semantic hints that make every transformation self-documenting.

**v1.5 Architectural Pivot**: This version formalizes three critical changes that emerged from deep philosophical and engineering analysis of developer experience:

- **`this` everywhere**: The static template factory is eliminated. `createTemplate()` is now an instance method. There is one referent for the component instance, and it is the JavaScript keyword `this`. No `vm`, no `self`, no indirection.
- **`@reactive` decorators (property-level)**: Explicit, per-property reactivity declarations. Decorated properties drive the UI. Bare properties are inert. No class-level "YOLO mode" — clarity of intent is non-negotiable.
- **Compiler-emitted `[Diamond]` hints**: The compiler injects human- and LLM-readable comments into compiled output explaining every transformation. This is not a nice-to-have — it is a first-class feature that makes "build-time magic, runtime honesty" a concrete reality.

**Validation**: 6-phase archaeology of Aurelia 2.0 confirms feasibility. Phase 0 implementation achieved 120+ passing tests, 80%+ coverage, using 21% of the LOC budget in ~3 hours of active development.

---

## Table of Contents

1. [The Zen of DiamondJS](#the-zen-of-diamondjs)
2. [Design Philosophy](#design-philosophy)
3. [Architecture Overview](#architecture-overview)
4. [Core Constraints](#core-constraints)
5. [Component System](#component-system)
6. [Template DSL](#template-dsl)
7. [Reactivity & Binding Engine](#reactivity--binding-engine)
8. [Performance-Optimized Collections](#performance-optimized-collections)
9. [Build System](#build-system)
10. [Runtime API](#runtime-api)
11. [Scaffolding & Developer Experience](#scaffolding--developer-experience)
12. [Router](#router)
13. [Optional Services](#optional-services)
14. [Success Metrics](#success-metrics)
15. [Implementation Roadmap](#implementation-roadmap)
16. [Performance Analysis](#performance-analysis)
17. [Appendices](#appendices)

---

## The Zen of DiamondJS

These are the governing principles of the framework. They are not aspirational poetry — they are engineering constraints with teeth. When a design decision creates tension, these principles break the tie.

### I. Radical Transparency (The "Show Your Work" Rule)

There is no black box at runtime. We prefer build-time transformations over runtime reflection. When an LLM or a junior developer reads the compiled output, they see standard JavaScript classes calling explicit functions. We do not use a Dependency Injection container because it hides the provenance of objects. The compiler leaves a paper trail for every transformation it performs.

### II. The Law of Conservation of Complexity

Complexity must go somewhere. We choose to put it in the Compiler, so it doesn't have to live in the Runtime or the Developer's Head. It is acceptable to use ergonomic syntax (like decorators), but only if they compile down to code that is self-evidently transparent.

### III. Consistency Over Optimization

We will not break the mental model of the framework to save 2MB of RAM, unless that 2MB prevents the application from existing. If `this` works in 90% of cases, we make it work in 100% of cases, rather than forcing a static pattern for a theoretical performance gain. We optimize the data structures (Collection class), not the syntax.

### IV. The "Pit of Success" Scaffolding

Decisions decrease energy. DiamondJS makes the routine decisions for you so you can spend energy on the unique problems. The CLI doesn't just create files; it creates an architecture. We do not offer twelve router options; we offer one router that works perfectly and is designed for extension.

### V. Routine Things Simple, Difficult Things Possible

The "Hello World" should be trivial. The "Flickr Clone" should be possible without ejecting. When a developer hits a performance wall (large datasets), they switch to `Collection` — not because the framework is broken, but because the *physics of data* changed. The framework explains this transition; it doesn't hide it.

### VI. Barely Noticed Is Victory

The highest praise for DiamondJS is: "I barely even noticed the framework was there." We are not trying to be a feature on someone's resume. We are trying to disappear so the developer can focus on what they're actually building.

---

## Design Philosophy

### The Three Principles (Technical)

**1. Radical Transparency at Debug-Time**

Every line of code the browser executes must be immediately comprehensible to humans and LLMs without consulting documentation.

**Anti-pattern (Aurelia 2.0)**:
```typescript
// What the LLM sees — but can't understand
@customElement('my-app')
export class MyApp {
  constructor(private http: HttpClient) {} // Where did http come from?!
}
```

**Pattern (DiamondJS)**:
```typescript
// Completely transparent — zero magic
import { httpClient } from './services/http';

export class MyApp extends Component {
  private http = httpClient; // Clear provenance

  constructor() {
    super();
  }
}
```

**2. Ergonomics at Write-Time**

Developers write beautiful, minimal code using intuitive syntax. The compiler handles the plumbing.

**3. Build-Time Magic, Runtime Honesty**

All "magic" happens during compilation. The runtime is a small library of explicit functions. The compiler emits semantic hint comments so that every transformation is self-documenting.

```html
<!-- Write-time: Ergonomic Aurelia-like syntax -->
<input value.bind="name">
<button click.trigger="save()">Save</button>
```

```javascript
// Debug-time: Transparent runtime calls with compiler hints
// [Diamond] Component: MyComponent
// [Diamond] Reactive properties: name

// [Diamond] Compiler-generated instance template method
createTemplate() {
  const input = document.createElement('input');
  // [Diamond] Two-way binding: value ↔ this.name
  DiamondCore.bind(input, 'value', () => this.name, (v) => this.name = v);

  const button = document.createElement('button');
  // [Diamond] Event binding: click → save()
  DiamondCore.on(button, 'click', () => this.save());
}
```

---

## Architecture Overview

### The Three-Layer Model

**Layer 1: Write-Time (Human + LLM Friendly)**
- Vanilla ES2022+ JavaScript/TypeScript
- Aurelia-inspired template syntax (.bind, .trigger, etc.)
- `@reactive` decorators for explicit reactivity
- Explicit imports, no magic constructors
- File triplets: .ts + .html + .css

**Layer 2: Build-Time (Compiler)**
- Parcel 2 transformer compiles templates to instance methods
- Decorator transformation to explicit `DiamondCore.reactive()` calls
- Semantic `[Diamond]` hint comments injected into output
- Source maps linking compiled output back to template source

**Layer 3: Debug-Time (LLM Comprehensible)**
- Explicit runtime class method calls
- No hidden state, no DI container
- `this` refers to the component instance everywhere
- Compiler hints explain every transformation
- ~2,500 LOC runtime library

### What Gets Eliminated

Based on Aurelia 2.0 archaeology:

| Aurelia Subsystem | LOC | DiamondJS Replacement | LOC |
|-------------------|-----|----------------------|-----|
| DI Container | 2,800 | ES Module imports + config | 0 |
| Runtime Template Compiler | 3,000 | Build-time only | 0 |
| Complex Observer System | 2,800 | Proxy-based reactivity + `@reactive` | 400 |
| 8-hook Lifecycle | 1,500 | 4-hook lifecycle | 200 |
| Decorator Metadata System | 1,500 | Compiler transformation | 0 |
| **TOTAL ELIMINATED** | **11,600** | **TOTAL RUNTIME** | **~2,500** |

---

## Core Constraints

### OOP Design Patterns as a First-Class Citizen

**ALL compiled output AND runtime library code must maintain pure OOP patterns.**

- ✅ Classes with methods (not standalone functions)
- ✅ Instance methods for template generation (not static factories)
- ✅ Static methods only for truly class-level operations
- ✅ Explicit imports of other classes/services
- ✅ Modern ES2022+ syntax throughout (private fields, optional chaining, nullish coalescing)

### Hard Constraints (Non-Negotiable)

1. **Runtime LOC Budget**: < 2,500 lines of actual runtime code
2. **Compiler LOC Budget**: < 5,000 lines of actual compiler code
3. **Zero Runtime DI**: No dependency injection container in browser
4. **Zero Runtime Parsing**: No template compilation in browser
5. **Modern ES Target**: ES2022+ output, no legacy transforms
6. **Pure OOP Output**: ALL code uses class methods, NEVER lone exported functions
7. **Source Map Requirement**: Every compiled file has `.map` file
8. **LLM Testable**: 32B models achieve >80% bug fix rate
9. **Universal `this`**: The component instance is always referenced via `this` — no `vm`, no `self`, no parameter aliasing
10. **Semantic Hints Required**: Compiler MUST emit `[Diamond]` comments in all generated code

### Soft Constraints (Targets)

1. **Bundle Size**: < 20KB gzipped for runtime library
2. **Initial Compilation**: < 3 seconds for typical project
3. **HMR Speed**: < 100ms for component updates
4. **Type Safety**: Full TypeScript support with no runtime cost
5. **Browser Support**: Modern evergreen browsers (Chrome/Firefox/Safari/Edge)
6. **Performance**: O(1) append operations for large datasets via Collection

---

## Component System

### File Organization

**Configurable Discovery** (diamond.config.js):

```javascript
export default {
  components: {
    // Option 1: All components in one directory (flat)
    mode: 'flat',
    directory: './src/components',
    // Results in: ./src/components/my-component.ts|html|css

    // Option 2: One directory per component (nested)
    // mode: 'nested',
    // directory: './src/components',
    // Results in: ./src/components/my-component/my-component.ts|html|css
  }
}
```

When using **nested** mode, the scaffold generates comment headers in each file that explicitly describe the folder-to-basename convention:

```typescript
// ──────────────────────────────────────────────────────────
// [Diamond] Component: MyComponent
// [Diamond] Convention: Folder name 'my-component' maps to class 'MyComponent'
// [Diamond] Triplet: my-component/my-component.ts + my-component.html + my-component.css
// ──────────────────────────────────────────────────────────
```

The component name is repeated in the filename — not `index.ts`. When three developers have three tabs open, every tab says exactly which component it belongs to. Zero additional token cost, impossible to mistake.

### Component Structure (v1.5 — Instance Template)

**Canonical Component Pattern**:

```typescript
// my-component.ts
import { Component, reactive } from 'diamond';
import { someService } from '../services/some-service';

export class MyComponent extends Component {
  // Reactive properties — drive the UI
  @reactive name: string = '';
  @reactive count: number = 0;

  // Inert properties — internal bookkeeping
  private service = someService;
  private lastFetchTime: number = 0;

  // Lifecycle: constructor
  constructor() {
    super();
  }

  // Lifecycle: mount
  mount(hostElement: HTMLElement) {
    super.mount(hostElement);
    // Post-render logic (DOM measurements, etc.)
  }

  // Lifecycle: update
  update(newProps: Partial<MyComponent>) {
    if (newProps.count !== undefined && newProps.count !== this.count) {
      this.handleCountChange();
    }
    Object.assign(this, newProps);
  }

  // Lifecycle: unmount
  unmount() {
    super.unmount();
    // Additional cleanup logic
  }

  // Methods
  handleClick() {
    this.name = 'Updated'; // 'this' — always the component
  }

  private handleCountChange() {
    this.lastFetchTime = Date.now(); // Inert — no render triggered
  }
}
```

**Key Design Decisions (v1.5)**:

1. **`@reactive` decorators** — Explicit reactivity. Decorated = drives UI. Bare = inert.
2. **Explicit imports** — No constructor injection magic
3. **4 lifecycle hooks** — Reduced from Aurelia's 8: constructor, mount, update, unmount
4. **Extends Component** — Base class for lifecycle management and template mounting
5. **`this` is `this`** — The component instance, everywhere, always

### Component Compilation (v1.5 — Instance Method)

**Build-Time Transform**:

```typescript
// Input: my-component.ts + my-component.html + my-component.css
// Step 1: Compiler parses my-component.html
// Step 2: Compiler generates createTemplate() as an INSTANCE method
// Step 3: Compiler injects method into my-component.ts

// Output: Enhanced component class
// [Diamond] Component: MyComponent
// [Diamond] Reactive properties: name
export class MyComponent extends Component {
  @reactive name: string = '';

  handleClick() {
    this.name = 'Updated';
  }

  // [Diamond] Compiler-generated instance template method
  createTemplate() {
    const div = document.createElement('div');

    const span = document.createElement('span');
    // [Diamond] Binding reactive property 'name' → textContent
    DiamondCore.bind(span, 'textContent', () => this.name);

    const button = document.createElement('button');
    button.textContent = 'Click me';
    // [Diamond] Event binding: click → handleClick()
    DiamondCore.on(button, 'click', () => this.handleClick());

    div.append(span, button);
    return div;
  }
}
```

**What changed from v1.3**: The template method is an **instance method**, not a static method returning a closure. `this` works naturally — the same keyword in the class body and in the template. No `vm` parameter, no `self` capture, no cognitive context-switch.

### Component Base Class Implementation (v1.5)

```typescript
// diamond/runtime/component.ts

/**
 * Component — Base class for all DiamondJS components
 *
 * Provides lifecycle management and DOM mounting.
 * Subclasses have a createTemplate() method injected by the compiler.
 */
export abstract class Component {
  /** The root DOM element for this component instance */
  protected element: HTMLElement | null = null;

  /** Cleanup functions from bindings and effects */
  private cleanups: Array<() => void> = [];

  /**
   * Compiler-generated instance method that builds the DOM tree.
   * Uses 'this' to reference component properties and methods.
   *
   * @returns The root HTMLElement for this component
   */
  createTemplate(): HTMLElement {
    throw new Error(
      `${this.constructor.name} must implement createTemplate(). ` +
      'This should be compiler-generated from the .html template.'
    );
  }

  /**
   * Mount the component to a host element
   */
  mount(hostElement: HTMLElement): void {
    this.element = this.createTemplate();
    hostElement.appendChild(this.element);
  }

  /**
   * Update component with new props
   */
  update(newProps: Partial<this>): void {
    Object.assign(this, newProps);
  }

  /**
   * Unmount the component and clean up resources
   */
  unmount(): void {
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch (error) {
        console.error('[Diamond] Cleanup error:', error);
      }
    }
    this.cleanups = [];
    this.element?.remove();
    this.element = null;
  }

  /**
   * Register a cleanup function to run on unmount
   */
  protected registerCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  /**
   * Get the component's root element (null if not mounted)
   */
  getElement(): HTMLElement | null {
    return this.element;
  }
}
```

**Why the static factory was eliminated**: The static `createTemplate()` pattern from v1.3 cached one factory function per class and passed the instance as a `vm` parameter. This created a fundamental inconsistency: `this.count` in the class body, `vm.count` in the template. Two referents for the same component. The developer had to context-switch. The memory savings were measured in kilobytes for target applications (<50K LOC, 50-200 live component instances). The `Collection` class already handles data scaling. The component shell can afford to be an instance. We gave the developers back their `this`.

### Parent-Child Communication

**Props Down** (Explicit):

```typescript
// Parent template
<child-component
  name.bind="parentName"
  count.bind="items.length">
</child-component>

// Compiled to:
const child = new ChildComponent();
// [Diamond] Prop binding: name ← this.parentName
DiamondCore.effect(() => child.update({ name: this.parentName }));
// [Diamond] Prop binding: count ← this.items.length
DiamondCore.effect(() => child.update({ count: this.items.length }));
```

**Events Up** (Standard DOM):

```typescript
// Child component
handleClick() {
  this.element.dispatchEvent(new CustomEvent('item-selected', {
    detail: { id: this.itemId },
    bubbles: true
  }));
}

// Parent template
<child-component item-selected.trigger="handleSelection($event)">

// Compiled to:
// [Diamond] Event binding: item-selected → this.handleSelection()
childElement.addEventListener('item-selected', (e) => this.handleSelection(e));
```

**No implicit event bus** — All communication is explicit and traceable.

---

## Template DSL

### Supported Syntax

#### Binding Commands

| Syntax | Meaning | Compiled Output |
|--------|---------|----------------|
| `value.bind="x"` | Two-way binding | `DiamondCore.bind(el, 'value', () => this.x, (v) => this.x = v)` |
| `text.one-time="x"` | One-time binding | `el.textContent = this.x` |
| `text.to-view="x"` | One-way to view | `DiamondCore.bind(el, 'textContent', () => this.x)` |
| `value.from-view="x"` | One-way from view | `DiamondCore.on(el, 'input', () => this.x = el.value)` |
| `value.two-way="x"` | Explicit two-way | `DiamondCore.bind(el, 'value', () => this.x, (v) => this.x = v)` |
| `click.trigger="fn()"` | Event listener | `DiamondCore.on(el, 'click', () => this.fn())` |
| `click.delegate="fn()"` | Event delegation | `DiamondCore.delegate(parent, 'click', 'button', () => this.fn())` |
| `click.capture="fn()"` | Capture phase | `DiamondCore.on(el, 'click', () => this.fn(), true)` |

Note: All compiled output now references `this` — the component instance. No `vm` parameter.

#### Value Converters & Binding Behaviors

```html
<!-- Input -->
<div>${message | uppercase}</div>
<input value.bind="search & debounce:500">

<!-- Compiled -->
import { uppercase } from './converters/uppercase';
import { debounce } from './behaviors/debounce';

// [Diamond] Value converter: message | uppercase
span.textContent = uppercase(this.message);
// [Diamond] Binding behavior: search & debounce:500
const debouncedBind = debounce(() => this.search, 500);
```

#### Template Controllers

**if/else**:
```html
<!-- Input -->
<div if.bind="isVisible">Content</div>
<div else>Fallback</div>

<!-- Compiled into instance method -->
// [Diamond] Conditional: if.bind="isVisible"
createTemplate() {
  const marker = document.createComment('[Diamond] if: isVisible');
  let currentView = null;

  DiamondCore.effect(() => {
    if (this.isVisible) {
      if (!currentView) {
        const div = document.createElement('div');
        div.textContent = 'Content';
        currentView = div;
        marker.parentNode.insertBefore(currentView, marker);
      }
    } else {
      if (currentView) {
        currentView.remove();
        const fallback = document.createElement('div');
        fallback.textContent = 'Fallback';
        currentView = fallback;
        marker.parentNode.insertBefore(currentView, marker);
      }
    }
  });

  return marker;
}
```

**with.bind** (alias required):
```html
<!-- Input: Alias provides explicit scoping -->
<div with.bind="userProfileService as profile">
  <span>${profile.name}</span>
  <span>${profile.email}</span>

  <!-- Nested aliases are additive -->
  <div with.bind="addressService as addr">
    ${addr.city}, ${profile.name}  <!-- Both accessible -->
  </div>
</div>

<!-- Compiled (pure text substitution at build-time, no runtime cost) -->
<div>
  <span>${userProfileService.name}</span>
  <span>${userProfileService.email}</span>

  <div>
    ${addressService.city}, ${userProfileService.name}
  </div>
</div>
```

**Rules**:
- Aliases expand to literal paths (no chaining)
- Inner scopes inherit outer aliases
- Same-name aliases shadow outer ones
- This is a build-time-only feature — zero runtime cost

### Template Compilation Pipeline

```
HTML String
    ↓
parse5 (HTML → AST)
    ↓
Transform AST
  ├─ Binding commands → DiamondCore.bind() / .on() calls
  ├─ Value converters → function calls + imports
  ├─ Template controllers → control flow logic
  ├─ with.bind aliases → text substitution (build-time)
  └─ Custom elements → component instantiation
    ↓
Generate JavaScript (Instance Method)
  ├─ Import statements
  ├─ createTemplate() instance method body
  ├─ [Diamond] semantic hint comments
  └─ Runtime function calls referencing 'this'
    ↓
Emit with Source Map
```

---

## Reactivity & Binding Engine

### Design Decision: Property-Level `@reactive` Decorators

**v1.5 introduces `@reactive` as the single reactivity pattern for component state.**

A `@reactive` decorator on a property signals: "This property drives the UI. When it changes, re-render." A bare property is inert — it can change freely without triggering any effects.

```typescript
import { Component, reactive } from 'diamond';

class Counter extends Component {
  @reactive count = 0;          // Drives UI — changes trigger re-render
  @reactive message = 'Hello';  // Drives UI

  lastClickTime = 0;            // Inert — no decorator, no render
  private cache = new Map();    // Inert — internal bookkeeping

  increment() {
    this.count++;               // ← Triggers UI update
    this.lastClickTime = Date.now(); // ← Silent, no UI impact
  }
}
```

**Why not class-level `@reactive` for prototype _speedrunning_ ("YOLO mode")?**

Class-level `@reactive` was considered and explicitly rejected. The reasoning:

1. **Signal loss**: If everything is reactive, nothing is meaningfully reactive. A developer (or LLM) reading the code cannot tell what drives the UI vs. what's internal bookkeeping.
2. **Inverted annotation burden**: YOLO mode requires `@internal` escape hatches on non-reactive properties, which is the inverse of the clarity we want. The developer must annotate what *isn't* reactive instead of what *is*.
3. **Performance opacity**: Class-level reactivity wraps everything in proxies, including caches, iterators, timestamps, and other internal state. This creates proxy overhead for properties that never touch the UI, and can cause render storms from internal mutations.
4. **One word per property**: `@reactive` is a single decorator. The "convenience" of class-level reactivity saves approximately 30 characters of typing while introducing an entire category of ambiguity.

Property-level `@reactive` tells a story. It is Apple-like: simple on the surface, rigorously considered underneath.

### How `@reactive` Compiles

The `@reactive` decorator compiles to an explicit `DiamondCore.reactive()` wrapping at build-time. The compiled output is transparent:

```typescript
// Source (write-time):
class Counter extends Component {
  @reactive count = 0;
  @reactive message = 'Hello';
  lastClickTime = 0;
}

// Compiled (debug-time):
// [Diamond] Component: Counter
// [Diamond] Reactive properties: count, message
class Counter extends Component {
  // [Diamond] @reactive → auto-tracked via DiamondCore
  count = 0;
  message = 'Hello';

  // [Diamond] Non-reactive (no decorator)
  lastClickTime = 0;

  constructor() {
    super();
    // [Diamond] Wrapping reactive properties
    DiamondCore.makeReactive(this, 'count');
    DiamondCore.makeReactive(this, 'message');
  }
}
```

The developer writes one word. The LLM reads the hint comment. The debugger steps through explicit function calls. Build-time magic, runtime honesty.

### Core Reactivity Engine

```typescript
// diamond/runtime/reactivity.ts

/**
 * ReactivityEngine — Proxy-based reactivity system
 *
 * Uses ES6 Proxy for transparent property access tracking.
 * Dependencies are tracked automatically when effects read reactive properties.
 */
export class ReactivityEngine {
  /** Currently executing effect (for dependency tracking) */
  private activeEffect: (() => void) | null = null;

  /** Map of object → property → Set of dependent effects */
  private dependencies = new WeakMap<object, Map<PropertyKey, Set<() => void>>>();

  /** Track which dependency sets each effect belongs to (for cleanup) */
  private effectDeps = new WeakMap<() => void, Set<Set<() => void>>>();

  /** Proxy cache — ensures referential identity for deep reactivity */
  private proxyCache = new WeakMap<object, any>();

  /**
   * Create a reactive proxy for an object.
   * Uses WeakMap cache to ensure the same proxy is returned for
   * the same underlying object (referential identity).
   */
  createProxy<T extends object>(obj: T): T {
    // Return cached proxy if one exists
    if (this.proxyCache.has(obj)) {
      return this.proxyCache.get(obj);
    }

    const proxy = new Proxy(obj, {
      get: (target, prop, receiver) => {
        this.trackDependency(target, prop);
        const value = Reflect.get(target, prop, receiver);

        // Deep reactivity: lazily wrap nested objects
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

    // Cache for referential identity
    this.proxyCache.set(obj, proxy);
    return proxy;
  }

  /**
   * Track a dependency between the active effect and a property
   */
  private trackDependency(target: object, prop: PropertyKey): void {
    if (!this.activeEffect) return;

    let depsMap = this.dependencies.get(target);
    if (!depsMap) {
      depsMap = new Map();
      this.dependencies.set(target, depsMap);
    }

    let dep = depsMap.get(prop);
    if (!dep) {
      dep = new Set();
      depsMap.set(prop, dep);
    }

    dep.add(this.activeEffect);

    // Track reverse mapping for cleanup
    let effectSets = this.effectDeps.get(this.activeEffect);
    if (!effectSets) {
      effectSets = new Set();
      this.effectDeps.set(this.activeEffect, effectSets);
    }
    effectSets.add(dep);
  }

  /**
   * Trigger all effects that depend on a property
   */
  private triggerEffects(target: object, prop: PropertyKey): void {
    const depsMap = this.dependencies.get(target);
    if (!depsMap) return;

    const dep = depsMap.get(prop);
    if (dep) {
      for (const effect of dep) {
        scheduler.queueEffect(effect);
      }
    }
  }

  /**
   * Run a function and track its dependencies.
   * Re-runs the function when any dependency changes.
   *
   * @returns Cleanup function to stop tracking
   */
  createEffect(fn: () => void): () => void {
    const effectFn = () => {
      this.activeEffect = effectFn;
      try {
        fn();
      } finally {
        this.activeEffect = null;
      }
    };

    // Run immediately to collect dependencies
    effectFn();

    // Return cleanup function
    return () => this.cleanupEffect(effectFn);
  }

  /**
   * Create a computed value that caches and auto-updates
   */
  createComputed<T>(getter: () => T): () => T {
    let cached: T;
    let dirty = true;

    this.createEffect(() => {
      dirty = true;
      getter(); // Track dependencies
    });

    return () => {
      if (dirty) {
        this.activeEffect = null; // Don't track the read
        cached = getter();
        dirty = false;
      }
      return cached;
    };
  }

  /**
   * Remove an effect from all dependency sets
   */
  private cleanupEffect(effect: () => void): void {
    const effectSets = this.effectDeps.get(effect);
    if (effectSets) {
      for (const dep of effectSets) {
        dep.delete(effect);
      }
      this.effectDeps.delete(effect);
    }
  }
}

// Singleton instance
export const reactivityEngine = new ReactivityEngine();
```

**Critical fix in v1.5**: The `proxyCache` (WeakMap) ensures referential identity for deep reactivity. Without it, `this.user.profile !== this.user.profile` would evaluate to `true` because each access created a new Proxy wrapper. This caused subtle `===` check failures and unnecessary garbage collection. The cache guarantees: same object → same proxy, always.

### Batched Updates

```typescript
// diamond/runtime/scheduler.ts

export class Scheduler {
  private queue: Set<() => void> = new Set();
  private flushing = false;

  /**
   * Queue an effect to run on next microtask.
   * Duplicate effects are deduplicated via Set.
   */
  queueEffect(effect: () => void): void {
    this.queue.add(effect);

    if (!this.flushing) {
      this.flushing = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush(): void {
    const effects = Array.from(this.queue);
    this.queue.clear();
    this.flushing = false;

    for (const effect of effects) {
      try {
        effect();
      } catch (error) {
        console.error('[Diamond] Effect execution error:', error);
      }
    }
  }
}

export const scheduler = new Scheduler();
```

### Binding Functions

```typescript
// diamond/runtime/core.ts

export class DiamondCore {
  /**
   * Make an object reactive using Proxy
   */
  static reactive<T extends object>(obj: T): T {
    return reactivityEngine.createProxy(obj);
  }

  /**
   * Make a specific property on an object reactive.
   * Used by the @reactive decorator compilation.
   */
  static makeReactive(target: object, property: string): void {
    const value = (target as any)[property];
    if (value !== null && typeof value === 'object') {
      (target as any)[property] = reactivityEngine.createProxy(value);
    }
    // For primitives, the decorator getter/setter handles tracking
  }

  /**
   * Run function and re-run when dependencies change
   */
  static effect(fn: () => void): () => void {
    return reactivityEngine.createEffect(fn);
  }

  /**
   * Computed value (cached, only recalculates when deps change)
   */
  static computed<T>(getter: () => T): () => T {
    return reactivityEngine.createComputed(getter);
  }

  /**
   * Create high-performance Collection for large datasets
   */
  static collection<T>(items: T[] = []): Collection<T> {
    return new Collection(items);
  }

  /**
   * Bind a DOM element property to a reactive getter.
   * Optionally supports two-way binding with a setter.
   */
  static bind(
    element: HTMLElement,
    property: string,
    getter: () => unknown,
    setter?: (value: unknown) => void
  ): () => void {
    const el = element as unknown as Record<string, unknown>;

    const cleanupEffect = this.effect(() => {
      el[property] = getter();
    });

    let cleanupListener: (() => void) | null = null;
    if (setter) {
      const eventName = this.getInputEventName(element);
      const handler = () => setter(el[property]);
      element.addEventListener(eventName, handler);
      cleanupListener = () => element.removeEventListener(eventName, handler);
    }

    return () => {
      cleanupEffect();
      cleanupListener?.();
    };
  }

  /**
   * Attach an event listener
   */
  static on(
    element: HTMLElement,
    event: string,
    handler: (e: Event) => void,
    capture = false
  ): () => void {
    element.addEventListener(event, handler, capture);
    return () => element.removeEventListener(event, handler, capture);
  }

  /**
   * Event delegation — attach handler to parent for child elements
   */
  static delegate(
    parent: HTMLElement,
    event: string,
    selector: string,
    handler: (e: Event) => void
  ): () => void {
    const delegateHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.matches(selector)) {
        handler(e);
      }
    };
    parent.addEventListener(event, delegateHandler);
    return () => parent.removeEventListener(event, delegateHandler);
  }

  private static getInputEventName(element: HTMLElement): string {
    if (element instanceof HTMLInputElement) {
      return (element.type === 'checkbox' || element.type === 'radio') ? 'change' : 'input';
    }
    if (element instanceof HTMLSelectElement) return 'change';
    return 'input';
  }
}
```

---

## Performance-Optimized Collections

### The Collection Class

**Problem**: Reactive proxies degrade on large arrays (append time increases from 0.01ms to 0.2ms at 100K items).

**Solution**: Specialized `Collection<T>` class for append-heavy workloads.

**The Zen**: This is not a workaround. This is "physics, not magic." When the data is small (forms, UI toggles), proxies are the right tool — automatic, ergonomic. When the data is large (100K log lines, chat histories), the physics changes. `Collection` is the right tool for that physics. The framework explains this transition; it doesn't hide it.

```typescript
// diamond/runtime/collection.ts

/**
 * High-performance collection for large datasets.
 *
 * Use when:
 * - Dataset > 1,000 items
 * - Append-heavy workload (logs, chat, terminal)
 * - Search/filter operations needed
 *
 * Performance:
 * - O(1) constant time appends (0.005ms regardless of size)
 * - Direct array access (no proxy overhead)
 * - Minimal memory footprint (~248 bytes per item)
 */
export class Collection<T> {
  private items: T[];
  private onChange: ((items: T[]) => void)[] = [];
  private onAppend: ((item: T, index: number) => void)[] = [];

  constructor(items: T[] = []) {
    this.items = items;
  }

  push(item: T): number {
    const index = this.items.length;
    this.items.push(item);
    this.notifyAppend(item, index);
    return index;
  }

  get(index: number): T { return this.items[index]; }
  get length(): number { return this.items.length; }
  slice(start: number, end?: number): T[] { return this.items.slice(start, end); }
  filter(predicate: (item: T, i: number) => boolean): T[] { return this.items.filter(predicate); }
  map<U>(mapper: (item: T, i: number) => U): U[] { return this.items.map(mapper); }
  toArray(): readonly T[] { return this.items; }

  subscribe(handler: (items: T[]) => void): () => void {
    this.onChange.push(handler);
    return () => {
      const i = this.onChange.indexOf(handler);
      if (i > -1) this.onChange.splice(i, 1);
    };
  }

  subscribeAppend(handler: (item: T, index: number) => void): () => void {
    this.onAppend.push(handler);
    return () => {
      const i = this.onAppend.indexOf(handler);
      if (i > -1) this.onAppend.splice(i, 1);
    };
  }

  search(predicate: (item: T, i: number) => boolean): number[] {
    const results: number[] = [];
    for (let i = 0; i < this.items.length; i++) {
      if (predicate(this.items[i], i)) results.push(i);
    }
    return results;
  }

  clear(): void {
    this.items = [];
    this.notifyChange();
  }

  private notifyAppend(item: T, index: number): void {
    for (const handler of this.onAppend) {
      try { handler(item, index); }
      catch (e) { console.error('[Diamond] Collection append handler error:', e); }
    }
  }

  private notifyChange(): void {
    for (const handler of this.onChange) {
      try { handler(this.items); }
      catch (e) { console.error('[Diamond] Collection change handler error:', e); }
    }
  }
}
```

### Decision Matrix: Reactive vs Collection

| Criteria | Use `@reactive` / Proxy | Use `Collection` |
|----------|------------------------|-----------------|
| **Size** | < 1,000 items | > 1,000 items |
| **Pattern** | Update-heavy | Append-heavy |
| **Visibility** | All visible | Virtual scrolling |
| **Examples** | Forms, UI state, small grids | Logs, chat, terminal, large lists |
| **Memory** | Higher (tracking overhead) | Lower (plain array) |
| **Append Speed** | Degrades (0.01ms → 0.2ms) | Constant (0.005ms) |
| **Developer UX** | Automatic | Explicit subscribe |

---

## Build System

### Parcel 2 Plugin Architecture

**Primary Target**: Parcel 2 (focus 100% here for v1.0).

**Why Parcel**: Zero-configuration philosophy. No `vite.config.js`, no `webpack.config.js`. The `.parcelrc` file is two lines. This aligns with DiamondJS's "decisions decrease energy" principle. The decision was validated empirically against Vite and Webpack during Phase 0 research.

#### Parcel Transformer (v1.5 — Instance Method Output)

```typescript
// parcel-transformer-diamond/src/index.ts

import { Transformer } from '@parcel/plugin';
import { DiamondCompiler } from 'diamond-compiler';

export default new Transformer({
  async loadConfig({ config }) {
    const configFile = await config.getConfig(['diamond.config.js']);
    return configFile?.contents ?? {};
  },

  async transform({ asset, config }) {
    if (asset.type !== 'html') return [asset];

    const compiler = new DiamondCompiler(config);
    const source = await asset.getCode();

    // v1.5: Compile to instance method with [Diamond] hints
    const compiled = compiler.compileTemplate(source, {
      filePath: asset.filePath,
      sourceMap: true,
      emitHints: true,        // [Diamond] comments
      methodType: 'instance'  // createTemplate() as instance method
    });

    asset.type = 'js';
    asset.setCode(compiled.code);
    if (compiled.map) asset.setMap(compiled.map);

    // HMR: recompile when component .ts changes
    const componentPath = asset.filePath.replace('.html', '.ts');
    asset.addDependency({ specifier: componentPath, specifierType: 'esm' });

    return [asset];
  }
});
```

### Compiler-Emitted Semantic Hints

This is a **first-class feature** of the DiamondJS build system, not an optional debug flag.

The compiler emits `[Diamond]` prefixed comments in all generated code. These comments serve dual purposes:

1. **LLM Comprehension**: An LLM reading compiled output is *told* explicitly what the compiler did. It doesn't have to infer or guess. This eliminates the tribal knowledge problem where "you just have to know" what a framework transformation does.

2. **Human Debugging**: A developer stepping through compiled code sees annotations explaining the provenance of each generated line. This is especially valuable when the developer didn't write the template themselves (onboarding, code review, debugging a colleague's component).

**Hint Categories**:

```javascript
// Component-level hints
// [Diamond] Component: UserProfile
// [Diamond] Reactive properties: name, email, avatar

// Binding hints
// [Diamond] Two-way binding: value ↔ this.name
// [Diamond] One-way binding: textContent ← this.message
// [Diamond] Event binding: click → this.handleSave()

// Control flow hints
// [Diamond] Conditional: if.bind="isLoggedIn"
// [Diamond] Repeat: repeat.for="item of items"

// Alias hints
// [Diamond] Alias expansion: profile.name → userProfileService.name

// Decorator hints
// [Diamond] @reactive → auto-tracked via DiamondCore
// [Diamond] Non-reactive (no decorator)
```

### Project Structure

```bash
my-diamond-app/
├── .parcelrc                    # Parcel configuration (2 lines)
├── diamond.config.js            # DiamondJS options
├── package.json
├── src/
│   ├── index.html               # Entry point
│   ├── main.ts                  # Bootstrap
│   ├── routes.ts                # Single router config
│   └── components/
│       ├── my-component/        # Nested mode: folder per component
│       │   ├── my-component.ts  # Component class + @reactive
│       │   ├── my-component.html# Template (compiled by transformer)
│       │   └── my-component.css # Styles
│       └── ... or flat mode:
│           ├── my-component.ts
│           ├── my-component.html
│           └── my-component.css
└── node_modules/
    ├── @diamondjs/runtime/
    ├── @diamondjs/compiler/
    └── parcel-transformer-diamond/
```

#### Zero-Config Developer Experience

```bash
# Install
npm install @diamondjs/runtime @diamondjs/compiler parcel-transformer-diamond

# Run
npx parcel src/index.html
```

No `vite.config.js`, no `webpack.config.js` — just `.parcelrc` with two lines.

### Source Maps

Every compiled file must have a source map. When an error occurs, browser DevTools shows the original template syntax, not the compiled output.

---

## Runtime API

### Public API Surface

```typescript
// @diamondjs/runtime

// === Core ===
export { Component } from './component';
export { DiamondCore } from './core';

// === Decorator ===
export { reactive } from './decorators';

// === Convenience Exports ===
export const { effect, computed, collection, bind, on, delegate } = DiamondCore;

// === Advanced ===
export { Collection } from './collection';

// === Optional Services ===
export { Router } from './router';
export { Store } from './store';
export { MessageBus } from './message-bus';

// === Utilities ===
export { BrowserPrint } from './browser-logger';
```

Small, focused, comprehensible. ~15 exports total.

---

## Scaffolding & Developer Experience

### The Scaffold System

The scaffold is the first thing a developer interacts with. It must make them feel like DiamondJS "just works."

**When the scaffold runs, it asks:**

1. **Component organization**: Flat (all files in one folder) or nested (folder per component)?
2. **Language**: TypeScript or JavaScript?
3. **Server**: The default scaffold outputs a project with Bun + Express as the backend server, with Parcel handling the frontend compilation. The developer gets a working full-stack project from the first command.

**What the scaffold generates:**

- All configuration files pre-populated (`.parcelrc`, `diamond.config.js`, `tsconfig.json` if TS)
- A working example component with `@reactive` properties
- Comment headers in every generated file explaining conventions
- A `README.md` with exactly enough to get started
- Router configuration with a home route

**TypeScript vs JavaScript**: Both are first-class. When JS is chosen, the compiler still processes templates and emits hints. The `@reactive` decorator works in both via Parcel's transformer. TypeScript adds type safety at the cost of `tsconfig.json` — which the scaffold generates with sensible defaults including `experimentalDecorators: true`.

### Comment Headers (Convention Documentation)

Every scaffold-generated file includes a comment header that documents the conventions at play:

```typescript
// ──────────────────────────────────────────────────────────
// [Diamond] Component: TodoItem
// [Diamond] Convention: Flat mode — all triplet files in /src/components/
// [Diamond] Files: todo-item.ts + todo-item.html + todo-item.css
// [Diamond] Kebab-case filename maps to PascalCase class: TodoItem
// ──────────────────────────────────────────────────────────

// Or in nested mode:
// ──────────────────────────────────────────────────────────
// [Diamond] Component: TodoItem
// [Diamond] Convention: Nested mode — folder /src/components/todo-item/
// [Diamond] Files: todo-item/todo-item.ts + todo-item.html + todo-item.css
// [Diamond] Kebab-case folder & filename maps to PascalCase class: TodoItem
// ──────────────────────────────────────────────────────────
import { Component, reactive } from 'diamond';

export class TodoItem extends Component {
  @reactive text = '';
  @reactive completed = false;
}
```

---

## Router

### Design: One Router, Extensible via Inheritance

DiamondJS ships exactly **one** router. We don't offer twelve routing libraries. The core router handles the 90% case. For the 10% that needs customization, the router is designed for extension via standard class inheritance.

```typescript
// diamond/runtime/router.ts

export interface Route {
  path: string;
  component: new () => Component;
  guard?: (params: Record<string, string>) => boolean | Promise<boolean>;
  children?: Route[];
}

/**
 * Router — single-page application routing.
 *
 * Designed for extension: developers can extend this class
 * to customize matching, guards, transitions, or any behavior.
 * We don't hide the internals — the linkages between router
 * and framework are transparent and documented.
 */
export class Router {
  protected routes: Route[] = [];
  protected outlet: HTMLElement | null = null;
  protected currentComponent: Component | null = null;

  register(routes: Route[]): void {
    this.routes = routes;
  }

  setOutlet(element: HTMLElement): void {
    this.outlet = element;
  }

  start(): void {
    window.addEventListener('popstate', () => this.handleNavigation());
    this.handleNavigation();
  }

  navigate(path: string): void {
    history.pushState({}, '', path);
    this.handleNavigation();
  }

  protected handleNavigation(): void {
    const path = window.location.pathname;
    const match = this.matchRoute(path);
    if (match) {
      this.renderRoute(match.route, match.params);
    }
  }

  protected matchRoute(path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      const params = this.extractParams(route.path, path);
      if (params !== null) return { route, params };
    }
    return null;
  }

  protected extractParams(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return params;
  }

  protected async renderRoute(route: Route, params: Record<string, string>): Promise<void> {
    // Run guard if present
    if (route.guard) {
      const allowed = await route.guard(params);
      if (!allowed) return;
    }

    // Unmount old
    if (this.currentComponent) {
      this.currentComponent.unmount();
    }

    // Mount new
    const component = new route.component();
    component.update(params as any);
    component.mount(this.outlet!);
    this.currentComponent = component;
  }
}

export const router = new Router();
```

**Extension example** — a developer who needs animated transitions:

```typescript
import { Router } from 'diamond';

export class AnimatedRouter extends Router {
  protected async renderRoute(route, params) {
    if (this.currentComponent) {
      await this.animateOut(this.currentComponent);
    }
    await super.renderRoute(route, params);
    if (this.currentComponent) {
      await this.animateIn(this.currentComponent);
    }
  }

  private animateOut(component: Component): Promise<void> { /* ... */ }
  private animateIn(component: Component): Promise<void> { /* ... */ }
}
```

The framework makes this riffing "enjoyably easy" by keeping all methods `protected` and the class structure transparent.

---

## Optional Services

### Store (Simple Reactive State)

```typescript
export class Store<T extends object> {
  private state: T;

  constructor(initialState: T) {
    this.state = DiamondCore.reactive(initialState);
  }

  getState(): T { return this.state; }

  setState(updates: Partial<T>): void {
    Object.assign(this.state, updates);
  }

  subscribe(handler: (state: T) => void): () => void {
    return DiamondCore.effect(() => handler(this.state));
  }
}
```

### MessageBus (Pub/Sub)

```typescript
export class MessageBus {
  private channels = new Map<string, Set<(msg: any) => void>>();

  subscribe<T>(channel: string, handler: (msg: T) => void): () => void {
    if (!this.channels.has(channel)) this.channels.set(channel, new Set());
    this.channels.get(channel)!.add(handler);
    return () => {
      this.channels.get(channel)?.delete(handler);
      if (this.channels.get(channel)?.size === 0) this.channels.delete(channel);
    };
  }

  publish<T>(channel: string, message: T): void {
    this.channels.get(channel)?.forEach(handler => {
      try { handler(message); }
      catch (e) { console.error(`[Diamond] MessageBus error on ${channel}:`, e); }
    });
  }
}

export const messageBus = new MessageBus();
```

These patterns (pub/sub, message buses, queues, ring buffers) should be a *pleasure* to implement with DiamondJS handling the drudgery of the web app layer.

---

## Success Metrics

### LLM Comprehension — The Ultimate Test

**Methodology**: Create working component, introduce subtle bug, provide compiled output to LLM, measure diagnosis time and success rate.

| Metric | Tier 1 (Frontier) | Tier 2 (Mid) | Tier 3 (Small) | Tier 4 (Target: 32B) |
|--------|-------------------|--------------|-----------------|---------------------|
| Success Rate | 100% | 95% | 85% | **80%** |
| Avg Time | < 10s | < 15s | < 30s | **< 30s** |
| Clarifications | 0 | 0-1 | 1-2 | **< 2** |

**Baseline (Aurelia 2.0)**: The "White Screen of Death" — Tier 1 models FAILED after 2 hours.

**DiamondJS Target**: Tier 4 models succeed in < 30 seconds.

### Technical Metrics

1. **Runtime Size**: < 20KB gzipped
2. **Compilation Speed**: < 3s for 50-component project
3. **HMR Speed**: < 100ms
4. **Type Coverage**: 100% of public API

---

## Implementation Roadmap

### Phase 0: Proof of Concept ✅ COMPLETE

120+ passing tests, 80%+ coverage, 21% of LOC budget used.

### Phase 1: Architectural Pivot (v1.5)

**Goal**: Implement the three v1.5 changes.

**Deliverables**:
- [ ] Kill static `createTemplate()` → instance method
- [ ] Fix proxy cache (WeakMap for referential identity)
- [ ] Implement `@reactive` property decorator
- [ ] Compiler emits `[Diamond]` hint comments
- [ ] Update all existing tests
- [ ] Benchmark: instance method vs static factory (confirm negligible difference)

### Phase 2: Core Binding System

**Goal**: All binding commands functional with `this` references.

**Deliverables**:
- [ ] All binding commands (`.bind`, `.one-time`, `.two-way`, `.trigger`, `.delegate`, `.capture`)
- [ ] Value converters (`|` syntax)
- [ ] Binding behaviors (`&` syntax)
- [ ] `with.bind` alias expansion (build-time)
- [ ] Test suite: 50 binding scenarios

### Phase 3: Template Controllers

**Goal**: Conditional rendering & loops

**Deliverables**:
- [ ] `if.bind` / `else` compilation
- [ ] `repeat.for` runtime (~500 LOC)
- [ ] Array observation & diffing with keyed updates
- [ ] View lifecycle for loops

### Phase 4: Scaffolding & Router

**Goal**: Zero-to-running-app experience

**Deliverables**:
- [ ] CLI scaffold with flat/nested, TS/JS choices
- [ ] Bun + Express default backend
- [ ] Router with navigation guards and lazy loading
- [ ] Comment headers in all generated files
- [ ] All config files pre-generated

### Phase 5: Polish & LLM Testing

**Goal**: Production-ready for early adopters

**Deliverables**:
- [ ] LLM comprehension test harness
- [ ] TypeScript `.d.ts` files
- [ ] Documentation site
- [ ] Example apps (counter, todo, terminal, datagrid)
- [ ] Bundle size analysis

---

## Performance Analysis

### Scenario 1: Datagrid (10K Rows, Update-Heavy)

| Approach | Per Cell | 100K Cells | Notes |
|----------|----------|------------|-------|
| Reactive Proxy | 1,100 bytes | ~105 MB | Automatic tracking |
| Class Instances | 850 bytes | ~81 MB | Manual, explicit |
| Collection | 248 bytes | ~24 MB | Append-optimized |

### Scenario 2: Terminal (100K Lines, Append-Heavy)

| Approach | At 1K | At 10K | At 100K | Scales? |
|----------|-------|--------|---------|---------|
| Reactive Proxy | 0.01ms | 0.05ms | **0.2ms** | ❌ Degrades |
| Collection | 0.005ms | 0.005ms | **0.005ms** | ✅ Constant |

### Instance Method vs Static Factory (v1.5 Justification)

For target applications (<50K LOC, 50-200 live component instances):

| Metric | Static Factory | Instance Method | Difference |
|--------|---------------|-----------------|------------|
| Memory per instance | ~2KB less | ~2KB more | **Negligible** |
| Mount time | ~0.01ms faster | ~0.01ms slower | **Negligible** |
| Developer cognitive load | **High** (vm/self/this split) | **Zero** (this everywhere) | **Massive** |
| LLM comprehension | Medium (must understand static context) | **High** (standard class) | **Significant** |

The `Collection` class handles data scaling. The component shell doesn't need to scale the same way. The trade-off is clear: kilobytes of memory vs. the developer's mental model. We chose the developer.

---

## Appendices

### Appendix A: LOC Budget Breakdown

```
@diamondjs/runtime/
├── core.ts               ~350 LOC  (DiamondCore + makeReactive)
├── reactivity.ts         ~250 LOC  (ReactivityEngine with proxy cache)
├── collection.ts         ~200 LOC  (Collection class)
├── component.ts          ~100 LOC  (Component base class — simplified)
├── decorators.ts         ~50 LOC   (@reactive decorator)
├── scheduler.ts          ~50 LOC   (microtask batching)
├── binding.ts            ~150 LOC  (bind, on, delegate utilities)
├── repeat.ts             ~500 LOC  (repeat.for with diffing)
├── conditional.ts        ~100 LOC  (if/else rendering)
├── lifecycle.ts          ~100 LOC  (mount/unmount orchestration)
├── router.ts             ~400 LOC  (extensible routing)
├── store.ts              ~80 LOC   (reactive state management)
├── message-bus.ts        ~80 LOC   (pub/sub)
├── browser-logger.ts     ~200 LOC  (structured logging)
└── index.ts              ~30 LOC   (public API surface)
                          ─────────
TOTAL:                    ~2,640 LOC (within budget)
```

```
@diamondjs/compiler/
├── parser.ts             ~500 LOC  (parse5 wrapper)
├── transformer/
│   ├── bindings.ts       ~400 LOC  (binding commands)
│   ├── controllers.ts    ~400 LOC  (if/repeat/with)
│   ├── converters.ts     ~200 LOC  (value converters)
│   ├── behaviors.ts      ~200 LOC  (binding behaviors)
│   ├── components.ts     ~300 LOC  (custom elements)
│   └── decorators.ts     ~200 LOC  (@reactive transformation)
├── hints.ts              ~150 LOC  ([Diamond] comment generation)
├── generator.ts          ~800 LOC  (code generation — instance methods)
├── manifest.ts           ~400 LOC  (component discovery)
├── sourcemap.ts          ~300 LOC  (source map generation)
└── index.ts              ~200 LOC  (public API)
                          ─────────
TOTAL:                    ~4,050 LOC (within budget)
```

### Appendix B: Key Architectural Decisions

| # | Decision | Rationale | Status |
|---|----------|-----------|--------|
| 1 | No constructor DI magic | LLMs need vanilla ES2022+ | ✅ Locked |
| 2 | Hybrid reactive system | Optimal for all workloads | ✅ Locked |
| 3 | Collection class | Constant-time appends for large data | ✅ Locked |
| 4 | 4-hook lifecycle | Reduced from 8, still complete | ✅ Locked |
| 5 | Build-time only compiler | Browser never sees parser | ✅ Locked |
| 6 | Parcel-first strategy | Zero-config, empirically validated | ✅ Locked |
| 7 | Source maps required | Debug original template syntax | ✅ Locked |
| 8 | **Instance `createTemplate()`** | **Gives `this` back everywhere** | ✅ Locked (v1.5) |
| 9 | **Property-level `@reactive`** | **Explicit intent, no YOLO mode** | ✅ Locked (v1.5) |
| 10 | **Compiler `[Diamond]` hints** | **Self-documenting compiled output** | ✅ Locked (v1.5) |
| 11 | **Proxy cache (WeakMap)** | **Referential identity for deep reactivity** | ✅ Locked (v1.5) |
| 12 | **No class-level `@reactive`** | **Clarity > convenience** | ✅ Locked (v1.5) |
| 13 | Single extensible router | One router, extend via inheritance | ✅ Locked (v1.5) |
| 14 | Scaffold with comment headers | Zero implicit guessing | ✅ Locked (v1.5) |
| 15 | Bun + Express default server | Full-stack from first command | ✅ Locked (v1.5) |

### Appendix C: Framework Comparisons

#### DiamondJS vs Aurelia 2.0

| Aspect | Aurelia 2.0 | DiamondJS v1.5 |
|--------|-------------|----------------|
| **Runtime Size** | 50KB+ | < 20KB |
| **Template Syntax** | `.bind`, `repeat.for` | Same (preserved!) |
| **DI System** | Yes, complex | No, explicit imports |
| **Reactivity** | SetterObserver (magic) | `@reactive` + Proxy (explicit) |
| **Template Reference** | Varies (`this`, `vm`, scope) | **`this` everywhere** |
| **Large Datasets** | Not optimized | Collection class |
| **Lifecycle Hooks** | 8 hooks | 4 hooks |
| **LLM Debuggable** | ❌ Failed | ✅ Target: 80% success |
| **Compiled Output** | Opaque | Self-documenting (`[Diamond]` hints) |

#### DiamondJS vs React

| Aspect | React | DiamondJS v1.5 |
|--------|-------|----------------|
| **Template** | JSX | HTML templates |
| **Reactivity** | useState/useReducer | `@reactive` + Proxy |
| **Component Model** | Functions (hooks) | Classes |
| **State Reference** | `state.count` / `setCount` | `this.count` |
| **Large Lists** | useCallback / useMemo | Collection class |
| **LLM Friendly** | Medium (hook rules) | High (explicit, annotated) |

#### DiamondJS vs Vue 3

| Aspect | Vue 3 | DiamondJS v1.5 |
|--------|-------|----------------|
| **Template** | Similar syntax | Similar syntax |
| **Reactivity** | `ref()` / `reactive()` | `@reactive` decorator |
| **Component Model** | Options / Composition | Classes |
| **Dual Referencing** | `.value` unwrapping | **None — `this` everywhere** |
| **LLM Friendly** | High | Higher (compiler hints) |

**DiamondJS Unique Value**:
1. Only framework explicitly designed for human-LLM collaborative development
2. Compiler-emitted semantic hints — self-documenting compiled output
3. Universal `this` — zero referent confusion
4. Hybrid reactivity optimized for both small UI state and large datasets
5. Class-based throughout — GoF and OOP patterns are first-class citizens

---

## Conclusion

DiamondJS v1.5 represents a maturation from architectural specification to lived philosophy. The three v1.5 changes — instance templates, `@reactive` decorators, and compiler hints — are not features added to a framework. They are the removal of contradictions from a worldview.

The highest praise for DiamondJS is that the developer barely noticed it was there.

---

*"Give the developers back their `this`. That single move will do more for your Zen and Ergonomics than any other feature."*
