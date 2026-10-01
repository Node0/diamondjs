# Changelog

All notable changes to DiamondJS are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). All nine `@diamondjs/*` packages ship in exact-pin lockstep, so one version number covers the whole constellation.

Each release's *why* lives in its design record under `impl_docs/plans/` and `impl_docs/spec/`; the narrative account of how it was built is `impl_docs/project_update_log.md`.

## [Unreleased]

### Fixed
- **The router's link interceptor routed anchors that are not navigation** (#14). A same-origin `<a href>` click was claimed even when the anchor was a file save or opened elsewhere, so the usual `<a download href="blob:…">` + `click()` idiom landed on the not-found route instead of downloading (a `blob:` URL reports its creating document's origin). The interceptor now leaves these to the browser: anchors with `download`, a `target` other than `_self`, `rel="external"`, and any href whose scheme is not `http` / `https` (`blob:`, `data:`, `mailto:`, `tel:`).
- **The router claimed hash-only links and dropped the query and hash on navigation** (#20). `<a href="#section">` was intercepted and nothing happened: no scroll, no hash in the URL. A link to a fragment of the page already showing is now left to the browser. `<a href="/about?tab=2#x">` navigated to `/about`; a link's query and hash are now carried into the URL, and initial load and Back / Forward keep them too (matching still uses the path only). A route's declared `query` converters now parse the query of the URL being navigated to — on a link click they used to read the page being left.

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

[2.2.3]: https://github.com/Node0/diamondjs/releases/tag/v2.2.3
[2.2.2]: https://github.com/Node0/diamondjs/commit/431d824
[2.2.1]: https://github.com/Node0/diamondjs/releases/tag/v2.2.1
[2.2.0]: https://github.com/Node0/diamondjs/releases/tag/v2.2.0
[2.1.1]: https://github.com/Node0/diamondjs/releases/tag/v2.1.1
[2.1.0]: https://github.com/Node0/diamondjs/blob/main/impl_docs/plans/DiamondJS_v2.1_Amendment_A2_Design_Record.md
[2.0.0]: https://github.com/Node0/diamondjs/blob/main/impl_docs/plans/DiamondJS_v2.0_Design_Decision_Record.md
