# 💎 @diamondjs/runtime

**The browser half of DiamondJS: reactivity, components, the binding engine, and the router — under 2,500 lines, all of it readable.**

Build-time magic. Runtime honesty. `this` everywhere.

---

## What is this?

The runtime is everything DiamondJS ships to the browser: `Component`, `@reactive`, the binding engine and scheduler, `Collection<T>` for large datasets, the security allowlist, and the full v2.2 navigation stack — `Router`, `Guard`, `Destination`, `Pending`.

There is no virtual DOM, no runtime template parsing, and no hidden state. Templates are compiled to plain `createTemplate()` methods at build time (by [`@diamondjs/compiler`](https://www.npmjs.com/package/@diamondjs/compiler)); the runtime just executes honest JavaScript with `[Diamond]` hint comments explaining every transformation.

```bash
# Usually installed via the app meta-package (exact-pinned constellation):
npm install @diamondjs/app

# Or standalone:
npm install @diamondjs/runtime
```

## Components

Every component is a class extending `Component`. Decorate what you mean: `@reactive` properties drive the UI; bare properties are inert. Four lifecycle hooks, and that's it: `constructor` → `mount` → `update` → `unmount`.

```typescript
import { Component, reactive } from '@diamondjs/runtime';

export class Counter extends Component {
  @reactive count = 0;
  lastClicked = 0;            // Not reactive — internal bookkeeping

  increment() { this.count++; this.lastClicked = Date.now(); }
}
```

For large datasets (100K+ items, log viewers, chat histories), `Collection<T>` gives O(1) append and 77% less memory than reactive proxies at scale.

## Routing (v2.2)

One router — one *navigation authority*, not one view. Nested routes, multiple named outlets, guards, and typed URL params, declared in a single statically-analyzable route map. Plain data: no decorators, no registration calls.

```typescript
import { Router, type RouteMap } from '@diamondjs/runtime';
import { SlugConverter } from '@diamondjs/converters';

export const routes = {
  'review': {
    path: '/review/:corpusId',
    component: ReviewWorkspace,
    outlet: 'main',
    params: { corpusId: SlugConverter },   // parse failure ⇒ route doesn't match
    guard: [RequireLogin, RequireCorpusLoaded],
  },
} satisfies RouteMap;

const router = new Router(routes);   // { basePath: '/my-app' } when not at domain root
await router.start();                // guards run on the initial URL too
```

Navigation is a two-phase transaction: **all** guards for the whole plan run before **anything** mounts, then the commit is atomic. A guard rejection means zero DOM change. Links are plain `<a href>` — the router intercepts same-origin primary clicks and leaves middle-click, modifier-click, and external links to the browser.

### Guards

A guard is a class with two static methods: `check` answers a pure yes/no question; `deny` returns a `Destination` — data the router executes. Guards never navigate, never touch the DOM.

```typescript
import { Guard, type GuardContext, type Destination } from '@diamondjs/runtime';

export class RequireLogin extends Guard {
  static check() { return session.user !== null; }
  static deny({ to }: GuardContext): Destination {
    return { type: 'route-id', target: 'login', query: { returnTo: to } };
  }
}
```

The router wraps every evaluation in an execution envelope guards cannot override: a `check()` that **throws** denies, a `check()` that **hangs** denies after `Guard.timeoutMs`, and every decision emits one narration line through `Print`. Fail closed, everywhere — even the base `check()` returns `false`.

One sentence to keep you honest: client guards *predict*; servers *enforce*.

### Destinations

Redirects and guard denials speak one vocabulary — an explicit tagged union, never inferred from string shape:

```typescript
redirect: { type: 'route-id',     target: 'ingest' }                 // inside the map, by ID
redirect: { type: 'route-path',   target: '/review/:corpusId' }      // inside the map, by path
redirect: { type: 'site-path',    target: '/support/wiki' }          // same origin, hard load
redirect: { type: 'external-url', target: 'https://example.com' }    // off origin, https only
```

### Pending — departure safety

```typescript
async save() {
  await Pending.until(api.saveCorpus(this.corpus), 'corpus-save');
}
```

`Pending.until` is a passthrough — it returns the promise it was given. While the refcount is nonzero, tab close and reload trigger the browser's "leave site?" dialog and in-app navigation asks for confirmation; at zero, the `beforeunload` handler is removed so the back/forward cache stays enabled. `Pending.active` is reactive, so your save indicator and the departure warning can never disagree.

## Design constraints

- **Runtime < 2,500 LOC** — the entire runtime fits in a single LLM context window (currently ~62% of budget)
- **Zero runtime template parsing** — all compilation happens at build time
- **32B LLM comprehension** — models achieve >80% bug-fix rate on compiled output

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era.

## License

MIT
