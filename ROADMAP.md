# 🗺️ DiamondJS Roadmap
 
## 🛠️ Current Status
 
**✅ v2.3.0 shipped — published to npm.** Release notes: [CHANGELOG.md](CHANGELOG.md).
 
DiamondJS has moved from design into a shipped, spec-governed 2.x series. Every release lands with its design record: the v2.0 DDR, Amendment A2 (v2.1), Amendment A3 + the Router section (v2.2), the Destinations record (v2.2.1), and the Lifecycle Contract design record (v2.3.0).
 
- ✅ **v2.0** — Security-by-default binding language: single auditable sink allowlist (fail-closed), `raw` escape hatch + stink gate, `.calls`/`.capture`, converter pipes with `ParseResult`, `[Diamond]` hint comments
- ✅ **v2.1** — Scale and completeness: `switch`/`case`/`default`, gated attribute spread, `Collection<T>` at 100K+ items, `DiamondCore.delegate()`, two-way converter chains, `error-into`, VLQ source maps, `@diamondjs/primafacie` logging
- ✅ **v2.1.1** — Conformance patch: every §16 fix-the-code defect closed, including eager disposal of detached `if`/`switch` branches (D-1) and the scheduler stale-flush retention fix (D-7)
- ✅ **v2.2.0** — The router: nested routes, named multi-outlet targeting, specificity matching, atomic two-phase navigation, class-based guards with a fail-closed execution envelope, `Pending` departure safety, `basePath`, `route-check` build gate, `run_mode` dev/prod builds, logging consolidation (one vocabulary, browser→server relay, datestamped files)
- ✅ **v2.2.1** — `Destination`: one explicit tagged-union vocabulary (`route-id` / `route-path` / `site-path` / `external-url`) shared by redirects and guard denials; `IntConverter`/`SlugConverter` batteries; `app`/`dev`/`all` meta-packages
- ✅ **v2.2.2** — The bootstrap npm publication: all nine `@diamondjs/*` packages live on the registry (verified from clean-room npm *and* Bun installs). `@diamondjs/dev` now ships the complete toolchain — compiler, Parcel transformer, Parcel, TypeScript, and `stink-check`/`route-check` as published bins. Plus the preflight repairs it forced: the phantom `@parcel/source-map` devDependency, a stale lockfile, a lint gate that had never actually run, per-package READMEs, and the license reconciled to MIT everywhere
- ✅ **v2.2.3** — First-real-app hardening: the first application built on the published constellation surfaced five defects in its first day (#7–#11), all fixed upstream — `if`/`switch`/`repeat` render on first mount, `<select>` binds after its options, static `<a href>` passes the sink gate (+ `role` inert), `@reactive` survives `useDefineForClassFields: true`, `route-check` loads template/style imports. Plus `npm pkg fix` manifest normalization and the first `CHANGELOG.md`
- ✅ **v2.2.4** — Second hardening pass from the same application (#14, #17–#20, #25–#29): the link interceptor leaves non-navigation anchors and same-page fragment links to the browser and keeps a link's query and hash; router URLs behave as in HTML (`navigate(url)`, scroll to the fragment after a navigation, Back / Forward restore the position); a reactive array re-renders on `push()` and every other in-place mutation; multi-root and structural-only bodies are removed through their mounted range; author text reaches compiled output through one encoder (backslashes, multi-line attribute expressions); a literal `${` can be written as `\${` or with an entity; `route-check` works on Node 22; a fresh clone builds in one `npm run build`
- ✅ **v2.3.0** — The lifecycle contract and preserved template text (PRs #39, #40; #15, #38): six phases with one callback each (`constructed`, `mounting`, `mounted`, `unmounting`, `unmounted`), `mounted` meaning connected and delivered child-first, `mount()` / `unmount()` / `dispose()` final, rollback by inventory, two scopes so a class-field `debounce` survives a remount, `whileMounted(fn)`, `DiamondCore.child` as the seam for compiled composition; template text kept exactly as the HTML parser produces it; one consolidated specification per version under `docs/spec/`
**5,645 / 9,500 production LOC (59.4%) · 960 tests passing · the whole framework still fits in an LLM context window.**
 
---
 
## 🔜 v2.2.5 — Release hygiene (patch)
 
- [x] ~~Fix phantom `@parcel/source-map ^2.2.1` devDependency~~ — landed in v2.2.2 (npm preflight)
- [x] ~~`npm pkg fix` cleanup — normalize `repository.url` to the `git+https://` form npm auto-corrects at publish time~~ — landed in v2.2.3
- [x] ~~First-real-app findings (#7–#11)~~ — landed in v2.2.3 (see above)
- [x] ~~Second-pass findings (#14, #17–#20, #25–#29)~~ — landed in v2.2.4 (see above)
- [ ] Add `@diamondjs/guards` to the `check-loc` budget report (header claims 400 LOC budget; report omits the package)
- [x] ~~First build on a fresh clone fails because runtime is built before primafacie (#25)~~ — landed in v2.2.4; the root build now runs in dependency order
- [x] ~~`route-check` on Node 22: the `data:` URL stub and the CommonJS module shape (#27)~~ — landed in v2.2.4; `@diamondjs/dev` requires tsx ≥ 4.23.15
- [ ] Tag `v2.2.2` retroactively (published 2026-08-20 without a git tag; `v2.2.3` onward are tagged)
---
 
## 🎯 v2.3.1 — Composition & reach
 
- [x] ~~Template text preserved exactly (#15)~~ — landed in v2.3.0 (see above)
- [ ] **Template-driven component composition** — the signed v2.3 milestone (D-21 closes for real): `<child-component>` instantiation from templates, explicit props-down/events-up, compiler-owned cleanup, its own DDR section before any code
- [ ] **Scaffolding CLI** — packages are published as of v2.2.2; what remains is the interactive `npm create diamond` script covering flat/nested component modes, `app/config/config.json`, and a routed app-shell starter
- [ ] **`--standalone` build flag** — compile an entire app into a single `.html` file that opens from anywhere (file://, USB stick, air-gapped review). Includes intelligent pre-compilation asset analysis to prevent WASM inclusion issues — WASM modules can't inline as data URIs in all contexts, so the analyzer detects them and fails loud with guidance rather than emitting a silently broken file
- [ ] **Bun-based server-side preparation** — groundwork for the Diamond 3.0 server story: runtime/primafacie modules audited for Bun compatibility, `wsReceiver` + datestamped `fileSink` validated under Bun, no Node-only API assumptions in the shared-vocabulary path (guards' `check` must eventually run server-side)
- [ ] **First `@diamondjs/guards` batteries** — promote from recorded candidates (`OAuthGuard`, `WebAuthnGuard`, `CapabilityGuard`, `TenantGuard`) as the first real applications produce a guard inventory
---
 
## 📋 Recorded backlog (designed or scoped, not yet scheduled)
 
- `canLeave` route-scoped departure veto — popstate compensation semantics; history entries are already stamped (`{ diamondNavId, index }`) for forward-compatibility
- Keep-alive / route caching · stacked overlay routing · transitions · data resolvers
- Per-route parameterized guards (`{ use, state }`) · `ctx.state` request-scoped store · `challenge` decision type
- Attribute interpolation support (currently a fail-loud diagnostic)
- Compiler-injected `Print` caller-name memoization (kills the per-call stack walk if a hot path ever needs it)
- Mount-outside-`captureScope` leak heuristic (dev warning, primafacie-adjacent)
---
 
## 🔭 Diamond 3.0 horizon — the server side
 
The first release where DiamondJS spans the wire: tight server-side integration (Bun-first, per the v2.3 groundwork), server-enforced guards completing the **"client predicts, server enforces"** principle already written into the v2.2 spec, and a deliberately opaque WASM verification module with compiler-generated hash expectations held server-side — the one intentional exception to runtime transparency, with its rationale recorded in the DDR before a line ships (transparency is a promise to the developer about *their* application, not to every process about every module).