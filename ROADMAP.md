# 🗺️ DiamondJS Roadmap
 
## 🛠️ Current Status
 
**✅ v2.2.2 shipped — published to npm.**
 
DiamondJS has moved from design into a shipped, spec-governed 2.x series. Every release lands with its design record: the v2.0 DDR, Amendment A2 (v2.1), Amendment A3 + the Router section (v2.2), and the Destinations record (v2.2.1).
 
- ✅ **v2.0** — Security-by-default binding language: single auditable sink allowlist (fail-closed), `raw` escape hatch + stink gate, `.calls`/`.capture`, converter pipes with `ParseResult`, `[Diamond]` hint comments
- ✅ **v2.1** — Scale and completeness: `switch`/`case`/`default`, gated attribute spread, `Collection<T>` at 100K+ items, `DiamondCore.delegate()`, two-way converter chains, `error-into`, VLQ source maps, `@diamondjs/primafacie` logging
- ✅ **v2.1.1** — Conformance patch: every §16 fix-the-code defect closed, including eager disposal of detached `if`/`switch` branches (D-1) and the scheduler stale-flush retention fix (D-7)
- ✅ **v2.2.0** — The router: nested routes, named multi-outlet targeting, specificity matching, atomic two-phase navigation, class-based guards with a fail-closed execution envelope, `Pending` departure safety, `basePath`, `route-check` build gate, `run_mode` dev/prod builds, logging consolidation (one vocabulary, browser→server relay, datestamped files)
- ✅ **v2.2.1** — `Destination`: one explicit tagged-union vocabulary (`route-id` / `route-path` / `site-path` / `external-url`) shared by redirects and guard denials; `IntConverter`/`SlugConverter` batteries; `app`/`dev`/`all` meta-packages
- ✅ **v2.2.2** — The bootstrap npm publication: all nine `@diamondjs/*` packages live on the registry (verified from clean-room npm *and* Bun installs). `@diamondjs/dev` now ships the complete toolchain — compiler, Parcel transformer, Parcel, TypeScript, and `stink-check`/`route-check` as published bins. Plus the preflight repairs it forced: the phantom `@parcel/source-map` devDependency, a stale lockfile, a lint gate that had never actually run, per-package READMEs, and the license reconciled to MIT everywhere
**4,897 / 9,500 production LOC (51.5%) · 557 tests passing · the whole framework still fits in an LLM context window.**
 
---
 
## 🔜 v2.2.3 — Release hygiene (patch)
 
- [x] ~~Fix phantom `@parcel/source-map ^2.2.1` devDependency~~ — landed in v2.2.2 (npm preflight)
- [ ] Add `@diamondjs/guards` to the `check-loc` budget report (header claims 400 LOC budget; report omits the package)
- [ ] Fix first-build DTS ordering flake (runtime `--clean` double-build leaves stale `index.d.ts` → cascading compiler/plugin test failures on fresh installs)
- [ ] `npm pkg fix` cleanup — normalize `repository.url` to the `git+https://` form npm auto-corrects at publish time
---
 
## 🎯 v2.3.0 — Composition & reach
 
- [ ] **Template-driven component composition** — the signed v2.3 milestone (D-21 closes for real): `<child-component>` instantiation from templates, explicit props-down/events-up, compiler-owned cleanup, its own DDR section before any code
- [ ] **Scaffolding CLI** — packages are published as of v2.2.2; what remains is the interactive `npm create diamond` script covering flat/nested component modes, `app/config/config.json`, and a routed app-shell starter
- [ ] **`--standalone` build flag** — compile an entire app into a single `.html` file that opens from anywhere (file://, USB stick, air-gapped review). Includes intelligent pre-compilation asset analysis to prevent WASM inclusion issues — WASM modules can't inline as data URIs in all contexts, so the analyzer detects them and fails loud with guidance rather than emitting a silently broken file
- [ ] **Bun-based server-side preparation** — groundwork for the Diamond 3.0 server story: runtime/primafacie modules audited for Bun compatibility, `wsReceiver` + datestamped `fileSink` validated under Bun, no Node-only API assumptions in the shared-vocabulary path (guards' `check` must eventually run server-side)
- [ ] **First `@diamondjs/guards` batteries** — promote from recorded candidates (`OAuthGuard`, `WebAuthnGuard`, `CapabilityGuard`, `TenantGuard`) as the first real applications produce a guard inventory
---
 
## 📋 Recorded backlog (designed or scoped, not yet scheduled)
 
- `canLeave` route-scoped departure veto — popstate compensation semantics; history entries are already stamped (`{ diamondNavId, index }`) for forward-compatibility
- Keep-alive / route caching · stacked overlay routing · transitions · data resolvers · scroll restoration
- Per-route parameterized guards (`{ use, state }`) · `ctx.state` request-scoped store · `challenge` decision type
- Attribute interpolation support (currently a fail-loud diagnostic)
- Compiler-injected `Print` caller-name memoization (kills the per-call stack walk if a hot path ever needs it)
- Mount-outside-`captureScope` leak heuristic (dev warning, primafacie-adjacent)
---
 
## 🔭 Diamond 3.0 horizon — the server side
 
The first release where DiamondJS spans the wire: tight server-side integration (Bun-first, per the v2.3 groundwork), server-enforced guards completing the **"client predicts, server enforces"** principle already written into the v2.2 spec, and a deliberately opaque WASM verification module with compiler-generated hash expectations held server-side — the one intentional exception to runtime transparency, with its rationale recorded in the DDR before a line ships (transparency is a promise to the developer about *their* application, not to every process about every module).