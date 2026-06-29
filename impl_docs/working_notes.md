# DiamondJS v2.0 — Implementation Working Notes

Implementation-discovery details that are **not** specification. The phase specs live in the approved plan and reference only the DDR + Amendment A1. This file captures parser/tooling/runtime realities discovered during implementation.

---

## Parser / grammar realities

- **parse5 lowercases all attribute names.** Both the property segment and the command segments arrive lowercased. So source `innerHTML.rawBind.to-view` reaches the parser as `innerhtml.rawbind.to-view`. The camelCase legibility of `rawBind`/`rawSet` is a **source-only affordance**; the compiler never sees the casing.
  - Normalize the property segment through `PROPERTY_NAME_MAP` (already used for `textcontent`→`textContent`, etc.).
  - Command matching is **lowercase-keyed**.
- **Three-segment attribute grammar (DDR §8/§10).** Attribute names may now have 2 or 3 dot-segments. Parse by splitting the attr name on `.`:
  - 2-segment: `property.command` — e.g. `value.set`, `value.bind`, `value.to-view`, `value.from-view`, `value.two-way`, `value.rawSet`, `click.calls`, `panel.capture`.
  - 3-segment: `property.command.qualifier` — the raw directional escape hatch: `innerHTML.rawBind.to-view`, `innerHTML.rawBind.from-view`, `innerHTML.rawBind.two-way` (and the §10 directional `bind.to-view`/`bind.from-view` if authored property-prefixed).
- **Internal representation:** `BindingInfo` carries `{ type, raw }` where `type` is the operation enum and `raw` is a boolean. This is NOT a flattened token — the *source surface* stays three-segment (`rawBind.to-view`). The flattened tokens `rawTo-view`/`rawFrom-view`/`rawTwo-way` must never appear (spec correction #1). Mapping:
  - `set`→{set,false}, `rawSet`→{set,true}
  - `bind`→{bind,false}, `rawBind`(.dir)→{<dir or two-way>,true}
  - `to-view`/`from-view`/`two-way`→{same,false}
  - `calls`→{calls,false}, `capture`→{capture,false}
- **Kill the silent `|| 'bind'` fallback** in `parseBindingCommand`. Unknown/retired commands (`one-time`, `trigger`, `delegate`, typos) become hard `error` diagnostics, not a silent two-way bind (fail-open is unacceptable in a security release).

## Security gate (Phase 1)

- New compiler module houses `SAFE_SINKS` + the pure gate decision + diagnostic types. SAFE_SINKS contents are the §11.2 "load-bearing unknown" — starter set below, refine empirically.
- **Gate runs for the five sink ops** (`set, bind, to-view, from-view, two-way`). NOT for `calls`/`capture` (addEventListener, no sink) or `if`/`else-if`/`repeat.for` (no sink, §6.2).
- `core.ts bind()` always runs the view-update effect, so `from-view` is also an outbound sink write → gated.
- **Centralize all sink emission through one helper** so no future code path can emit a property write without passing the gate (this is what permanently closes the one-time bypass).
- Gate decision table (normalize property via PROPERTY_NAME_MAP, then `safe = SAFE_SINKS.has(prop)`):
  - `raw=false, safe=true` → clean, no diagnostic.
  - `raw=false, safe=false` → emit treated-as-raw bytes + **`stink:warn`** (hard gate).
  - `raw=true, safe=false` → raw write + **`stink:declared`** (baselined, no block).
  - `raw=true, safe=true` → clean + `info` (redundant raw).
- Insight: for a non-safe sink, emitted bytes are identical declared vs. undeclared — you can't make `innerHTML` safe with code, only with a declaration. The gate forces the declaration into the reviewed baseline.

### SAFE_SINKS starter set (camelCase canonical)
text: `textContent`, `innerText`; value/state: `value`, `valueAsNumber`, `valueAsDate`, `checked`, `selected`, `selectedIndex`; class: `className`; boolean UI: `disabled`, `readOnly`, `required`, `hidden`, `multiple`, `open`; numeric scalars: `tabIndex`, `maxLength`, `minLength`, `rowSpan`, `colSpan`, `scrollTop`, `scrollLeft`; plain-text descriptors: `placeholder`, `title`, `alt`, `label`, `htmlFor`; constrained tokens: `type`, `name`, `accept`, `autocomplete`, `inputMode`, `step`, `min`, `max`, `pattern`, `id`.

Off-list (require `raw`): `innerHTML`, `outerHTML`, `srcdoc`, `href`, `src`, `srcset`, `action`/`formAction`, `style`/`cssText`, all `on*`, everything unenumerated (fail closed).

**Coupling:** any safe sink whose camelCase ≠ lowercase must also be in `PROPERTY_NAME_MAP` or it fails closed as a false-positive warn. Add missing entries: `minLength`, `scrollTop`, `scrollLeft`, `valueAsNumber`, `valueAsDate`, `inputMode`, `selectedIndex`, `autocomplete`. Ship a unit test asserting `SAFE_SINKS ⊆ keys(PROPERTY_NAME_MAP) ∪ lowercase-identical`.

## Diagnostics surfacing

- Add `diagnostics: Diagnostic[]` to `CompileResult` (additive; existing `{outputCode, result}` consumers unaffected). Parser emits retired/unknown-command errors; generator emits gate diagnostics (only it knows property+op+raw together); `DiamondCompiler.compile()` merges.
- Parcel transformer: **throw on `severity:'error'`** (retired/unknown = broken source); pass `warn`/`declared`/`info` through silently. Enforcement is the merge gate (tools script), not local dev.

## Stink tooling (Phase 1)

- Baseline file at repo root (checked in), sorted for clean diffs. Record per declared raw: `{ id: "file:line:property:op", file, line, property, op, expression }`. `expression` is the §8 human-readable audit record ("raw innerHTML at SearchBar:8, via sanitizeHtml").
- Check script mirrors `tools/check-loc-budget.ts` (tsx). Modes: `--check` (fail on any `error` or `stink:warn` count>0; declared baseline drift surfaces via git diff, does NOT hard-fail per §3.4) and `--update` (rewrite baseline). Wire `stink:check`/`stink:update` npm scripts; add to `prepublishOnly` beside `check-loc`.

## `isDiamondTemplate` detection (parcel utils)

Must add new tokens AND retain retired ones: detect `calls|set|rawset|rawbind|capture|bind|to-view|from-view|two-way` plus retired `trigger|delegate|one-time` — otherwise a `.trigger` file is never detected, never compiled, and the helpful "renamed to .calls" diagnostic never fires (silently served as raw HTML).

## Migration surface (will break on Phase 1 landing)

- `examples/hello-world/src/Counter.diamond.html` uses `click.trigger` → `click.calls`.
- Tests referencing retired tokens: `parser.test.ts`, `generator.test.ts`, `compiler.test.ts`, `transformer.test.ts` (one-time/trigger/delegate assertions).
