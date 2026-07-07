# 💎 DiamondJS

**The first JavaScript framework designed for the human-LLM collaborative development era.**

Build-time magic. Runtime honesty. `this` everywhere.

---

## What is DiamondJS?

DiamondJS is a component-based JavaScript framework that separates *write-time ergonomics* from *debug-time transparency* via build-time compilation. You write intuitive, Aurelia-inspired template syntax. The compiler transforms it into completely transparent JavaScript that both humans and AI models can debug instantly — with semantic hint comments explaining every transformation.

```html
<!-- counter.html — what you write -->
<div class="counter">
  <button click.calls="decrement()">-</button>
  <span>${count}</span>
  <button click.calls="increment()">+</button>
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
<button click.calls="save()">Save</button>

<!-- Interpolation -->
<p>Hello, ${name}!</p>

<!-- Conditional rendering: bare `if` controls whether the element is in the DOM -->
<div if="isLoggedIn">Welcome back</div>
<div else-if="!isLoggedIn">Please sign in</div>

<!-- List rendering -->
<ul>
  <li repeat.for="item of items">${item.name}</li>
</ul>

<!-- v2.1: exhaustive multi-state with a scoped catch-all (no positional else) -->
<switch on="status">
  <case if="loading"><div>Loading…</div></case>
  <case if="ready"><div>Ready</div></case>
  <default><div>Unexpected state: ${status}</div></default>
</switch>

<!-- v2.1: attribute spread — each key gates against the allowlist at runtime -->
<input value.two-way="draft" ...attrs.bind="inputAttrs">

<!-- v2.1: converter error surface — target becomes ordinary reactive state -->
<input value.two-way="amount | CurrencyConverter('USD')" value.error-into="amountError">
<p if="amountError">${amountError}</p>
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
| `@diamondjs/runtime` | Reactivity, components, binding engine, scheduler, `Collection`, security allowlist | < 2,500 |
| `@diamondjs/compiler` | Template parser, code generator, hint emitter, source maps | < 5,000 |
| `@diamondjs/converters` | Currency/Date/Phone `format`/`parse` batteries | < 500 |
| `@diamondjs/primafacie` | The `Print(logType, message)` logging paradigm + pluggable sinks | < 400 |
| `parcel-transformer-diamond` | Zero-config Parcel 2 integration | < 300 |

The entire framework fits in an LLM context window. That's not an accident — it's a design constraint.

---

## Current Status

**Specification**: v2.1 ([v2.0 DDR](impl_docs/plans/DiamondJS_v2.0_Design_Decision_Record.md) + [Amendment A2 — the v2.1 design record](impl_docs/plans/DiamondJS_v2.1_Amendment_A2_Design_Record.md))

**Implementation**: v2.1 — the scale-and-completeness release on top of v2.0's security-by-default binding language. `<switch>/<case>/<default>` (with a compile-time static fast path), runtime-gated attribute spread (`...attrs.bind`), `Collection<T>` for tens of thousands of never-proxied items, `DiamondCore.delegate` (one container listener resolving events back to data items), multi-segment two-way converter chains with fail-fast inversion, the `error-into` validation surface, `<!-- @import -->` provenance for standalone templates, real VLQ source maps, §5.6 barrel/re-export following, and the `@diamondjs/primafacie` logging paradigm.

| Package | LOC | Tests |
|---------|-----|-------|
| @diamondjs/runtime | 863 | 119 |
| @diamondjs/compiler | 4,144 | 218 |
| @diamondjs/converters | 84 | 11 |
| @diamondjs/primafacie | 262 | 8 |
| parcel-transformer-diamond | 300 | 30 |
| hello-world (example) | — | 19 |
| **Total** | **5,653 / 8,700** | **405** |

**What works today (v2.1)**: everything from v2.0 (security allowlist + `raw` escape hatch + stink gate; `set`/`rawSet`, `.calls`, `.capture`; `if`/`else-if`/`repeat.for`; converter pipes + `ParseResult` + batteries; `update-on` + `debounce`/`throttle`; `[Diamond]` hints; Parcel pipeline) **plus**: `switch`/`case`/`default`, `...attrs.bind`/`.rawBind`, `data-*`/`aria-*` attribute bindings, `Collection<T>` + `DiamondCore.collection()`, `DiamondCore.delegate()`, two-way converter chains, `value.error-into`, `@import` template provenance, VLQ source maps, re-export-aware converter verification, holistic root cleanup on unmount, and primafacie logging.

> DiamondJS is in active development, having said that the API is less likely to change suddenly now in v2.1

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
git clone https://github.com/Node0/diamondjs.git
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

**Joe Hacobian** — ex-JPL engineer turned framework architect.

*"The highest praise for DiamondJS is that the developer barely noticed it was there."*
