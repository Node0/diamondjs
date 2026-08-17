# DiamondJS — Amendment A3: the v2.1.1 / v2.2 Design Record

**Status:** Ratified with the v2.1.1 → v2.2.0 implementation (per the signed Implementation Work Order).
**Date:** August 16, 2026
**Governs:** the v2.1.1 conformance patch and the v2.2.0 release.
**Keyed to:** Architecture Specification v2.1 (`00db3c6`) section numbers and §16 defect IDs. Where this amendment conflicts with v2.1 text, this amendment wins; the v2.2 Router Specification (companion document) carries the new-feature normative text.

---

## 1. Dispose-on-detach (§5.4.1 / §5.4.3 / §7.2 — D-1)

The v2.1 lowering text for `if`/`switch` loses the phrases **"branch cache"** and **"detach-not-destroy"** (including A2 §1's "mirroring `if()` (lazy `captureScope` builds, branch cache, detach-not-destroy)"). The branch cache is **removed**, not hybridized.

**New invariant, spec-wide: detached means disposed.** All three structural directives (`if`, `switch`, `repeat`) dispose a detached subtree eagerly — node removed, captured cleanup invoked — and rebuild from `make()` on re-activation. Lazy building stays; only the cache goes.

**Rationale (D-1):** the cache traded a bounded rebuild for **unbounded hidden work plus a second disposal semantic**. A cached `repeat` over a `Collection` inside a hidden branch rebuilt on every mutation (49 detached `<li>` builds reproduced); and "sometimes detach disposes, sometimes it caches" was a second rule a reader had to carry. One disposal rule beats a micro-optimization. The keep-node/dispose-effects hybrid was **rejected** — a third disposal semantic.

The previously-untracked `detached-branch-disposal.test.ts` probe was recreated from the recon record (the original file was lost while untracked) and committed; its three formerly-failing assertions are the D-1 acceptance criteria and are green.

## 2. D-7 disposition → **fixed**

The scheduler now drops disposed effects at flush: effect cleanup sets a `disposed` flag on the effect record; the flush skips (and drops) flagged effects. The retention mechanism (queued-before-unmount effect flushing after it and re-arming tracking) is closed; the mutate-then-unmount-same-tick shape is regression-tested at both the reactivity level and the router level.

## 3. §15 rewrite — logging (overturns A2 §9.4 "no dependency" rule)

`packages/runtime/src/dev-log.ts` is **deleted**. The runtime imports `Print` from `@diamondjs/primafacie` (browser-safe core only; Node transports stay behind `./node`). Build order: primafacie → runtime; acyclic.

**A2 §9.4 overturn rationale:** the no-dependency rule assumed primafacie was tooling; its reclassification as **production infrastructure** — it ships in `@diamondjs/app`, and stink tagging must be visible in normal operation — removed the premise. The format-only copy was itself drift liability (the v2.1 devWarn line and the primafacie line had already been one refactor away from diverging).

The three-channel taxonomy is preserved: compiler `Diagnostic[]` remains pure data (the compiler prints nothing); runtime warnings are `Print` calls, not Diagnostics.

**Constraint (normative):** `Print` never lands in a hot reactive path — it captures a stack per call for the caller name. The compiler-injected caller-name memoization is a recorded deferred item.

**v2.2 primafacie additions:** `WsLogMessage.plain` (the line is formatted exactly once, in the browser; `wsSink` sends it); `wsReceiver(sink)` on `./node` — framework-agnostic and **silent** (no server echo; the browser already printed); `fileSink(dir, { datestamped })` rolling `access-YYYY-MM-DD.log` by date-in-filename via per-append string compare, no rotation daemon, default off; the dead `enableDebug` initializer (`(A || B) || true`) fixed so the env vars actually gate (default remains on).

## 4. §12.5 / §6.6 — prod-visible warnings

The two runtime warnings (spread unsafe-key skip; inbound smell) are **stink signals, prod-visible by design**. The call-site `IS_DEV` guards are removed; warn-once dedup is retained at the call sites. §6.6's "dev-only" description is superseded accordingly. A format-drift tripwire test asserts both warnings carry primafacie's exact line shape.

## 5. §14 — measurement note (D-9)

LOC budgets count **production LOC only** (`src` excluding `__tests__`); test LOC is a separate informational column. This dissolved the false parcel `300/300 WARN` (production was 111/300). The budget tool fails **closed** on a `cloc` resolution error. No ceiling changed anywhere.

## 6. D-21 + §4.5 rewrite

§16 gains **D-21**: §4.5 "props down" described unshipped machinery (v1.5.1 text carried forward). §4.5 is rewritten as **design-intent-not-shipped** with a forward pointer to v2.3 template component composition (own DDR conversation). Enforcement shipped with v2.1.1: `nextVar` sanitizes identifiers (hyphens → underscores); a hyphenated tag whose PascalCase form is imported by the component module errors with `component-composition-unsupported`; a hyphenated tag with no matching import is a valid plain custom-element passthrough under existing sink gating.

## 7. D-18 narrowed — `<outlet` detection token

`isDiamondTemplate` gains `'<outlet'` (transformer + stink-check mirror): the canonical v2.2 app shell — static chrome + outlets, zero bindings — is detected and compiled. D-18's residual scope narrows to: an `if=`-only template with zero bindings, interpolations, switches, repeats, **and outlets** stays undetected (unchanged rationale: bare `if=` is a false-positive risk on non-Diamond HTML).

## 8. Remaining v2.1.1 dispositions → fixed

- **D-2** — `repeat` keys primitives by typeof-prefixed value + per-pass occurrence index (objects keep identity keying).
- **D-3** — `attr-interpolation-unsupported` (error) with concatenation-form remediation; support remains a future decision.
- **D-5** — `TemplateImport` exported from the compiler index.
- **D-6** — `mounted` guard; record adopts "DOM-node leak", now guarded.
- **D-8** — stink-check routes on the `severity` field, never the code prefix.
- **D-10** — static attributes pass `gateSink` (`on*`/off-list → `stink:warn`); the §6.5 "raw cannot be added invisibly" claim now holds for authoring syntax.
- **D-12** — RAW banner reworded: "recorded for stink-baseline review" (mechanism, not completed-audit attestation).
- **D-15/D-20** — compiler allowlist invariant upgraded to the normative `map[lowercase(sink)] === sink` form; dedicated fail-closed locks for `srcset`, `action`, `formAction`, `cssText`.
