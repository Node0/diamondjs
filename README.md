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
 
> **Note:** `@diamondjs/*` packages are not yet published to npm. The install lines below are the intended surface; today, the working path is cloning the monorepo (see [Development](#development)).
 
```bash
# Create a new project
mkdir my-app && cd my-app
npm init -y
 
# Install DiamondJS — one package for what ships to the browser,
# one for what runs at build time
npm install @diamondjs/app
npm install --save-dev @diamondjs/dev
 
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
 
## Routing (v2.2)
 
One router — meaning one *navigation authority*, not one view. Multiple named outlets, nested routes, guards, and typed URL params, all declared in a single statically-analyzable file. The route map is plain data: no decorators, no registration calls, no metadata lookup. Everything the router will ever do is visible in one place.
 
### The route map
 
```typescript
// app.routes.ts
import { IntConverter, SlugConverter } from '@diamondjs/converters';
import { IngestPage }        from './pages/ingest';
import { ResearchPage }      from './pages/research';
import { ReviewWorkspace }   from './pages/review-workspace';
import { DocumentViewer }    from './pages/document-viewer';
import { CitationInspector } from './pages/citation-inspector';
import { LibraryPage }       from './pages/library';
import { SettingsPanel }     from './pages/settings';
import { LoginPage }         from './pages/login';
import { NotFoundPage }      from './pages/not-found';
import { RequireLogin, RequireCorpusLoaded } from './guards/session';
 
import type { RouteMap } from '@diamondjs/runtime';
 
export const routes = {
 
  'root-redirect': {
    path: '/',
    redirect: { type: 'route-id', target: 'ingest' },
  },
 
  'ingest': {
    path: '/ingest',
    component: IngestPage,
    outlet: 'main',
    guard: RequireLogin,
  },
 
  'research': {
    path: '/research',
    component: ResearchPage,
    outlet: 'main',
    guard: RequireLogin,
  },
 
  'review': {
    path: '/review/:corpusId',
    component: ReviewWorkspace,          // declares <outlet name="content">
    outlet: 'main',
    params: { corpusId: SlugConverter }, // parse failure ⇒ route doesn't match
    guard: [RequireLogin, RequireCorpusLoaded],  // chain order; covers all children
 
    children: {
      'document': {
        path: 'documents/:docId',        // relative; full: /review/:corpusId/documents/:docId
        component: DocumentViewer,
        outlet: 'content',               // owned by 'review' — verified at build time
        params: { docId: IntConverter },
 
        children: {
          'citation': {
            path: 'citations/:citeId',
            component: CitationInspector,
            outlet: 'panel',             // root outlet — always a legal target
            params: { citeId: IntConverter },
          },
        },
      },
    },
  },
 
  'library': {
    path: '/library',
    component: LibraryPage,
    outlet: 'main',
    guard: RequireLogin,
  },
 
  'settings': {
    path: '/settings',
    component: SettingsPanel,
    outlet: 'overlay',                   // URL-addressable modal; CSS decides presentation
    guard: RequireLogin,
  },
 
  'login': {
    path: '/login',
    component: LoginPage,
    outlet: 'main',
  },
 
  'not-found': {
    path: '*',
    component: NotFoundPage,
    outlet: 'main',
  },
 
} satisfies RouteMap;
```
 
The grammar is deliberately crisp: `'route-id': { property: value }`. Route IDs are quoted lowercase kebab-case keys — enforced in your editor by `satisfies RouteMap`, and at build time by `route-check` with errors that name the fix. **Matching is by specificity, never declaration order** — static segments beat `:params`, `*` matches last, and reordering blocks can never change behavior. Every `:segment` requires a converter; params arrive in your component's constructor already parsed and typed (the same `ParseResult` contract as form `from-view` bindings — a failed parse simply means the route doesn't match).
 
### Outlets and boot
 
The app shell is an ordinary component. Persistent chrome (headers, nav, hamburgers) is ordinary markup; the router only ever touches `<outlet>` elements:
 
```html
<!-- app-shell.html -->
<header class="app-header">…</header>
<nav>
  <a href="/ingest">Ingest</a>
  <a href="/research">Research</a>
  <a href="/library">Library</a>
</nav>
 
<outlet name="main"></outlet>
<outlet name="panel"></outlet>
<outlet name="overlay"></outlet>
```
 
Links are plain `<a href>` — the router intercepts same-origin primary clicks and leaves middle-click, modifier-click, and external links to the browser. No `<RouterLink>` component to learn.
 
```typescript
// main.ts
import { Router } from '@diamondjs/runtime';
import { AppShell } from './app-shell';
import { routes } from './app.routes';
 
const shell = new AppShell();
shell.mount(document.getElementById('app')!);
 
const router = new Router(routes);   // { basePath: '/my-app' } when not at domain root
await router.start();                // guards run on the initial URL too
```
 
Navigation is a two-phase transaction: **all** guards for the whole plan run before **anything** mounts, then the commit is atomic — unmount outgoing (deepest-first), mount incoming (parent-first). A guard rejection means zero DOM change. One URL can drive several outlets at once: `/review/neuron-v2/documents/42/citations/9` mounts the workspace into `main`, the document into `content`, and the inspector into `panel` — and Back from there unmounts *only* the inspector. Deep links, reload, and Back/Forward always reconstruct the exact same UI.
 
Outlets are a closed, statically-declared world: `route-check` verifies at build time that every route targets an outlet that actually exists and is legally reachable — with errors that speak route IDs:
 
```
✖ unknown-redirect-target  Route 'home': unknown route ID 'corpora'.
                           Did you mean { type: 'route-path', target: '/corpora' }?
```
 
In dev mode (`app/config/config.json` → `run_mode: "dev"`), the router prints the entire resolved route table at startup through `Print` — one greppable line per route — so "where's the route map?" is answered by your console. The table (and every other dev-only path) is dead-code-eliminated from prod builds.
 
### Destinations
 
Redirects and guard denials speak one vocabulary: a `Destination` — an explicit tagged union, never inferred from string shape. Three concentric circles: `route-*` targets live inside the router's map, `site-path` is your origin beyond the SPA, `external-url` leaves entirely.
 
```typescript
// Inside the map — by ID (survives path refactors) or by path (params carry through)
redirect: { type: 'route-id',     target: 'ingest' }
redirect: { type: 'route-path',   target: '/review/:corpusId' }
 
// Same origin, different system — hard load (wiki, docs, legacy pages)
redirect: { type: 'site-path',    target: '/support/wiki' }
 
// Off origin — https only, static targets only (no :params — open-redirect rail)
redirect: { type: 'external-url', target: 'https://archive.org/details/diamondjs' }
```
 
`route-check` validates every arm: IDs must exist, `route-path` targets must match a route, `site-path` targets must *not* (a `site-path` that shadows an SPA route would hard-reload where SPA navigation was intended), redirect cycles are build errors, and non-`https` external schemes are rejected outright.
 
### Guards
 
A guard is a class with two static methods and a clean division of labor: `check` answers a pure yes/no question; `deny` says where a rejected navigation goes. Guards never navigate, never touch the DOM — `deny` returns a `Destination`, data the router executes.
 
```typescript
import { Guard, type GuardContext, type Destination } from '@diamondjs/runtime';
import { session } from '../services/session';
import { api } from '../services/api';
 
export class RequireLogin extends Guard {
  static check() { return session.user !== null; }
  static deny({ to }: GuardContext): Destination {
    return { type: 'route-id', target: 'login', query: { returnTo: to } };
  }
}
 
export class RequireCorpusLoaded extends Guard {
  static async check({ params }: GuardContext) {
    return api.corpusReady(params.corpusId as string);  // params arrive converter-parsed
  }
  // deny not overridden → base default: { type: 'route-id', target: 'not-found' }
  // The 403-vs-404 disclosure decision is literally "which method you override."
}
 
// Guards aren't just login. Collaborative lock, feature flags, client
// capability (WebGPU?), tenant boundaries, version skew — same shape:
export class RequireDocumentUnlocked extends Guard {
  static async check({ params }: GuardContext) {
    return !(await api.isLockedByOther(params.docId as number));
  }
  static deny({ params }: GuardContext): Destination {
    return { type: 'route-path', target: `/review/read-only/${params.docId}` };
  }
}
```
 
The router wraps every evaluation in an execution envelope that guard classes cannot override: a `check()` that **throws** denies, a `check()` that **hangs** denies after `Guard.timeoutMs` (default 5s), and every decision — allow, deny, throw, timeout — emits one narration line through `Print` with the guard name, route ID, outcome, and duration. Your log stream shows every authorization decision at the boundary. Fail closed, everywhere: even the base `check()` returns `false`.
 
Because `check` is a pure predicate, the same class serves other enforcement points — call `RequireDocumentUnlocked.check(ctx)` from a template `if`, a delegate handler, or a WebSocket message handler. One policy, many doors.
 
**One sentence to keep you honest:** client guards *predict*; servers *enforce*. A browser-side guard is UX and telemetry — real authorization lives at your API. DiamondJS says this about its own security feature so you don't learn it the hard way.
 
### Pending — departure safety
 
In-flight work (saves, uploads, sync flushes) registers itself with `Pending`; the framework warns on departure while anything is unsettled:
 
```typescript
async save() {
  await Pending.until(api.saveCorpus(this.corpus), 'corpus-save');
  this.toast('Saved');
}
```
 
`Pending.until` is a **passthrough** — it returns the same promise it was given, so it composes with everything (`await` it, `Promise.all` it, `try/finally` around it). The framework provides values; JavaScript provides control flow — the "then" is just the next line.
 
While the refcount is nonzero: closing the tab, reloading, or typing a new URL triggers the browser's native "leave site?" dialog, and in-app navigation asks for confirmation. When the count hits zero, the `beforeunload` handler is *removed* — a permanently-registered handler would disable the browser's back/forward cache for your whole app. `Pending.active` is reactive, so your save indicator and the departure warning read the same counter and can never disagree:
 
```html
<div class="status" if="Pending.active">Saving…</div>
```
 
Honest limitation, on the record: the browser's Back button *within* the SPA is not intercepted (vetoing an already-performed history move is a tar pit we've deliberately deferred) — such departures are narrated to the log, and in-flight promises still run to completion.
 
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
| `@diamondjs/runtime` | Reactivity, components, binding engine, scheduler, `Collection`, security allowlist, **Router, Guard, Pending** | < 2,500 |
| `@diamondjs/compiler` | Template parser, code generator, hint emitter, source maps | < 5,000 |
| `@diamondjs/converters` | `format`/`parse` batteries: Currency, Date, Phone, **Int, Slug** | < 500 |
| `@diamondjs/guards` | Policy batteries (scaffold — type re-exports today; `OAuthGuard`, `WebAuthnGuard`, `CapabilityGuard`, `TenantGuard` are recorded candidates awaiting a real-app guard inventory) | < 400 |
| `@diamondjs/primafacie` | The `Print(logType, message)` logging paradigm + pluggable sinks (console, WebSocket, datestamped files) | < 400 |
| `parcel-transformer-diamond` | Zero-config Parcel 2 integration + `run_mode` → `__DIAMOND_DEV__` injection | < 300 |
 
Converters are the data batteries; guards are the policy batteries.
 
Three meta-packages pin one tested constellation per release (exact versions, not ranges): **`@diamondjs/app`** (runtime + converters + primafacie + guards — what ships to the browser), **`@diamondjs/dev`** (compiler + parcel-transformer + the `stink-check` and `route-check` build gates), and **`@diamondjs/all`** (both).
 
The entire framework fits in an LLM context window. That's not an accident — it's a design constraint.
 
---
 
## Current Status
 
**Specification**: v2.2.1 ([v2.0 DDR](impl_docs/plans/DiamondJS_v2.0_Design_Decision_Record.md) + Amendment A2 (v2.1) + Amendment A3 and the v2.2 Router section + the v2.2.1 Destinations record)
 
**Implementation**: v2.2.1 — the routing release on top of v2.1's scale-and-completeness work. The full navigation stack: multi-outlet router with specificity matching and atomic two-phase commit, typed URL params through the converter/`ParseResult` contract, class-based guards with a fail-closed execution envelope, the four-arm `Destination` vocabulary shared by redirects and guard denials, `Pending` departure safety, `basePath` for sub-path deployments, the `route-check` build gate, dev-mode route-table narration via `run_mode`/`__DIAMOND_DEV__`, and the logging consolidation (one vocabulary: everything emits through `Print`; browser→server WebSocket log relay with datestamped server files). Plus the v2.1.1 conformance patch: eager disposal of detached `if`/`switch` branches, the scheduler stale-flush retention fix, `repeat` duplicate-primitive reconciliation, static-attribute sink gating, and fail-loud diagnostics for unshipped component composition.
 
| Package | Production LOC | Budget | Usage |
|---------|---------------:|-------:|------:|
| @diamondjs/runtime | 1,551 | 2,500 | 62.0% |
| @diamondjs/compiler | 2,267 | 5,000 | 45.3% |
| parcel-transformer-diamond | 164 | 300 | 54.7% |
| @diamondjs/converters | 123 | 500 | 24.6% |
| @diamondjs/primafacie | 300 | 400 | 75.0% |
| **Total** | **4,405** | **8,700** | **50.6%** |
 
**518 tests across 45 files**, all passing.
 
**What works today (v2.2.1)**: everything from v2.0 and v2.1 (security allowlist + `raw` escape hatch + stink gate; `set`/`rawSet`, `.calls`, `.capture`; `if`/`else-if`/`repeat.for`; `switch`/`case`/`default`; `...attrs.bind`; converter pipes + `ParseResult` + batteries; `Collection<T>`; `DiamondCore.delegate()`; `error-into`; VLQ source maps; `[Diamond]` hints; primafacie logging) **plus**: the `Router` (nested routes, named outlets, redirects, guards, `Pending`, `basePath`, link interception, popstate/initial-load guard coverage), `Destination`, `IntConverter`/`SlugConverter`, `route-check`, `run_mode` dev/prod builds, `wsReceiver` + datestamped `fileSink`, and the `app`/`dev`/`all` meta-packages.
 
> DiamondJS is in active development. The v2.x API surface is stabilizing; v2.2 marks the point where DiamondJS can single-handedly deliver multi-view SPAs — from presence sites to multi-user application frontends.
 
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
 
# Validate a route map against templates
npx route-check
 
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
