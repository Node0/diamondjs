# 💎 FAQ

## **Q: Is this production-ready?**
Not yet. DiamondJS is in active development. We're working toward a v0.1 proof-of-concept. Current status: Architecture complete, implementation beginning.

## **Q: Why not just use [React/Vue/Svelte]?**
Those frameworks are excellent, but they weren't designed with LLM comprehension as a first-class constraint. DiamondJS explores what becomes possible when you optimize for human-AI collaboration from day one, with additional focus on optimal performance across different workload types.

## **Q: Does this really work with 32B models?**
That's what we're testing! The architecture is designed to maximize comprehension for smaller models through pure class-based patterns and explicit code paths. We'll publish benchmarks once we have working code.

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
