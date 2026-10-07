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
 
> All `@diamondjs/*` packages are live on npm — current release **v2.3.0** (October 2026; first published as v2.2.2 in August 2026). `bun add @diamondjs/app` works too — Bun installs from the npm registry. Release notes: [CHANGELOG.md](CHANGELOG.md).
 
```bash
# Create a new project
mkdir my-app && cd my-app
npm init -y
 
# Install DiamondJS — one package for what ships to the browser,
# one for what runs at build time
npm install @diamondjs/app
npm install --save-dev @diamondjs/dev
 
# Configure Parcel (2 lines)
echo '{ "extends": "@parcel/config-default", "transformers": { "*.html": ["@diamondjs/parcel-transformer-diamond", "..."] } }' > .parcelrc
 
# Configure TypeScript — @reactive needs BOTH decorator flags
echo '{ "compilerOptions": { "target": "ES2022", "module": "ES2022", "moduleResolution": "bundler", "strict": true, "experimentalDecorators": true, "useDefineForClassFields": false } }' > tsconfig.json
 
# Start building
npx parcel src/index.html
```
 
No `vite.config.js`. No `webpack.config.js`. Just `.parcelrc` with two lines.
 
> **Why both tsconfig flags:** `@reactive` installs a getter/setter that a field *assignment* flows through. `useDefineForClassFields` is TypeScript's default for ES2022+ targets (and what Parcel's SWC emits), and it *defines* the field as an own property instead — shadowing the accessor. The runtime detects and repairs this at `constructed()` (with a one-time warning in dev builds), but set the flag so your compiled output is what it says it is.
 
---
 
## Core Concepts
 
### Components
 
Every component is a TypeScript/JavaScript class that extends `Component`. Templates are separate `.html` files compiled at build time. The compiler generates an instance `createTemplate()` method that uses `this` to reference your properties and methods — the same `this` you use everywhere else in the class.
 
```typescript
import { Component, DiamondCore, reactive } from '@diamondjs/runtime'

export class MyComponent extends Component {
  @reactive name = ''                 // reactive → drives the UI
  @reactive count = 0
  private saved = 0                   // bare → inert bookkeeping

  constructor() { super() }           // the object exists; acquire nothing here

  override constructed() {            // @reactive is live under any toolchain; no element yet
    this.count = 1
  }
  override mounting() {               // about to appear: generation assigned, no template yet
    this.saved = Date.now()
  }
  override mounted() {                // in the document: measure, focus, observe
    this.getElement()?.querySelector('input')?.focus()
  }
  override unmounting() {             // still in the document; the generation is already invalid
    this.saved = 0
  }
  override unmounted() {              // detached, state preserved; may be mounted again
    this.count++
  }

  handleClick() { this.name = 'Updated' }   // `this` is always the component

  // Compiler-generated from my-component.html; written out so the fixture mounts.
  createTemplate(): HTMLElement {
    const div = document.createElement('div')
    const input = document.createElement('input')
    DiamondCore.bind(input, 'value', () => this.name, (v) => (this.name = v as string))
    div.appendChild(input)
    return div
  }
}
```
 
### Lifecycles

A component moves through six phases, one callback each. The names promise **states**: a callback runs only when the state its name describes holds. Two further phases, `faulted` and `disposed`, are terminal and have no callback.

| Phase | 2.3.0 callback | What is true when it runs | What you did in 2.2.x |
|---|---|---|---|
| `constructed` | `constructed()` | `@reactive` fields are live under any toolchain; no element yet; once per instance | Wrote fields in the constructor and hoped `useDefineForClassFields` had not made them inert until `mount()` |
| `mounting` | `mounting()` | About to appear; no template built yet | Code before `super.mount(host)` |                                 
| `mounted` | `mounted()` | **In the document.** Children mounted first; root-level `if` / `repeat` / `switch` output placed | No analogue, clunky `requestAnimationFrame` + `isConnected` polling after `super.mount(host)` |                                                   
| `unmounting` | `unmounting()` | Still in the document, on the way out | Code before `super.unmount()` |
| `unmounted` | `unmounted()` | Detached; state preserved; may mount again | Code after `super.unmount()`, which had also emptied the cleanup registry, so a class-field `debounce` lost its cancel on remount |
| `faulted` / `disposed` | — | Terminal; recovery is a fresh instance | No analogue, a throw inside `createTemplate()` left an instance flagged mounted with live effects |

<br/>

#### Real Before/After lifecycle Examples

**`constructed()` Reactive state is safe to touch, nothing is on screen.**
                                                                                                                                         
```typescript
// 2.2.x: The constructor was the only pre-mount hook.                                                                                  
export class Settings extends Component {
  @reactive activeTab = ''                                                                                                               
  constructor() {
    super()                                                                                                                              
    // Under useDefineForClassFields: true (TypeScript's ES2022 default) this write
    // landed on a plain own property that shadowed the reactive accessor. The                                                           
    // framework repaired the field at mount() — after this line had already run.
    this.activeTab = 'general'                                                                                                           
  }
}                                                                                                                                        

// 2.3.0: One callback that runs when @reactive is guaranteed live, once per instance.                                                  
export class Settings extends Component {
  @reactive activeTab = ''                                                                                                               
  override constructed() {
    this.activeTab = 'general'   // tracked, under any toolchain; no element exists yet                                                  
  }
}                                                                                                                                        
```
<br/>

**`mounting()` About to appear.** 2.2.x had this: it was the code before `super.mount()`.
                                                                                                                                         
```typescript
// 2.2.x:                                                                                                                                 
override mount(host: HTMLElement) {
  this.openedAt = performance.now()   // runs before the template is built                                                               
  super.mount(host)
}                                                                                                                                        

// 2.3.0: Same moment, its own name; no template or children exist yet.                                                                 
override mounting() {
  this.openedAt = performance.now()                                                                                                      
}
```                                                                                                                                      
<br/>

**`mounted()` Your element is in the document.** This is the one 2.2.x did not have, and the one every real app worked around.         

```typescript                                                                                                                            
// 2.2.x: When `mount()` ran it meant "template built and appended to host". The host was in
// the document only for a root or a route component; a child built inside a parent's                                                    
// template was still detached, and a root-level `if` had not been placed yet (that
// happened on a microtask). So "in the document" was guessed:                                                                           
override mount(host: HTMLElement) {
  super.mount(host)                                                                                                                      
  requestAnimationFrame(() => {                       // wait a frame and hope
    const el = this.getElement()                                                                                                         
    if (!el?.isConnected) {                           // …not yet? try next frame
      requestAnimationFrame(() => this.measure())    // (and the branch under a root `if`                                                
      return                                          //  might still be missing)
    }                                                                                                                                    
    this.measure()
  })                                                                                                                                     
}
                                                                                                                                         
// 2.3.0: The framework knows when the range reaches the document and tells you.
// Children's mounted() have already run; root-level structurals are placed.                                                             
override mounted() {
  const el = this.getElement()!                                                                                                          
  this.observer = new ResizeObserver(() => this.layout(el))
  this.observer.observe(el)                                                                                                              
  this.registerCleanup(() => this.observer.disconnect())   // released at unmount()
  el.querySelector('input')?.focus()                        // layout is real; focus works                                               
}
```                                                                                                                                      
<br/>

**Child components** followed the same pattern, by hand.                                                                                 

```typescript                                                                                                                            
// 2.2.x: Mount the child yourself, unmount it yourself, remember to do both.
override mount(host: HTMLElement) {                                                                                                      
  super.mount(host)
  this.viewer = new SourceViewer()                                                                                                       
  this.viewer.mount(this.getElement()!.querySelector('.viewer')!)   // detached host: the
}                                                                   // child never "connects"                                            
override unmount() {
  this.viewer?.unmount()        // forget this and the child's effects outlive the parent                                                
  super.unmount()
}                                                                                                                                        

// 2.3.0: Register the child; it is delivered child-first when the parent connects                                                      
// and disposed with the parent's mount scope. Nothing to undo.
override mounting() {                                                                                                                    
  this.viewer = new SourceViewer()
  DiamondCore.child(this.viewer, this.getElement()!.querySelector('.viewer')!)                                                           
}
```                                                                                                                                      
<br/>

**`unmounting()` Still in the document.** 2.2.x had this too: the code before `super.unmount()`.                                       

```typescript                                                                                                                            
// 2.2.x:
override unmount() {                                                                                                                     
  this.savedScroll = this.getElement()!.scrollTop   // the range is still attached here
  super.unmount()                                                                                                                        
}
                                                                                                                                         
// 2.3.0:
override unmounting() {                                                                                                                  
  this.savedScroll = this.getElement()!.scrollTop
}                                                                                                                                        
```
<br/>

**`unmounted()` Detached, state kept, remount allowed.** The 2.2.x analogue existed but came with a trap.
                                                                                                                                         
```typescript
// 2.2.x: When unmount() ran it emptied the whole cleanup registry, including the cancel that a                                                     
// class-field debounce had registered. After a remount the wrapper still worked, but
// its pending timer could no longer be cancelled — the documented "re-mount caveat".                                                    
// The workaround was to rebuild the handler on every mount():
handleInput!: (v: string) => void                                                                                                        
override mount(host: HTMLElement) {
  this.handleInput = this.debounce((v) => (this.query = v), 300)   // re-created each mount                                              
  super.mount(host)
}                                                                                                                                        
override unmount() {
  super.unmount()                                                                                                                        
  this.visits++
}                                                                                                                                        

// 2.3.0: Two scopes. A class-field debounce lives in the instance scope: its timer is                                                  
// cancelled at unmount() and the cancel is kept, so the one-liner survives a remount.
handleInput = this.debounce((v: string) => (this.query = v), 300)                                                                        
override unmounted() {
  this.visits++                 // state is preserved; mount() may be called again                                                       
}
```
<br/>

**Callbacks the framework cannot cancel** get a guard instead of a flag.

```typescript
// 2.2.x: A `mounted` flag by hand, checked in every async continuation.
override mount(host: HTMLElement) {
  super.mount(host)
  this.alive = true
  fetch(this.url).then((r) => { if (this.alive) this.show(r) })
}
override unmount() { this.alive = false; super.unmount() }

// 2.3.0: Bind the continuation to this mount's generation; after unmount() it declines.
override mounted() {
  fetch(this.url).then(this.whileMounted((r) => this.show(r)))
}
```
<br/>

**The entry points are final.**
`mount(host)`, `unmount()` and `dispose()` belong to the framework.  
Overriding `mount` or `unmount` fails at construction, not quietly at runtime, and the message says what to write instead:

```
[Diamond] Chart overrides mount()/unmount(). These are final. Override mounted()/unmounting() instead (spec §4.4).
```

**A failed mount leaves nothing behind.** Everything a mount attempt acquires — bindings, listeners, effects, timers, children, the DOM range — is inventoried as it is created. If anything throws on the way to `mounted()`, the inventory is released in reverse order, the instance returns to `constructed` (first mount) or `unmounted` (remount), and the error is rethrown to you unchanged. In 2.2.x a throw inside `createTemplate()` left the instance flagged as mounted with its effects live; the only remedy was a `try { … } catch { c.unmount() }` around every `mount()` call, and even that missed what had been acquired before the throw.

**Where an instance stands** is always readable: `phase` and `generation` are reactive (`if="phase === 'mounted'"` works in a template), `history()` returns the last 32 transitions with cause, outcome and timestamp, and in dev builds `domPing()` checks that snapshot against the real DOM.
 
### Reactivity
 
Decorate what you mean. `@reactive` properties drive the UI. Bare properties are inert. No class-level "YOLO mode" — you always know which properties will trigger re-renders.
 
For small UI state (forms, toggles, counters), `@reactive` is all you need. For large datasets (100K+ items, log viewers, chat histories), DiamondJS provides a high-performance `Collection<T>` class with O(1) append and 77% less memory than reactive proxies at scale.
 
```typescript
// Small state — use @reactive
@reactive searchQuery = '';
@reactive isOpen = false;
@reactive tags: string[] = [];      // tags.push('x') re-renders; so does tags = [...]
 
// Large dataset — use Collection
private logs = DiamondCore.collection<string>();
```
 
A `@reactive` array re-renders on in-place mutation (`push`, `pop`, `splice`, `tags[i] = v`, `tags.length = 0`) as well as on reassignment; changes made in one tick batch into a single flush.
 
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

**A literal `${`.** In text and in plain attribute values, write `\${`: `<p>Use \${name}</p>` renders `${name}`. An entity works too (`&#36;{name}`) — an encoded character is never syntax. Only a backslash directly before `${` is special, so `C:\temp\notes` is ordinary text; `\\${name}` is one backslash followed by the value of `name`. When a template is built from JavaScript, use `String.raw` so the backslash survives: ``String.raw`<p>Use \${x}</p>` ``.

**Whitespace.** Template text is kept exactly as written — line breaks, indentation, NBSP and all; collapsing it is CSS's job, as in plain HTML. The compiler consumes whitespace only where it is syntax: between an `if` and the `else-if` that follows it, directly inside `<switch>` between cases, and the indentation around the template's roots. Indented inline siblings therefore get the ordinary HTML gap between them; a flex or grid parent does not render it, and tags written flush have none.
 
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
 
Links are plain `<a href>` — the router intercepts same-origin primary clicks and leaves middle-click, modifier-click, and external links to the browser. Anchors that are not navigation pass through too: `download`, a `target` other than `_self`, `rel="external"`, and non-http(s) hrefs (`blob:`, `data:`, `mailto:`, `tel:`). So does a link to a fragment of the current page (`#section`, or `#` alone), which the browser scrolls to itself. A link's query string and hash are kept in the URL; matching uses the path only. No `<RouterLink>` component to learn.

URLs behave as in HTML. `router.navigate('/about?tab=2#x')` reads its argument as a URL and shares one code path with the equivalent link, so both produce the same URL, params and guard run. After a navigation commits, the router scrolls to the element the hash names; a navigation without a hash starts at the top; Back and Forward return to where the page was left, once the page has mounted.
 
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
| `@diamondjs/parcel-transformer-diamond` | Zero-config Parcel 2 integration + `run_mode` → `__DIAMOND_DEV__` injection | < 300 |
 
Converters are the data batteries; guards are the policy batteries.
 
Three meta-packages pin one tested constellation per release (exact versions, not ranges): **`@diamondjs/app`** (runtime + converters + primafacie + guards — what ships to the browser), **`@diamondjs/dev`** (compiler + parcel-transformer + the `stink-check` and `route-check` build gates), and **`@diamondjs/all`** (both).
 
The entire framework fits in an LLM context window. That's not an accident — it's a design constraint.
 
---
 
## Current Status
 
**Specification**: [v2.3.0](docs/spec/v2.3.0/DiamondJS_Architecture_Specification_v2.3.0.md) for the published release, one document consolidating the v2.1 spec, Amendment A3 and the v2.2 Router Specification with the lifecycle contract and preserved template text; the Lifecycle Contract design record sits beside it. [v2.2.4](docs/spec/v2.2.4/DiamondJS_Architecture_Specification_v2.2.4.md) describes the previous release; earlier versions are under [`docs/spec/`](docs/spec/).
 
**Implementation**: v2.3.0 — the lifecycle contract and preserved template text (PRs #39 and #40; issues #15 and #38): six phases with one callback each, `mounted` meaning connected and delivered child-first, `mount()` / `unmount()` / `dispose()` final, rollback by inventory so a throw anywhere in a mount releases everything the attempt acquired, two scopes so a class-field `debounce` survives a remount, and template text kept exactly as the HTML parser produces it. Beneath it, v2.2.4 — the second hardening patch from the same application (#14, #17–#20, #25–#29): the link interceptor leaves non-navigation anchors and same-page fragment links to the browser and keeps a link's query and hash; router URLs behave as in HTML (`navigate(url)`, scroll to the fragment, Back / Forward restore the position); a reactive array re-renders on `push()`; multi-root and structural-only bodies are removed through their mounted range; author text reaches compiled output through one encoder; template text can finally say a literal `${` (`\${`, or an entity); `route-check` works on Node 22; and a fresh clone builds in one pass. Beneath it, v2.2.3 — the first-real-app hardening patch on top of v2.2.2. The first application built on the published constellation surfaced five defects in its first day (#7–#11), all fixed upstream: structural directives render synchronously on first mount, `<select>` is bound after its options, a static `<a href>` passes the sink gate, `@reactive` survives `useDefineForClassFields: true`, and `route-check` loads page components' template imports. Beneath it, v2.2.2 — the routing release on top of v2.1's scale-and-completeness work, **published to npm** (all nine `@diamondjs/*` packages, August 2026), with `@diamondjs/dev` shipping the complete toolchain: compiler, Parcel transformer, Parcel, TypeScript, and the `stink-check`/`route-check` gates as real bins. The full navigation stack: multi-outlet router with specificity matching and atomic two-phase commit, typed URL params through the converter/`ParseResult` contract, class-based guards with a fail-closed execution envelope, the four-arm `Destination` vocabulary shared by redirects and guard denials, `Pending` departure safety, `basePath` for sub-path deployments, the `route-check` build gate, dev-mode route-table narration via `run_mode`/`__DIAMOND_DEV__`, and the logging consolidation (one vocabulary: everything emits through `Print`; browser→server WebSocket log relay with datestamped server files). Plus the v2.1.1 conformance patch: eager disposal of detached `if`/`switch` branches, the scheduler stale-flush retention fix, `repeat` duplicate-primitive reconciliation, static-attribute sink gating, and fail-loud diagnostics for unshipped component composition.
 
| Package | Production LOC | Budget | Usage |
|---------|---------------:|-------:|------:|
| @diamondjs/runtime | 1,746 | 2,500 | 69.8% |
| @diamondjs/compiler | 2,464 | 5,000 | 49.3% |
| @diamondjs/parcel-transformer-diamond | 164 | 300 | 54.7% |
| @diamondjs/converters | 123 | 500 | 24.6% |
| @diamondjs/primafacie | 300 | 400 | 75.0% |
| @diamondjs/dev (toolchain) | 545 | 800 | 68.1% |
| **Total** | **5,342** | **9,500** | **56.2%** |
 
**960 tests across 64 files**, all passing.
 
### What works today (v2.3.0)

**Template & binding language (v2.0 + v2.1)**

- Security allowlist (fail-closed) + `raw` escape hatch + `stink-check` gate
- `set` / `rawSet`, `.calls`, `.capture`
- `if` / `else-if` / `repeat.for`
- `switch` / `case` / `default`
- `...attrs.bind` (gated attribute spread)
- `error-into` converter error surfaces
- `[Diamond]` hint comments on every generated call

**Data & converters (v2.0 → v2.2)**

- Converter pipes + `ParseResult` contract
- Batteries: `CurrencyConverter`, `DateConverter`, `PhoneConverter`
- `IntConverter`, `SlugConverter` (v2.2 route-param workhorses)
- `Collection<T>` — O(1) append, 77% less memory than reactive proxies at 100K+

**Runtime mechanics (v2.0 + v2.1)**

- `DiamondCore.delegate()` event delegation
- VLQ source maps (errors point at your `.html`, not compiled JS)
- `@diamondjs/primafacie` — `Print(logType, message)` logging paradigm

**Router & navigation (v2.2)**

- Nested routes, named multi-outlet targeting
- Specificity matching (never declaration order)
- Atomic two-phase commit (all guards run → single mount/unmount pass)
- `Pending` departure safety (refcount, passthrough, bfcache-safe)
- `basePath` for sub-path deployments
- Link interception (same-origin primary clicks only)
- `popstate` / initial-load guard coverage

**Guards (v2.2)**

- Class-based: static `check()` (pure predicate) + `deny()` (returns a `Destination`)
- Fail-closed execution envelope: throw → deny, hang → deny after `Guard.timeoutMs`, base `check()` returns `false`
- Every decision narrated through `Print` (guard name, route ID, outcome, duration)
- `@diamondjs/guards` policy-battery scaffold (type re-exports; concrete batteries land in v2.3)

**Destinations (v2.2)**

- Four-arm tagged union: `route-id` / `route-path` / `site-path` / `external-url`
- Shared vocabulary for both redirects *and* guard denials — never inferred from string shape

**Build gates (v2.2)**

- `stink-check` — two-tier security audit (severity-routed: `error`/`warn` fail, `declared` baselined)
- `route-check` — build-time route-map validation (route-ID errors with did-you-mean fixes)

**Dev/prod builds & logging relay (v2.2)**

- `run_mode` → `__DIAMOND_DEV__` injection; dev-only paths dead-code-eliminated in prod
- Dev-mode route-table narration (one `Print` line per resolved route)
- `wsReceiver` + datestamped `fileSink` — browser→server log relay

**Toolchain & meta-packages (v2.2)**

- `@diamondjs/dev` — compiler + Parcel transformer + Parcel + TypeScript + both gates, exact-pinned
- `@diamondjs/app` — runtime + converters + guards + primafacie (browser constellation)
- `@diamondjs/all` — `app` ∪ `dev` (one tested constellation, exact pins, never ranges)

**First-real-app hardening (v2.2.3)**

- `if` / `switch` / `repeat` render synchronously on first mount (compiler attaches anchors before the call; runtime guards the detached case)
- `<select>` bound after its `<option>` children — the initial model value selects, static or `repeat.for`-generated
- Static `<a href="/path">` is the link pattern and passes `stink-check`; `role` is inert metadata like `data-*` / `aria-*`
- `@reactive` repaired at `constructed()` under `useDefineForClassFields: true`, with a once-per-class dev-build report
- `route-check` loads page components' `*.diamond.html` / `*.css` imports as inert stubs (ESM and CommonJS consumers)

**Second hardening pass (v2.2.4)**

- Link interceptor leaves `download`, `target`, `rel="external"` and non-http(s) anchors to the browser, and same-page fragment links too
- A link's query and hash are kept in the URL — on click, initial load, and Back / Forward; declared `query` converters parse the target URL
- Multi-root bodies and bodies that are only a structural are removed whole on switch-away and `unmount()` (mounted-range tracking)
- Backslashes in interpolated text are literal; multi-line attribute expressions compile
- A literal `${` in text and plain attributes: `\${`, or an entity such as `&#36;{`
- URLs behave as in HTML: `navigate(url)` takes a query and hash and shares the link's code path; a navigation scrolls to its hash target or starts at the top; Back / Forward restore the scroll position; `href="#"` passes through
- A `@reactive` array re-renders on `push()`, `splice()` and every other in-place mutation, not only on reassignment
- `route-check` runs on Node 20 and Node 22 for ESM and CommonJS consumers

**Lifecycle contract (v2.3.0)**

- Six phases, one callback each: `constructed()`, `mounting()`, `mounted()`, `unmounting()`, `unmounted()`; `mounted` means connected, delivered child-first
- `mount()` / `unmount()` / `dispose()` are final; `update()` is retired (props are reactive writes)
- Rollback by inventory: a throw anywhere in a mount releases everything the attempt acquired; `phase`, `generation`, `history()`, `domPing()`
- Two scopes: `debounce` / `throttle` cancels survive a remount; `whileMounted(fn)` declines a stale callback after `unmount()`
- A page whose template root is a structural scrolls to its hash target on navigation
- A fresh clone builds with a single `npm run build`

**Preserved template text (v2.3.0)**

- Template text is kept exactly as the HTML parser produces it (#15): `press <em>Start job</em> on` keeps its spaces; NBSP, thin spaces, tabs and line breaks stay as written
- Compiled output appends each parent's children in one `append(...)` call, static text as string arguments — the generated code reads as the markup did
 
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
 
MIT
 
---
 
## Author
 
**Joe Hacobian** — ex-JPL engineer turned framework architect.
 
*"The highest praise for DiamondJS is that the developer barely noticed it was there."*
