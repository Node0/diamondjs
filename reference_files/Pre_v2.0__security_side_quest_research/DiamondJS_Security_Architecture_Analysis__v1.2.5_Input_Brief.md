# DiamondJS Security Architecture Analysis — v1.2.5 Input Brief

---

## Task 1 — Ontological Autopsy of `unsafeBind`

### 1a. What threat model is the PR implicitly operating from?

The PR is operating from a **content injection / accidental sink exposure** threat model. The implicit attacker:

- Controls user-generated content (form fields, API responses) that the application stores in reactive state
- Has no code execution in the page — only data flowing in from the outside
- Relies on the developer (or an LLM autocompleting code) to naively route that data into a DOM execution sink
- Expects the framework to be agnostic about what gets bound where

It is a **Model A** attacker — hostile data, not hostile code. The PR makes no provisions for an attacker who has already achieved script execution in the origin.

The attack vector addressed: `userContent` → reactive property → `innerhtml.bind` → `el.innerHTML = this.userContent` → XSS.

The attack vectors not addressed: URL injection, prototype pollution, CSS injection, any surface beyond the three named sinks, and anything involving script-level access to the page.

### 1b. What questions does the PR pose and attempt to answer?

At the security philosophy level, the PR asks: **How do we prevent accidental wiring of untrusted data to a DOM execution sink when the binding DSL makes it trivially easy to do so?**

The answer the PR gives: make the dangerous path structurally expensive by requiring explicit opt-in syntax. The safe path refuses dangerous sinks. The dangerous path requires typing `.unsafe-bind`, which announces intent in the source.

Is it solving the right problem? Yes — accidental innerHTML assignment through ergonomic binding syntax is the most common first-order XSS mechanism in component frameworks. This is the right problem to solve first. The limitation is that it only solves the first problem and declares victory.

### 1c. What does the PR get right?

- **Defense in depth**: Compiler blocks illegal bindings at build time; the runtime refuses them again as a backstop even if compiled output is hand-edited or `DiamondCore.bind()` is called manually. Two independent enforcement points at different layers.
- **Single choke point**: All template-driven DOM writes flow through `DiamondCore.bind()`. Adding a guard there makes the protection automatically universal across every component without per-component changes.
- **Error quality**: `CompileError` includes source location and remediation guidance. This trains LLMs and humans simultaneously — the compiler becomes a teacher, not just a gatekeeper.
- **Centralized sink set**: `UNSAFE_DOM_SINK_PROPERTIES` is a `Set` defined in both the compiler and runtime. This is the correct pattern — no drift between what the compiler blocks and what the runtime blocks.
- **Case-insensitive normalization**: `property.toLowerCase()` handles `innerHTML`, `INNERHTML`, `innerHtml` uniformly. This closes the trivial bypass of mismatching case.
- **Correct initial sink list**: `innerHTML`, `outerHTML`, `srcdoc` are all legitimate HTML execution sinks.

### 1d. What does the PR get wrong or leave unexamined?

- **`href` on anchor elements is not in the sink list**: A binding like `href.bind="userInput"` where `userInput = "javascript:alert(1)"` is entirely unguarded. This is arguably more dangerous than `innerHTML` in some scenarios because it executes on user interaction rather than on render.
- **`action` and `formaction` are unguarded**: `action.bind="userUrl"` on a form can redirect submissions to attacker-controlled infrastructure. Not an XSS vector, but a significant data exfiltration vector.
- **`iframe[src]` is unguarded**: Binding user content to `iframe[src]` can load attacker-controlled frames, enabling phishing and clickjacking within the application shell.
- **Two-way binding on unsafe sinks is semantically wrong**: `bindUnsafe` is implemented as two-way (with a setter). Reading from `innerHTML` to drive reactive state is almost never intentional and can create unexpected reactive loops. The unsafe path should default to one-way (write only).
- **No stink logging**: Calling `bindUnsafe()` in production is completely silent. There is a comment emitted in compiled output (`// [Diamond] UNSAFE two-way binding (opt-in)`), but no runtime telemetry signal. The PR does not know when a `raw` call site is being exercised in production.
- **No audit capability**: You cannot query "how many `.unsafe-bind` call sites exist in this codebase?" except by grepping the source manually. The PR ships no build-time enumeration of unsafe call sites.
- **Prototype pollution in the reactive proxy is unaddressed**: Entirely separate vector, discussed in Task 2e.

### 1e. Does the PR's approach align with the `raw`/`stink` paradigm?

**Partial alignment, with material gaps.**

Where it aligns:
- Safe default + explicit opt-in is the core `raw`/`stink` concept
- The dual-layer enforcement (compile + runtime) is correct
- The opt-in syntax is syntactically distinct from the safe path

Where it diverges:

**Name**: `unsafe` vs `raw` is not a cosmetic difference. `unsafe` is a moral judgment — it implies "you are doing something wrong." `raw` is a factual description — you are bypassing processing and receiving data without transformation. `raw` matches DiamondJS's philosophy: it's not that using raw HTML is wrong, it's that you are taking uncooked data and you must own that decision. The PR's use of `unsafe` imports Rust-ecosystem baggage and implies shame rather than intent.

**No stink logging**: The `raw`/`stink` paradigm specifies that every `raw` call in the runtime emits a structured log entry at dev time. The PR does not implement this. `bindUnsafe()` is silent at runtime. A developer using `.unsafe-bind` extensively in production would generate no signal whatsoever.

**No audit biscuit**: The PR has no compile-time report of all `.unsafe-bind` call sites. The compiler blocks illegal uses but generates no enumeration of legal unsafe uses. The audit biscuit is described as non-optional and generated on every build — the PR doesn't even approach this.

**Summary**: The PR introduces the right conceptual skeleton (`safe default` + `escape hatch`), but delivers none of the transparency and telemetry infrastructure that gives the `raw`/`stink` paradigm its teeth. It is the beginning of the pattern, not the pattern itself.

---

## Task 2 — Evaluate the Unofficial v1.5.1 Spec

### 2a. How pervasive are the proposed changes?

The unofficial v1.5.1 spec contains **no security content**. Zero mentions of innerHTML, unsafe-bind, raw variants, audit biscuits, or any security model. The spec addresses:

- **Runtime changes** (moderate): Instance template methods replacing static factory, proxy cache WeakMap for referential identity, `@reactive` property-level decorator, `makeReactive()` API
- **Compiler changes** (moderate): `[Diamond]` hint comment emission, instance method codegen replacing static factory codegen, `@reactive` decorator transformation
- **API surface changes** (moderate): New `reactive` decorator export, `makeReactive()` on `DiamondCore`, removal of `vm` parameter
- **Build pipeline changes** (minimal): `methodType: 'instance'` option added to compiler invocation
- **Security**: None

LOC estimate from the spec's own appendix: runtime ~2,640 LOC, compiler ~4,050 LOC. Both within budget. The delta from v1.2 is likely 200–400 LOC in the runtime (instance template boilerplate, makeReactive implementation) and 100–200 LOC in the compiler (hint generation, method type switch).

### 2b. Does the version jump (1.2.0 → 1.5.1) reflect the scope of the changes?

The changes are materially smaller than the version jump implies. The spec itself labels v1.5 as an "ARCHITECTURAL PIVOT" — but what changed is the template method type (static → instance) and the introduction of `@reactive` decorators. These are:

- The static → instance change: potentially breaking if any code references the `vm` parameter convention. Otherwise a refactor.
- `@reactive` decorator: additive, non-breaking
- `[Diamond]` hints: purely additive
- Proxy cache fix: bug fix

By semver: the static → instance change would be a major version bump if it breaks existing code, or a minor bump if migration is trivial. Skipping from v1.2 to v1.5 is unexplained in the spec (v1.3 and v1.4 are unaccounted for).

**The content of the spec does not argue for anything larger than v1.2.5 as the security hardening target.** The security work described in this document's mission is additive to the v1.5 architectural state and does not require breaking anything the spec established. v1.2.5 is the correct designation for a security hardening release layered on top of the architectural work.

### 2c. Does the v1.5.1 spec align with the `raw`/`stink` paradigm?

No. The spec is entirely silent on security. It does not adopt `raw` as a universal qualifier, does not include an audit biscuit concept, and has no stink logging layer. The word "security" does not appear in the document.

This is the most significant gap in the spec. The v1.5 pivot is architecturally sound, but it establishes no security posture whatsoever.

### 2d. What does the spec get right about security?

Indirectly, several spec properties create a favorable security posture:

- **No runtime template parsing**: Zero-cost browser template compilation. There is no eval of template strings at runtime. This eliminates an entire class of injection vectors present in frameworks with runtime template engines.
- **Single choke point**: `DiamondCore.bind()` is the only path by which template-driven state reaches the DOM. This is the ideal enforcement point — one function to guard rather than many.
- **LOC constraint**: A 2,500-line runtime is trivially auditable compared to a 50,000-line framework. Smaller attack surface by design.
- **Radical transparency / LLM-readable output**: Compiled output that LLMs can read and reason about also means security audits of compiled output are more effective.
- **Explicit imports, no DI magic**: No global singletons or ambient authority via a DI container. The provenance of every object is traceable.

### 2e. What is the spec blind to?

The following attack surfaces are entirely unaddressed:

**CSS injection via style attribute binding**: `style.bind="userContent"` where `userContent` contains a malicious CSS property. Modern browsers block `javascript:` in CSS values and CSS `expression()` is IE-only. The real risk is `url()` loading attacker-controlled resources, which can be a side-channel for user tracking. Risk is **low-moderate in modern browsers**, but not zero. Given DiamondJS targets evergreen browsers only, this is low priority.

**Prototype pollution through the reactive proxy system**: The current `ReactivityEngine.createProxy()` uses `Reflect.set(target, prop, value, receiver)` unconditionally. If `prop` is `__proto__` or the string path includes `constructor.prototype`, and `target` is a plain object literal, `Reflect.set` with `__proto__` as the prop key on a plain object can manipulate the prototype chain. Concretely: `DiamondCore.reactive({__proto__: {isAdmin: true}})` would not do what you expect — but an attacker who can control the shape of an object passed to `reactive()` could attempt this. Risk: **real, particularly when reactive state is initialized from deserialized API responses**. Fix is simple and belongs unconditionally in the proxy — no raw variant needed.

**Dangerous attribute targets beyond innerHTML**:
- `href.bind` on `<a>` elements: `javascript:alert(1)` protocol executes on click in all browsers. **Real risk.**
- `src.bind` on `<iframe>`: loads attacker-controlled content. **Moderate risk** (phishing, clickjacking within app shell).
- `action.bind` on `<form>`: redirects form submissions to attacker-controlled endpoint. **Moderate risk** (data exfiltration).
- `formaction.bind` on `<button type="submit">`: same as action. **Moderate risk.**
- `src.bind` on `<img>`, `<audio>`, `<video>`: the browser makes authenticated requests to the URL, which is an SSRF-like side channel. Risk is **low** for purely client-side apps but real in same-origin credential scenarios.

**Event handler injection**: Not a real risk. DiamondJS's event model compiles to `DiamondCore.on(el, eventName, () => this.fn())` — the handler is always a closure reference to a class method, never a string evaluation. Inert.

**URL protocol injection (javascript:, data:, vbscript:)**: Directly a consequence of `href.bind` being unguarded. `data:` URIs in `href` can execute HTML/JS in some contexts. `vbscript:` is IE-only. **Real risk via href specifically.** The default path must sanitize URL protocols to an allowlist.

**DOM clobbering**: An attacker who can get HTML into the DOM (via `innerHTML`) can create elements with `id` or `name` attributes that shadow global properties. Example: `<form id="diamond">` could shadow a DiamondJS global. This is substantially mitigated by blocking `innerHTML` binding — the post-PR world largely closes this vector.

**Scheduler DoS via reactive update storms**: An attacker who can trigger many reactive updates could saturate the microtask queue. This requires significant developer cooperation (binding user input directly to many reactive properties with complex effect chains). Risk is **theoretical** given normal application patterns.

---

## Task 3 — WASM Security Layer Analysis

### 3a. What is the core proposal?

A small WASM "guardian blob" — separate from DiamondJS's runtime — that:

1. Receives a stream of security-relevant events from Diamond and a bootstrap JS shim (`record_event(type, aux)`)
2. Maintains an internal state machine with rolling digests over those events
3. Uses spread-spectrum timing (a server-provided PRNG seed generating random intervals in a configured `[minMs, maxMs]` range) to schedule phone-home calls — making the timing pattern unpredictable to observers in the same origin
4. Periodically sends structured telemetry to the server: build ID, session ID, event counters, and a rolling digest
5. Exposes a `should_fail_hard()` flag that JS can poll to trigger local kill actions (wipe auth, redirect to security violation page)

The blob is designed as a **porcupine, not a wall** — it makes attacks noisier and more expensive, not impossible.

### 3b. What problem does WASM solve that pure JavaScript cannot?

The analysis is honest: WASM provides marginal but real advantages over a minified JS guardian:

- **Higher reversing cost**: Requires `wasm2wat`, Binaryen's `wasm-decompile`, or Ghidra to analyze vs. simply pretty-printing JS. This raises the skill floor — a script kiddie cannot casually inspect the guardian logic.
- **State machine compactness**: WASM is efficient for a tight counter-and-digest loop with no GC overhead.
- **Separation of authorship**: The guardian can be a separate binary artifact with no DiamondJS identifiers, making it less obvious what it guards. The secrecy is in purpose, not existence — but non-obviousness has value.

What WASM **does not** provide:
- Memory isolation — WASM runs under JS, not above it. Same-origin JS can reach into WASM's imports, wrap its exports, block its network calls, or load a completely different WASM module.
- Trusted execution — no hardware enclave.
- Cryptographic attestation — any hash the client sends is a claim, not proof.

The analysis concludes correctly: **WASM is a cost-raising tool here, not a security boundary.** The meaningful security value comes from the behavioral pattern (presence/absence detection, jitter, event counters) rather than from WASM specifically. A minified JS guardian would provide ~80% of the same value.

### 3c. Is WASM-based hardening compatible with DiamondJS's LOC budget and design constraints?

The LOC budget is unaffected — the WASM blob is a separate binary artifact, not source code counted against the runtime or compiler budgets.

The real tension is with DiamondJS's transparency doctrine. "Build-time magic, runtime honesty" and "radical transparency" are first-class design principles. An opaque WASM blob is the opposite of runtime honesty. The resolution: the blob is **not the runtime** — it is a separate security satellite that Diamond exposes hook points to but does not contain. Diamond remains LLM-readable. The blob does not.

The clean architecture is:
- Diamond exposes: build ID, event hook points (e.g., unsafe call sites emit an event)
- Bootstrap JS shim: loads blob, wires hook points to blob imports
- Blob: independent binary, no Diamond identifiers

This preserves the framework's transparency doctrine and keeps the blob evolvable without touching Diamond.

### 3d. Which phase of the security architecture does WASM belong to?

**Phase 3 (online audit plugin / extended telemetry).** Clearly.

- **Phase 1 (compile-time audit biscuit)**: Pure compiler output. WASM not involved. The biscuit is a static artifact generated at build time.
- **Phase 2 (runtime raw variants + stink logging)**: Pure JS implementation. Stink logging is console output + structured log events. No WASM needed or appropriate.
- **Phase 3**: The guardian blob belongs here. Its job is behavioral telemetry over time — which requires a runtime component with state, scheduling, and a server-side partner. WASM's advantages are most useful here.

Deploying WASM before Phase 1 and 2 are implemented would be backwards. The audit biscuit and raw variants provide the semantic framework that gives the guardian's event stream meaning.

### 3e. What should be deferred and what should inform v1.2.5?

**Inform v1.2.5 now (architectural decisions):**

- The conceptual taxonomy of capability surfaces: rendering, execution, network, storage, control. Every surface in this taxonomy is a candidate for the `raw`/`stink` treatment.
- The principle that `raw` semantics must be globally consistent — if it means "no framework protection" for innerHTML, it must mean exactly the same thing for href, for style, for reactive initialization. No inconsistency.
- The event taxonomy for what constitutes a stink log entry: the WASM analysis proposes `EVENT_UNSAFE_HTML`, `EVENT_BLOCKED_EVAL`, `EVENT_DOM_DRIFT`, etc. The v1.2.5 stink logging design should match this taxonomy so Phase 3 can plug in without requiring Phase 2 changes.
- The bootstrap shim pattern: Diamond should expose clean hook points (not blob-coupled code) so a Phase 3 guardian can attach without requiring Diamond changes.

**Defer to later phases:**

- Guardian WASM blob implementation
- Spread-spectrum attestation protocol and server-side partner
- DOM drift detection via `MutationObserver`
- `should_fail_hard()` local kill switch
- Phone-home protocol design and server-side anomaly detection
- CSP recommendation profile as a DiamondJS-specific security guidance document

---

## Task 4 — `raw` Variant Pair Enumeration

Applying the triage criterion throughout: *a `raw` variant is warranted if and only if the safety of the operation requires developer intent that the compiler cannot know — specifically, knowledge about the trust level of the data source that is not inferrable from the code structure.*

---

### DOM Content Binding

| Surface | Verdict | Rationale |
|---|---|---|
| `textContent.bind` | **FORTIFY** | Always interpreted as literal text by the browser. No execution path exists regardless of content. Safe by definition. |
| `innerText.bind` | **FORTIFY** | Same as textContent. Interprets value as text only. |
| `innerHTML.bind` | **RAW PAIR** | Whether safe depends entirely on whether the data source is trusted and pre-sanitized — compiler cannot know. Default: block. Raw: `innerHTML.raw` → `DiamondCore.bindRaw(el, 'innerHTML', ...)`. Stink log emitted on every `bindRaw` call. |
| `outerHTML.bind` | **RAW PAIR** | Same rationale as innerHTML. Additionally replaces the element itself, which has larger blast radius. |
| `srcdoc.bind` on `<iframe>` | **RAW PAIR** | Equivalent to innerHTML for the iframe's document. Already in the PR's blocklist; keep under raw semantics. |

---

### Attribute Binding

| Surface | Verdict | Rationale |
|---|---|---|
| `class.bind` | **FORTIFY** | CSS class names are not execution surfaces in any browser. |
| `id.bind` | **FORTIFY** | DOM clobbering risk exists theoretically but is substantially mitigated by blocking innerHTML, which is the prerequisite for effective clobbering. |
| `data-*.bind` | **FORTIFY** | Data attributes have no execution semantics. |
| `aria-*.bind` | **FORTIFY** | Accessibility attributes have no execution semantics. |
| `href.bind` on `<a>` | **RAW PAIR** | `javascript:` and `vbscript:` protocols execute on click. `data:` URIs execute in some contexts. Compiler cannot know if the bound expression will produce a safe URL. Default: allowlist-sanitize protocols to `https:`, `http:`, `mailto:`, `tel:`, relative paths. `href.raw` bypasses sanitization. Stink log on raw calls. **This is the most important unguarded vector in v1.5.1.** |
| `src.bind` on `<img>`, `<audio>`, `<video>` | **INERT** | Modern browsers do not execute code from `src` on media elements. The request side-channel risk is real but belongs to the application's network security policy, not the framework's DOM binding security. |
| `src.bind` on `<iframe>` | **RAW PAIR** | Loads attacker-controlled content in an application-context frame, enabling phishing UI and clickjacking. Compiler cannot know trust level. Default: block or require same-origin assertion. `src.raw` bypasses. |
| `src.bind` on `<script>` | **FORTIFY** | The compiler should reject `<script>` elements in templates entirely with a compile error. Script elements have no legitimate use case in DiamondJS templates. Categorical block, not a raw variant. |
| `action.bind` on `<form>` | **RAW PAIR** | Routes form submissions to the specified URL. An attacker-controlled `action` value exfiltrates submitted form data. Compiler cannot know trust level. Default: allowlist or block external origins. `action.raw` bypasses. |
| `formaction.bind` on `<button>`, `<input[type=submit]>` | **RAW PAIR** | Same rationale as `action.bind`. |
| `style.bind` (inline attribute) | **RAW PAIR** | Though modern browsers block `javascript:` in CSS values, `url()` loading of attacker-controlled resources is a side-channel. Risk is low in evergreen browsers but nonzero. Default: sanitize. `style.raw` bypasses. Lower priority than href but should be in the list. |

---

### Event Binding

| Surface | Verdict | Rationale |
|---|---|---|
| `.trigger`, `.delegate`, `.capture` | **INERT** | Compiles to `DiamondCore.on(el, event, () => this.fn())`. The handler is always a closure reference to a class method — never a string evaluation. No injection surface. |

---

### Reactive Proxy

| Surface | Verdict | Rationale |
|---|---|---|
| `DiamondCore.reactive(obj)` from external data | **FORTIFY** | The current proxy uses `Reflect.set` unconditionally without guarding against `__proto__` or `constructor.prototype` keys. Fix by adding prototype pollution guards directly in `ReactivityEngine.createProxy()` — blocking `__proto__` and `constructor` as property names unconditionally. No raw variant is needed or appropriate: prototype pollution should never be permitted regardless of developer intent. |

---

### Collection Operations

| Surface | Verdict | Rationale |
|---|---|---|
| `Collection.push()`, `.filter()`, `.map()`, etc. | **INERT** | Pure data operations. No DOM interaction. No execution surface. |

---

### String Interpolation

| Surface | Verdict | Rationale |
|---|---|---|
| `${expression}` in templates | **FORTIFY** — conditional | Safe if and only if the compiler resolves interpolation to `textContent` assignment. This must be verified in the implementation. If any interpolation path routes to `innerHTML`, it must be treated as a RAW PAIR. **Flag for verification before v1.2.5 spec is finalized.** |

---

### Final Count

**DiamondJS v1.2.5 needs 8 `raw` variant pairs:**

1. `innerHTML.raw` (renames `unsafe-bind`)
2. `outerHTML.raw`
3. `srcdoc.raw`
4. `href.raw` (new)
5. `iframe[src].raw` (new)
6. `action.raw` (new)
7. `formaction.raw` (new)
8. `style.raw` (new)

Plus one unconditional fix (no raw variant): prototype pollution guard in `ReactivityEngine.createProxy()`.

Plus one categorical block (no raw variant): `<script>` elements in templates → compile error.

The PR already covers surfaces 1–3 (under the `unsafe` name). Surfaces 4–8 are new work.

---

## Task 5 — v1.2.5 Security Architecture Summary

### 5a. What the PR got right (carry forward)

- **Defense-in-depth enforcement**: Compile-time block + runtime guard as independent layers. Keep both. The runtime guard matters even after compile-time enforcement because it defends against hand-authored code that bypasses the compiler.
- **Single choke point**: `DiamondCore.bind()` as the universal enforcement point. All binding security flows through this function. Do not distribute security checks across call sites.
- **Case-insensitive normalization**: `property.toLowerCase()` in the sink check. Keep this. Extend to all new raw surfaces.
- **Centralized sink set**: `UNSAFE_DOM_SINK_PROPERTIES` as a `Set` in both compiler and runtime. Extend this set with the new raw variant surfaces.
- **Error quality**: CompileError with source location, description, and remediation guidance. Extend this pattern to all new raw surfaces.
- **Semantic concept**: Safe default + explicit escape hatch. The entire paradigm is correct. Rename `unsafe` → `raw` and add the missing telemetry.

### 5b. What the unofficial v1.5.1 spec got right (carry forward)

- **Build-time-only compiler**: No runtime template parsing eliminates a category of injection vectors by construction.
- **Choke point architecture**: `DiamondCore.bind()` and `DiamondCore.on()` as the sole runtime entry points for DOM mutations — ideal for security enforcement.
- **LOC discipline**: A small, auditable runtime is a security property, not just an engineering preference.
- **Radical transparency**: LLM-readable compiled output makes security audits more tractable. `[Diamond]` hints make the security implications of each binding visible in the debug view.
- **No DI magic**: No ambient authority means the blast radius of any compromise is bounded by what's explicitly imported.

### 5c. The complete `raw` variant pair list

From Task 4:

1. `innerHTML.raw` / `DiamondCore.bindRaw(el, 'innerHTML', ...)` — HTML content injection
2. `outerHTML.raw` / `DiamondCore.bindRaw(el, 'outerHTML', ...)` — Full element replacement
3. `srcdoc.raw` / `DiamondCore.bindRaw(el, 'srcdoc', ...)` — Iframe document injection
4. `href.raw` / `DiamondCore.bindRaw(el, 'href', ...)` — URL navigation (javascript: protocol guard)
5. `iframe[src].raw` / `DiamondCore.bindRaw(el, 'src', ...)` on `<iframe>` — Frame content loading
6. `action.raw` / `DiamondCore.bindRaw(el, 'action', ...)` on `<form>` — Form submission target
7. `formaction.raw` / `DiamondCore.bindRaw(el, 'formaction', ...)` on submit controls
8. `style.raw` / `DiamondCore.bindRaw(el, 'style', ...)` — Inline style injection

Unconditional fix (not a raw variant): prototype pollution guard in `ReactivityEngine.createProxy()`.

Unconditional categorical block (not a raw variant): `<script>` elements in templates → compile error.

**Stink logging applies to all 8 raw pairs at runtime, unconditionally.** Every call to `DiamondCore.bindRaw()` emits a structured `console.warn('[Diamond][stink] raw binding: ...')` entry at dev time, regardless of the property.

**Audit biscuit is generated every build.** It enumerates all raw call sites: property, component, line number, sink type. Non-configurable. The compiler generates it as a sidecar artifact (`diamond-security-audit.json`) alongside the compiled output.

### 5d. Blind spots that v1.2.5 must address

Ranked by actual risk given DiamondJS's architecture:

1. **URL protocol injection via `href.bind`** — HIGH. The most common XSS vector that bypasses innerHTML hardening entirely. A developer or LLM writing `href.bind="userInput"` has created a click-triggered XSS with zero framework resistance. Needs a URL protocol allowlist in the default `bind()` path for href.

2. **Prototype pollution in `ReactivityEngine.createProxy()`** — HIGH. Reactive state initialized from `JSON.parse(apiResponse)` is common. Any API response that includes keys matching `__proto__` or `constructor` could pollute the prototype chain if not guarded. The fix is a 3-line property filter in the proxy's `set` trap. No raw variant. No escape hatch. Just fix it.

3. **Form submission exfiltration via `action.bind` and `formaction.bind`** — MODERATE. Less common than href binding but a real data exfiltration vector. Should be in the raw list for v1.2.5.

4. **Iframe content loading via `iframe[src].bind`** — MODERATE. Enables phishing UI within the application chrome. Should be in the raw list.

5. **Inline style injection via `style.bind`** — LOW-MODERATE. Modern browsers block `javascript:` in CSS. The `url()` side-channel risk is real but low-severity. Include in the raw list but deprioritize sanitization complexity — a simple check for `javascript:` or `expression(` in the style string may be sufficient for the default path.

### 5e. What belongs in v1.2.5 vs. later phases

**v1.2.5 scope:**

- Rename `unsafe-bind` → `raw` throughout (template syntax, API, types, docs, tests)
- Rename `DiamondCore.bindUnsafe()` → `DiamondCore.bindRaw()`
- Extend raw variant set from 3 sinks to 8 (add href, iframe src, action, formaction, style)
- Add URL protocol sanitization to the default `bind()` path for href (allowlist: https, http, mailto, tel, relative paths)
- Fix prototype pollution in `ReactivityEngine.createProxy()` — guard `__proto__`, `constructor`, `__lookupGetter__` as property keys
- Add compile-time block for `<script>` elements in templates
- Implement stink logging: every call to `bindRaw()` emits a structured `console.warn('[Diamond][stink] raw binding: ...')` entry at dev time
- Implement audit biscuit: compiler generates `diamond-security-audit.json` on every build, listing all `.raw` call sites with property, component, and line number
- Fix `bindRaw()` to default to one-way binding (no setter), requiring explicit opt-in for two-way raw binding
- Update `UNSAFE_DOM_SINK_PROPERTIES` / sink sets in both compiler and runtime to cover the full 8-surface list
- Update docs, FAQ, README to reflect `raw` naming

**Later phases (not v1.2.5):**

- Guardian WASM blob (Phase 3)
- Spread-spectrum attestation and server-side telemetry
- DOM drift detection via `MutationObserver`
- Local kill switch (`should_fail_hard()`)
- CSP recommendation profile document ("The Diamond Security Profile")
- `fetch`/network surface raw variants (when network helpers are added to the framework)
- Storage surface raw variants (when storage helpers are added)
- Scheduler DoS hardening

### 5f. Open questions for the spec design session

These require human judgment to resolve and should not be papered over.

1. **Does `${...}` interpolation compile to `textContent` or `innerHTML`?** If there is any code path in the current compiler where interpolation resolves to an `innerHTML` write (e.g., for rich-text scenarios), it must be reclassified as a raw pair. Needs implementation verification before v1.2.5 spec is finalized.

2. **One-way vs. two-way default for `raw` bindings**: The PR implements `bindUnsafe` as two-way. Is there a legitimate use case for two-way raw binding on innerHTML? The default behavior of a raw bind should be stated explicitly in the spec. Recommendation: default to one-way. Two-way raw should require a separate flag or method signature.

3. **Href sanitization scope**: Should `href.raw` fully bypass protocol sanitization, or should protocol blocking be unconditional even in raw mode (with `raw` only bypassing other checks)? The `raw`/`stink` paradigm says "bypasses all framework protection" — but unconditional `javascript:` blocking might be defensible as a framework invariant even in raw mode. This is a principle-of-no-surprise question with no obvious right answer.

4. **Style attribute sanitization implementation**: What constitutes "sanitized" for an inline style string? A regex check for `javascript:` and `expression(` may be sufficient, or it may require a full CSS parser. The complexity determines whether the default path is LOC-affordable in v1.2.5.

5. **Audit biscuit format and placement**: Where does `diamond-security-audit.json` live? In the build output directory alongside the bundle? In the project root? Committed to version control (revealing raw site locations to reviewers) or in `.gitignore` (keeping it local)? Committing it makes raw site review part of code review; ignoring it keeps it ephemeral. This is a DX decision with security implications.

6. **Does the version number hold?** The full 8-surface raw variant list plus prototype pollution fix plus audit biscuit is substantive work. The renaming of `unsafe` → `raw` is a breaking change if any downstream code references `bindUnsafe`. If there are known users, v1.3.0 is more honest than v1.2.5. If DiamondJS has no external consumers yet, v1.2.5 is fine.

---

*This document is the input brief for the v1.2.5 specification co-design session. It is not the spec. Every actionable recommendation above is provisional until validated against the actual implementation.*
