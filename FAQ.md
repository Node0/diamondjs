# 💎 FAQ

## **Q: Is this production-ready?**
It's shipped and real: the spec-governed 2.x series is published on npm (all nine `@diamondjs/*` packages at v2.2.2, August 2026), with 557 passing tests and the full navigation stack — router, guards, typed URL params, departure safety. v2.2 marks the point where DiamondJS can single-handedly deliver multi-view SPAs. That said, the v2.x API surface is still stabilizing and the ecosystem is young — treat it as early-adopter territory, and read each release's design record before betting the farm.

## **Q: How do I install it?**
Two packages — one for what ships to the browser, one for what runs at build time:

```bash
npm install @diamondjs/app
npm install --save-dev @diamondjs/dev
```

`bun add @diamondjs/app` / `bun add -d @diamondjs/dev` work too (Bun installs from the npm registry), and `npm install @diamondjs/all` gives you the union in one line. Both meta-packages exact-pin one tested constellation — upgrading DiamondJS is bumping one number.

## **Q: Why not just use [React/Vue/Svelte]?**
Those frameworks are excellent, but they weren't designed with LLM comprehension as a first-class constraint. DiamondJS explores what becomes possible when you optimize for human-AI collaboration from day one, with additional focus on optimal performance across different workload types.

## **Q: Does this really work with 32B models?**
That's the design constraint the whole framework is built around: pure class-based patterns, explicit code paths, `[Diamond]` hint comments on every generated call, and a runtime small enough to fit in a context window alongside your app. The working code is now published; formal benchmarks against the >80% bug-fix target are still to come.

## **Q: I installed `@diamondjs/app` — why is `@diamondjs/guards` empty?**
Deliberately. It's an honest empty box: as of v2.2.x it ships only type re-exports (`GuardContext`, `Destination`) and says so loudly in its README. No real application has produced a guard inventory yet, and DiamondJS doesn't ship machinery described as shipped before it exists. Write guards today by extending `Guard` from `@diamondjs/runtime` directly — the fail-closed execution envelope applies regardless. The first battery mid-classes (`OAuthGuard`, `WebAuthnGuard`, `CapabilityGuard`, `TenantGuard` are the recorded candidates) land in v2.3 once real consuming apps exist.

## **Q: What about TypeScript?**
TypeScript is optional but encouraged! Since we use modern JavaScript features natively, TypeScript adds type safety without any runtime overhead. The compiler handles TS → JS transpilation as part of the build process.

## **Q: Which browsers are supported?**
Chrome/Edge 90+, Firefox 90+, Safari 15+, and all mobile browsers from 2023+. We target browsers with native support for private class fields, optional chaining, nullish coalescing, and other ES2022+ features.

## **Q: When should I use `collection()` vs `reactive()`?**
Use `reactive()` for small UI state (< 1,000 items, update-heavy workloads like forms). Use `collection()` for large datasets (> 1,000 items, append-heavy workloads like logs, chat, terminals). The performance difference is dramatic: constant 0.005ms appends with Collection vs. degrading to 0.2ms at 100K items with reactive.

## **Q: Won't using private fields (`#`) make code harder to test?**
Not at all! Private fields provide true encapsulation, and you test the public API. If you need test hooks, expose them through public methods, just like in any well-designed class. The transparency comes from explicit code paths, not from exposing internals.

## **Q: Why the emphasis on "class-based" architecture?**
LLMs are autoregressive, they predict tokens based on patterns. When debugging, if they see standalone exported functions (functional style), they get steered toward ES5-style solutions. By maintaining pure OOP with classes and static methods throughout, we keep LLMs in the correct mental model for generating modern, maintainable code.

As for why we settled on class based OOP, the answer is that coming from an enterprise background, we saw the benefit of well-structured architecture. We also saw just how wrong any architecture whether OOP or functional paradigm (fp) could go when abstraction is allowed to roam unchecked. We wanted to see if we could make OOP sing with minimum abstraction, maximum clarity, and radical transparency.

## **Q: Why "DiamondJS"?**
A diamond 💎 is carbon arranged in a crystal structure, maximum clarity and strength from simple building blocks. DiamondJS takes simple JavaScript and arranges it for maximum clarity and optimal performance.
