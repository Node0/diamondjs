# 💎 DiamondJS

**The first JavaScript framework designed for the human-LLM collaborative development era.**

Build-time magic. Runtime honesty. `this` everywhere.

---

## What is DiamondJS?

DiamondJS is a component-based JavaScript framework that separates *write-time ergonomics* from *debug-time transparency* via build-time compilation. You write intuitive, Aurelia-inspired template syntax. The compiler transforms it into completely transparent JavaScript that both humans and AI models can debug instantly — with semantic hint comments explaining every transformation.

```html
<!-- counter.html — what you write -->
<div class="counter">
  <button click.trigger="decrement()">-</button>
  <span>${count}</span>
  <button click.trigger="increment()">+</button>
</div>
```

```typescript
// counter.ts — what you write
import { Component, reactive } from '@diamondjs/runtime';

export class Counter extends Component {
  @reactive count = 0;

  increment() { this.count++; }
  decrement() { this.count--; }
}
```

```javascript
// What the compiler produces — what you debug
// [Diamond] Component: Counter
// [Diamond] Reactive properties: count

export class Counter extends Component {
  @reactive count = 0;

  increment() { this.count++; }
  decrement() { this.count--; }

  // [Diamond] Compiler-generated instance template method
  createTemplate() {
    const div = document.createElement('div');
    div.className = 'counter';

    const button1 = document.createElement('button');
    // [Diamond] Event binding: click → decrement()
    DiamondCore.on(button1, 'click', () => this.decrement());
    button1.textContent = '-';

    const span = document.createElement('span');
    // [Diamond] Binding reactive property 'count' → textContent
    DiamondCore.bind(span, 'textContent', () => this.count);

    const button2 = document.createElement('button');
    // [Diamond] Event binding: click → increment()
    DiamondCore.on(button2, 'click', () => this.increment());
    button2.textContent = '+';

    div.append(button1, span, button2);
    return div;
  }
}
```

No virtual DOM. No runtime template parsing. No hidden state. Every `DiamondCore` call in the compiled output has a `[Diamond]` comment above it explaining exactly what it does and why.

---

## Why DiamondJS?

Modern frameworks create debugging nightmares. Dependency injection magic, opaque runtime behavior, and hidden state lead to "White Screen of Death" scenarios where neither you nor your AI assistant can figure out what went wrong.

DiamondJS takes a different position: **complexity belongs in the compiler, not in the runtime or the developer's head.**

| | DiamondJS | React | Vue | Angular | Svelte |
|---|---|---|---|---|---|
| Runtime LOC | ~2,500 | ~42,000 | ~16,000 | ~65,000 | ~8,000 |
| Compiled output readable? | Yes, with hints | JSX transform | Proxy magic | Decorator DI | Custom format |
| LLM can debug it? | By design | Somewhat | Somewhat | Rarely | Somewhat |
| `this` means one thing? | Yes | No (`bind` hell) | Yes | Yes | N/A |

### The Zen of DiamondJS

1. **Show Your Work** — Every transformation is visible in compiled output
2. **Compiler Absorbs Complexity** — So the runtime and the developer don't have to
3. **Consistency Over Optimization** — Won't break your mental model to save 2MB of RAM
4. **Decisions Decrease Energy** — One router, one folder convention, one way to do things
5. **Physics, Not Magic** — When you hit a performance wall, the framework explains why and what to do
6. **Barely Noticed Is Victory** — The highest praise is that the framework felt like JavaScript with superpowers

---

## Quick Start

```bash
# Create a new project
mkdir my-app && cd my-app
npm init -y

# Install DiamondJS + Parcel integration
npm install @diamondjs/runtime @diamondjs/compiler parcel-transformer-diamond

# Configure Parcel (2 lines)
echo '{ "extends": "@parcel/config-default", "transformers": { "*.html": ["parcel-transformer-diamond", "..."] } }' > .parcelrc

# Start building
npx parcel src/index.html
```

No `vite.config.js`. No `webpack.config.js`. Just `.parcelrc` with two lines.

---

## Core Concepts

### Components

Every component is a TypeScript/JavaScript class that extends `Component`. Templates are separate `.html` files compiled at build time. The compiler generates an instance `createTemplate()` method that uses `this` to reference your properties and methods — the same `this` you use everywhere else in the class.

```typescript
import { Component, reactive } from '@diamondjs/runtime';

export class UserProfile extends Component {
  @reactive name = '';
  @reactive email = '';
  lastSaved = 0;             // Not reactive — internal bookkeeping

  async save() {
    await api.updateUser({ name: this.name, email: this.email });
    this.lastSaved = Date.now();
  }
}
```

Four lifecycle hooks, and that's it: `constructor` → `mount` → `update` → `unmount`.

### Reactivity

Decorate what you mean. `@reactive` properties drive the UI. Bare properties are inert. No class-level "YOLO mode" — you always know which properties will trigger re-renders.

For small UI state (forms, toggles, counters), `@reactive` is all you need. For large datasets (100K+ items, log viewers, chat histories), DiamondJS provides a high-performance `Collection<T>` class with O(1) append and 77% less memory than reactive proxies at scale.

```typescript
// Small state — use @reactive
@reactive searchQuery = '';
@reactive isOpen = false;

// Large dataset — use Collection
private logs = DiamondCore.collection<string>();
```

### Template Syntax

Aurelia-inspired binding commands on standard HTML attributes:

```html
<!-- One-way binding (property → DOM) -->
<h1 textcontent.bind="title"></h1>

<!-- Two-way binding (DOM ↔ property) -->
<input value.bind="name">

<!-- Event binding -->
<button click.trigger="save()">Save</button>

<!-- Interpolation -->
<p>Hello, ${name}!</p>

<!-- Conditional rendering -->
<div if.bind="isLoggedIn">Welcome back</div>

<!-- List rendering -->
<ul>
  <li repeat.for="item of items">${item.name}</li>
</ul>
```

---

## Project Structure

DiamondJS supports two component organization modes, chosen at scaffold time:

```bash
# Flat mode — all component files in one directory
src/components/
├── user-profile.ts
├── user-profile.html
├── user-profile.css
├── nav-bar.ts
├── nav-bar.html
└── nav-bar.css

# Nested mode — one directory per component
src/components/
├── user-profile/
│   ├── user-profile.ts
│   ├── user-profile.html
│   └── user-profile.css
└── nav-bar/
    ├── nav-bar.ts
    ├── nav-bar.html
    └── nav-bar.css
```

In nested mode, every file carries the component name — no `index.ts` ambiguity across tabs.

---

## Packages

| Package | Description | LOC Budget |
|---------|-------------|------------|
| `@diamondjs/runtime` | Reactivity, components, binding engine, scheduler | < 2,500 |
| `@diamondjs/compiler` | Template parser, code generator, hint emitter | < 5,000 |
| `parcel-transformer-diamond` | Zero-config Parcel 2 integration | < 300 |

The entire framework fits in an LLM context window. That's not an accident — it's a design constraint.

---

## Current Status

**Specification**: v1.5.1 ([Architecture & Design Specification](docs/DiamondJS_Architecture_Specification_v1_5_1.md))

**Implementation**: Phase 0 complete — proof of concept with end-to-end compilation pipeline.

| Package | LOC | Tests | Coverage |
|---------|-----|-------|----------|
| @diamondjs/runtime | 256 | 39 | 94.77% |
| @diamondjs/compiler | 1,268 | 64 | 97.26% |
| parcel-transformer-diamond | 139 | 17 | 100% |
| **Total** | **1,663** | **120** | **>80%** |

**What works today**: Reactive state, property bindings, event handlers, text interpolation, two-way input binding, Parcel build pipeline, HMR support.

**What's next**: v1.5.1 architectural upgrade (instance template methods, `@reactive` decorator, `[Diamond]` compiler hints, proxy cache fix), followed by conditional rendering, list rendering, router, and scaffolding CLI.

> ⚠️ DiamondJS is in active early development. The API will change. Use it to explore, experiment, and contribute — not yet for production.

---

## Design Constraints

These are non-negotiable architectural rules, not aspirational targets:

- **Runtime < 2,500 LOC** — Entire runtime fits in a single LLM context window
- **Compiler < 5,000 LOC** — Modular, each pass independently comprehensible
- **Zero runtime template parsing** — All compilation happens at build time
- **Source maps required** — Errors point to your `.html` template, not compiled JS
- **32B LLM comprehension** — Models achieve >80% bug-fix rate on compiled output
- **< 50,000 LOC total app target** — Framework + your code stays LLM-debuggable

---

## Built With

- [TypeScript](https://www.typescriptlang.org/) — ES2022+ target
- [Parcel 2](https://parceljs.org/) — Zero-config bundler
- [parse5](https://github.com/inikulin/parse5) — HTML parser with source locations
- [Vitest](https://vitest.dev/) — Test framework with 80%+ coverage enforcement

---

## Development

```bash
# Clone the repo
git clone https://github.com/AncientEntity/diamondjs.git
cd diamondjs

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Check LOC budgets
npm run check-loc

# Run hello world example
cd examples/hello-world
npm start
```

---

## Philosophy

DiamondJS exists because we believe the next decade of software development will be defined by human-LLM collaboration. Every framework design decision either helps or hinders that collaboration. Most frameworks were designed before this era and carry assumptions — opaque runtimes, hidden state, implicit behavior — that actively fight against it.

We chose to start over with one question: *What would a JavaScript framework look like if it assumed an AI model would be reading every line of compiled output?*

The answer is DiamondJS: a framework where the compiler does the hard work so the runtime can be radically transparent, where every transformation is documented in place, and where `this` means exactly one thing everywhere you use it.

---

## License

AGPL v3

---

## Author

**Joe Hacobian** — JPL'er engineer turned framework architect.

*"The highest praise for DiamondJS is that the developer barely noticed it was there."*
