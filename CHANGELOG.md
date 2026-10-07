# Changelog

All notable changes to DiamondJS are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). All nine `@diamondjs/*` packages ship in exact-pin lockstep, so one version number covers the whole constellation.

Each release's *why* lives in its design record under `docs/spec/vX.Y.Z/`; the narrative account of how it was built is `impl_docs/project_update_log.md`.

## [Unreleased]

The lifecycle names promised states and the code delivered actions: `mount()` meant "template built and appended", which is in the document only for a root or a route component, and nothing told a component when it actually reached the document. Every real app worked around it by hand. The lifecycle is now a contract (spec §4.2, §4.4, §4.6; the Lifecycle Contract design record, filed under `docs/spec/v2.3.0/`). The oldest open defect goes with it: template text is now preserved exactly (#15, spec §5.9).

### Breaking
- **`mount()`, `unmount()` and the new `dispose()` are final.** A subclass that overrides `mount` or `unmount` throws at construction, naming the callback to use instead. Migration: `override mount(host) { super.mount(host); … }` becomes `override mounted() { … }`; `override unmount() { …; super.unmount() }` becomes `override unmounting() { … }`.
- **`update()` is removed.** Nothing in the runtime, compiler or router called it; props arrive as writes to a child's `@reactive` fields, and the child's own reactivity is the notification.
- **`unmount()` on an instance that is not mounted throws** (it used to be a silent no-op).
- **A structural at a template root is placed by the connection drain**, not on a microtask: a component mounted into a host that is *not* in the document no longer renders a root-level `if` / `repeat` / `switch` output until it is connected (dev builds report the detached root once). Root hosts must be connected — which every real app already does; tests that mounted into `document.createElement('div')` append the host to `document.body` instead.
- **A disposed branch is a detached one.** When a structural's branch or row, or a hand-written `captureScope`, is disposed, its nodes leave the DOM along with its effects and listeners.

### Added
- **Six phases, one callback each:** `constructed()`, `mounting()`, `mounted()`, `unmounting()`, `unmounted()`, plus the terminal `faulted` and `disposed`. `mounted()` runs only when the component's range is in the document, root-level structurals are placed and its children's `mounted()` have run (child-first) — so measuring, focusing and observers belong there. `@reactive` fields are repaired at `constructed()`, before any callback reads them.
- **`phase` and `generation`** (reactive), **`history()`** (the last 32 transitions as `LifecycleRecord`s), **`fold()`**, **`domPing()`** (dev verification of the snapshot against the DOM), **`ensureConstructed()`**.
- **Rollback by inventory.** Every framework acquisition registers into the current scope at creation; a throw anywhere in a mount — `mounting()`, `createTemplate()` at any point, the append, `mounted()` — disposes that scope (LIFO, each cleanup in its own `try`) and the instance returns to `constructed` (first mount) or `unmounted` (remount). A cleanup that throws faults the instance; `faulted` and `disposed` are terminal.
- **Two scopes.** `debounce` / `throttle` cancels live in the instance scope: they run at `unmount()` and are kept, so a class-field one-liner works again after a remount (the documented "re-mount caveat" is gone).
- **`whileMounted(fn)`** binds a callback to the current mount generation; after `unmount()` the wrapper declines and records `stale` — for `requestAnimationFrame`, fetch and other callbacks the inventory cannot cancel.
- **`DiamondCore.child(instance, host)`**, the runtime call compiled composition (D8) will emit: the child is disposed with the parent's scope and delivered child-first when the parent connects. **`Scope`**, `DiamondCore.openScope` / `closeScope` / `withScope` / `drain` are public for the same reason `captureScope` is.
- Transitions emit through `Print`: failures `FAILURE`, faults `CRITICAL`, stale callbacks `WARNING`, successes `STATE` in dev builds.
- Lifecycle tests run under both toolchain shapes (TC39 decorators + `[[Define]]` fields, and legacy decorators + `[[Set]]`): `npm run test:lifecycle`.

### Changed
- **Template text is kept exactly as the HTML parser produces it** (#15, spec §5.9). Whitespace-only text nodes were dropped and static text was trimmed, so `press <em>Start job</em> on` rendered "pressStart jobon" and an NBSP-only node vanished. Nothing is collapsed, trimmed or dropped now, static and interpolated text alike; collapsing is CSS's job. The only whitespace the compiler consumes is syntax: between an `if` and the `else-if` that follows it, directly inside `<switch>` between cases, and a whitespace-only root before the first or after the last root of a template. There is no option. One rendering consequence: indented inline siblings — buttons, inputs, links on separate lines — now get the ordinary HTML gap between them, as plain HTML would, unless their parent is flex or grid (which does not render it). Tags written flush stay flush.
- **Compiled output appends each parent's children in one `append(...)` call**, in DOM order, static text as string arguments — the generated code reads as the markup did. Only interpolated text keeps a `createTextNode` and a `text_N` variable, so a static-only template numbers nothing but its elements and anchors. A call past the usual width is written one argument per line. Interpolated text with line breaks is emitted on one line (`\n` escaped) so source-map lines stay right.

### Fixed
- **Whitespace between text and inline elements was dropped** (#15) — see **Changed**.
- **A throw inside `createTemplate()` left the component flagged as mounted and leaked everything acquired before the throw** — the router's rollback only unmounted components that had finished mounting. (`captureScope` lost its scope on a throw for the same reason.)
- **A page whose template root is a structural did not scroll to its hash target** (#38): the root-level branch was placed on a microtask, after the router's scroll step. Placements now run in the connection drain, before `mounted()` and before the scroll.
- **A remounted component had no `debounce` / `throttle` cancels** — the first `unmount()` emptied the flat cleanup list.
- **A constructor throw during a route commit dropped the already-constructed incoming components without disposal.** Each incoming component is now constructed in a scope of its own and `constructed()` runs before any of them mounts; a failed commit disposes the whole attempt, and a departed occupant is disposed once the commit stands.

## [2.2.4] — 2026-10-06

The same application kept surfacing defects as it grew: a router that claimed links it should have left alone and did not scroll, bodies that could not be removed, template text that could not say what its author meant, a list that did not grow when pushed to, and a build gate that failed on Node 22. Ten issues are fixed in this patch (#14, #17–#20, #25–#29). No API is removed; the behaviour changes are listed under **Changed**.

### Fixed
- **The router's link interceptor routed anchors that are not navigation** (#14). A same-origin `<a href>` click was claimed even when the anchor was a file save or opened elsewhere, so the usual `<a download href="blob:…">` + `click()` idiom landed on the not-found route instead of downloading (a `blob:` URL reports its creating document's origin). The interceptor now leaves these to the browser: anchors with `download`, a `target` other than `_self`, `rel="external"`, and any href whose scheme is not `http` / `https` (`blob:`, `data:`, `mailto:`, `tel:`).
- **The router claimed hash-only links and dropped the query and hash on navigation** (#20). `<a href="#section">` was intercepted and nothing happened: no scroll, no hash in the URL. A link to a fragment of the page already showing is now left to the browser. `<a href="/about?tab=2#x">` navigated to `/about`; a link's query and hash are now carried into the URL, and initial load and Back / Forward keep them too (matching still uses the path only). A route's declared `query` converters now parse the query of the URL being navigated to — on a link click they used to read the page being left.
- **Multi-root bodies could not be removed** (#17). A `<case>` / `<default>` body or a component template with two or more roots mounts as a `DocumentFragment`, which is empty once inserted — so `DiamondCore.switch()` and `Component.unmount()` called `.remove()` on a node that no longer held anything. Switching away from a two-root case logged `active.node.remove is not a function` and left the old branch in place; unmounting a two-root component threw after its cleanups had run and left the host populated. The runtime now tracks the mounted range (first/last node, removed as the siblings stand at removal time, bounded by the owning anchor) and `if()`, `switch()` and `Component` all remove through it.
- **A body that is only a structural leaked its output — a second bug, present with a single root** (#17). A `<case>` whose whole body is `<p if="…">` left `<p>X</p>` behind on switch-away, and a template whose only root is an `if` / `repeat.for` left its rendered nodes in the host on `unmount()`: the body's one root is the structural's anchor, and its output sits *before* that anchor, outside anything the old code removed. The same held for a multi-root body that begins with a structural. These are now removed with the rest of the range.
- **Backslashes in interpolated text were read as JavaScript escapes** (#19). `<p>C:\temp\notes ${name}</p>` rendered a real tab and newline, and `<p>C:\users\x ${name}</p>` compiled to output that did not parse (`Invalid Unicode escape sequence`); the same text without an interpolation was fine. Every piece of author text written into compiled output — text, attribute names and values, hint comments — now goes through one encoder per position.
- **A multi-line attribute expression broke the compiled output** (#19). A line break inside a quoted expression (`if="a &&⏎ b"`, a wrapped binding or event expression) ended the `// [Diamond]` hint comment above it and left the rest of the expression as code. Hint comments now fold line breaks to a space.
- **Template text had no way to write a literal `${`** (#29). Every `${` started an interpolation, and the HTML escape did not survive: `&#36;{` was decoded back into a live interpolation before the compiler looked. Interpolation syntax is now read from the raw template source, with two spellings for a literal: `\${name}`, and an entity (`&#36;{name}`, `&#x24;{`, `&dollar;{`, `$&#123;`, `$&lbrace;` — an encoded character is never syntax). A run of backslashes directly before `${` reads by the JavaScript rule (`\\${name}` is one backslash, then the value); a backslash anywhere else stays literal text. The same rules hold in plain attribute values, so `placeholder="e.g. \${HOME}"` can now be written; an unescaped `${` there is still the `attr-interpolation-unsupported` error.
- **`if` / `else-if` chain collection consumed the whitespace after a finished chain** (#18). Latent in this release — the compiler still trims that whitespace anyway (see Known issues) — and fixed now so that #15 can land on it: whitespace between two branches is syntax, whitespace after the last branch is content, and only ASCII whitespace separates branches (an NBSP between an `if` and an `else-if` orphans the `else-if`).
- **`push()` on a reactive array did not re-run `repeat.for`** (#26). Only reassigning the array re-rendered. A new index went through the proxy's set trap as a new key, which woke only key-set readers, and the `length` write that followed changed nothing because the array had already bumped it. The trap now treats a new index on an array as the length change it is, so `push`, `unshift`, `splice` insertion and assignment past the end re-render like `pop`, `shift`, `splice` removal and `length = 0` already did. Mutations in one tick still batch into one flush.
- **A route navigation did not scroll, `navigate()` ignored a query and hash, and `href="#"` was claimed** (#28). After clicking `<a href="/b?tab=2#x">` the page stayed where it was, Back remounted the previous page at the top, `navigate('/about?tab=2#x')` went to `/about`, and an empty fragment link went through the router and did nothing. URLs now behave as in HTML: `navigate()` reads its argument as a URL and shares one code path with the interceptor; after a navigation commits the router scrolls to the hash target, a navigation without a hash starts at the top, and Back / Forward return to where the page was left once it has mounted; `href="#"` passes through to the browser like any same-page fragment link. Checked in Chromium.
- **`route-check` failed on Node 22** (#27), for both kinds of consumer. On the ESM loader path tsx appended `?tsx-namespace=…` to the `data:` URL of the inert template stub, which made the stub's source fail to parse; the stub is now served by a load hook for its URL whatever is appended, and its source ends in a comment. On the CommonJS path tsx 4.21 under plain Node 22 could not resolve the routes module's extensionless imports and surfaced the module without its named exports; tsx 4.23.15 fixes both, so `@diamondjs/dev` now requires it, and the bin unwraps the CommonJS module shape as a backstop. The built bin and the whole test suite pass on Node 20 and 22.
- **The first `npm run build` on a fresh clone failed** (#25). The root build built `runtime` before `primafacie`, whose types runtime's declaration build needs. The first stage now builds them in dependency order, so `npm ci && npm run build && npm test` works on a fresh clone in one pass.

### Changed
- **`\${name}` now renders `${name}`** (#29). Published 2.2.3 rendered `<p>\${name}</p>` as `${this.name}` — the compiler's own lowered expression, leaked as text.
- **An entity-encoded `${` is text, never an interpolation** (#29). `<p>&#36;{name}</p>` used to render the value of `name`; it now renders `${name}`. In a plain attribute it used to be the `attr-interpolation-unsupported` error; it is now accepted as literal text.
- **A Windows path directly before an interpolation needs `\\${`** (#29). `C:\Users\${user}` renders `C:\Users${user}`; write `C:\Users\\${user}` for a path followed by a value. Each `\${` raises an `escaped-interpolation` diagnostic (severity `info`, never gated) that says so.
- **Mounted-output shape** (#17): a body that **begins with** a structural directive (`if`, `repeat.for`, a reactive `<switch>`) now mounts behind one empty comment (`<!---->`) that fixes the start of its range. Nothing else gains a node: single element/text roots, static multi-root bodies, empty-case and dead-switch placeholders mount exactly as before.
- **Compiled-output shape** (#19): a tab or other control character inside static text or an attribute value is emitted as an escape (`\t`) instead of the raw character. The value is the same.
- **A new navigation without a hash starts at the top; Back / Forward restore the scroll position** (#28). A page that relied on keeping its scroll position across a route change will now start at the top, as a plain HTML navigation does. The browser's own `scrollRestoration` setting is left alone.
- **`navigate()` reads its argument as a URL** (#28). `navigate('/about?tab=2#x')` now carries the query and hash; `navigate('/about')` is unchanged. One side effect: the pathname is percent-encoded as a link's would be (`navigate('/café')` writes `/caf%C3%A9`), so a link and the equivalent call now agree.
- **`@diamondjs/dev` requires tsx 4.23.15 or newer** (#27); the range was `^4.7.0`.
- A template that touches none of the above compiles byte-for-byte as in 2.2.3.

### Documentation
- README: the router link pattern lists what passes through (`#` alone included) and states that a link's query and hash are kept; a paragraph on `navigate(url)` and the scroll rules; Reactivity states that a `@reactive` array re-renders on in-place mutation; Template Syntax gains the literal-`${` rules, with the `String.raw` guidance for templates built from JavaScript; a Known issues pointer.
- Package READMEs: runtime (link pass-throughs, query and hash, `navigate(url)` and scroll, in-place array mutation, mounted-range removal), compiler (literal `${`, the `escaped-interpolation` diagnostic), Parcel transformer (info diagnostics are logged), dev (`route-check` on Node 20 and 22, the tsx requirement).
- `examples/hello-world`: `add()` pushes onto the task list instead of reassigning it.
- `impl_docs/working_notes.md`: implementation realities behind each fix.

### Known issues
- **Whitespace between inline elements is still dropped** (#15): `press <em>Start job</em> on` renders "pressStart jobon". Fixed in 2.3, where template text is preserved exactly. Until then, put the space inside the inline element or use CSS.

## [2.2.3] — 2026-09-29

The first application built on the published constellation surfaced five defects within its first day (issues #7–#11). All five are fixed upstream in this patch; no API is removed.

### Fixed
- **Structural directives rendered nothing on first mount** (#7). `if` / `else-if`, `switch` and `repeat.for` whose condition was truthy (or list non-empty) at mount time appeared only on the *next* change: the compiler emitted the `DiamondCore.if/switch/repeat` call before the parent appended the anchor, and the runtime's synchronous first pass found a detached anchor. The compiler now appends the anchor first, so every nested structural renders synchronously on mount; the runtime's new detached-anchor guard (`DiamondCore.placeBefore`) places a branch on the next microtask when the anchor has no parent yet (a structural at the template root, hand-written templates).
- **`<select value.two-way>` lost its initial model value** (#9). A `<select>`'s bindings and handlers are now emitted after its `<option>` children — including `repeat.for`-generated ones — behind a `[Diamond]` hint, so the first pass finds the options it needs.
- **Static `<a href="/path">` failed `stink-check`** (#8). A static `href` on `<a>` / `<area>` whose literal target is scheme-less or carries `http`, `https`, `mailto` or `tel` now gates clean — the link pattern spec §6.3 already names. `javascript:`, `data:` and every unenumerated scheme still warn; a *bound* `href` still warns; `href` stays off the sink allowlist.
- **`@reactive` was a silent no-op under `useDefineForClassFields: true`** (#11) — TypeScript's default for ES2022+ targets and what Parcel 2.16 / SWC emit. Class fields defined with [[Define]] semantics shadowed the reactive accessor. `Component.mount()` now re-routes such fields through their accessors (`adoptDefinedReactiveFields`), on both the legacy and the TC39 decorator paths; dev builds report the repair once per class. Set `"useDefineForClassFields": false` alongside `"experimentalDecorators": true` regardless — now documented in the Quick Start.
- **`route-check` failed with `ERR_UNKNOWN_FILE_EXTENSION`** for route maps whose page components import `*.diamond.html` templates or `*.css` (#10) — i.e. the recommended project layout. The bin now loads both as inert stubs on both loader paths tsx can take (`"type": "module"` consumers and CommonJS ones).

### Changed
- Compiled-output shape: a structural's branch bodies are numbered after the siblings that follow it in source, and a `<select>`'s wiring block follows its options. Nothing in the public API changes.
- `role` is inert metadata alongside `data-*` / `aria-*` at both gates (compile-time `gateSink`, runtime spread). New `isInertMetadataKey` export from `@diamondjs/runtime`; `isDataOrAriaKey` is unchanged.
- Manifests normalized by `npm pkg fix` (`repository.url` → `git+https://…`, `@diamondjs/dev` bin paths).

### Documentation
- Quick Start gains the `tsconfig.json` step and the reason both decorator flags are required; the runtime README carries the same note; `examples/hello-world` sets `useDefineForClassFields: false` explicitly.
- `@diamondjs/dev` README: `route-check` loads template/style imports as inert stubs.
- `impl_docs/working_notes.md`: implementation realities behind each fix.

## [2.2.2] — 2026-08-20

First publication of all nine `@diamondjs/*` packages to npm, verified from clean-room npm and Bun installs.

- `@diamondjs/dev` ships the complete toolchain: compiler, Parcel transformer, Parcel, TypeScript, and `stink-check` / `route-check` as real bins (route-check loads consumer `.ts` route modules via tsx).
- Preflight repairs: nonexistent `@parcel/source-map ^2.2.1` devDependency reverted, stale lockfile regenerated, ESLint config renamed so the lint gate actually runs, per-package READMEs, license reconciled to MIT everywhere.

## [2.2.1] — 2026-08-16

- `Destination` — one explicit tagged union (`route-id` / `route-path` / `site-path` / `external-url`) shared by route redirects and guard denials; never inferred from string shape. `Deny` retired; `Guard.deny()` returns a `Destination`.
- `IntConverter`, `SlugConverter` in `@diamondjs/converters`.
- `@diamondjs/app`, `@diamondjs/dev`, `@diamondjs/all` meta-packages with the exact-pin lockstep check.

## [2.2.0] — 2026-08-16

The router: nested routes, named multi-outlet targeting, specificity matching, atomic two-phase navigation, class-based guards with a fail-closed execution envelope, `Pending` departure safety, `basePath`, the `route-check` build gate, `run_mode` → `__DIAMOND_DEV__` dev/prod builds, and the logging consolidation (one vocabulary through `Print`, browser→server relay, datestamped files).

## [2.1.1] — 2026-08-16

Conformance patch closing every §16 fix-the-code defect: eager disposal of detached `if` / `switch` branches (D-1), the scheduler stale-flush retention fix (D-7), `repeat` duplicate-primitive reconciliation (D-2), static-attribute sink gating (D-10), fail-loud diagnostics for unshipped component composition (D-21).

## [2.1.0] — 2026-07-07

`switch` / `case` / `default`, gated attribute spread, `Collection<T>` for 100K+ items, `DiamondCore.delegate()`, two-way converter chains, `error-into`, VLQ source maps, `@diamondjs/primafacie` logging. Design record: Amendment A2.

## [2.0.0] — 2026-06-29

Security-by-default binding language: a single fail-closed sink allowlist, the `raw` escape hatch with the two-tier stink gate, `.calls` / `.capture`, converter pipes with the `ParseResult` contract, `[Diamond]` hint comments on every generated call. Design record: the v2.0 Design Decision Record.

Earlier work (Phase 0, v1.3 → v1.5.1) is chronicled in `impl_docs/project_update_log.md`.

[2.2.4]: https://github.com/Node0/diamondjs/releases/tag/v2.2.4
[2.2.3]: https://github.com/Node0/diamondjs/releases/tag/v2.2.3
[2.2.2]: https://github.com/Node0/diamondjs/commit/431d824
[2.2.1]: https://github.com/Node0/diamondjs/releases/tag/v2.2.1
[2.2.0]: https://github.com/Node0/diamondjs/releases/tag/v2.2.0
[2.1.1]: https://github.com/Node0/diamondjs/releases/tag/v2.1.1
[2.1.0]: https://github.com/Node0/diamondjs/blob/main/docs/spec/v2.1.0/DiamondJS_v2.1_Amendment_A2_Design_Record.md
[2.0.0]: https://github.com/Node0/diamondjs/blob/main/docs/spec/v2.1.0/DiamondJS_v2.0_Design_Decision_Record.md
