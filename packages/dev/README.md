# 💎 @diamondjs/dev

**The complete DiamondJS dev toolchain in one install: compiler, Parcel transformer, Parcel itself, TypeScript, and the two build gates — exact-pinned as one tested constellation.**

---

## What is this?

The development meta-package. `npm install --save-dev @diamondjs/dev` and you're ready to build a DiamondJS application — no separate bundler or compiler setup:

| Dependency | What it is |
|------------|------------|
| [`@diamondjs/compiler`](https://www.npmjs.com/package/@diamondjs/compiler) | Template → transparent JS with `[Diamond]` hints and source maps |
| [`@diamondjs/parcel-transformer-diamond`](https://www.npmjs.com/package/@diamondjs/parcel-transformer-diamond) | Zero-config Parcel 2 integration + `run_mode` → `__DIAMOND_DEV__` |
| `parcel` | The bundler — `npx parcel` works out of the box |
| `typescript` | The language — `npx tsc` works out of the box |
| `stink-check` + `route-check` | The two DiamondJS build gates, as real bins (below) |

DiamondJS packages are exact-pinned (one tested constellation, never ranges); the external toolchain uses normal caret ranges.

## Quick start

```bash
npm install @diamondjs/app
npm install --save-dev @diamondjs/dev

echo '{ "extends": "@parcel/config-default", "transformers": { "*.html": ["@diamondjs/parcel-transformer-diamond", "..."] } }' > .parcelrc

npx parcel src/index.html
```

## The build gates

### `stink-check` — the two-tier security audit

Compiles every Diamond template in your project and routes diagnostics by **severity, never by code prefix**: `error` (broken source) and `warn` (unsafe sink without `raw`, dead switch — a latent hole nobody declared) fail the build; `declared` (intentional `raw` escape hatches) are baselined in `stink-baseline.json`, so adding one is allowed — it just produces a diff that lands in code review. The tripwire is review visibility, not a build block.

```bash
npx stink-check            # CI gate: fails on errors and undeclared warns
npx stink-check --update   # rewrite the declared-raw baseline
```

### `route-check` — build-time validation for route maps

Validates your route map against your actual templates, with errors that speak **route IDs, not file offsets**: unknown outlets, outlets owned by non-ancestors, missing param converters, unknown redirect targets, redirect cycles, `site-path` targets that shadow SPA routes, ambiguous route specificity, guards that never override `check()` — each with a did-you-mean naming the fix.

```bash
npx route-check src/app.routes.ts   # module exporting `routes` (or default)
```

```
✖ unknown-redirect-target  Route 'home': unknown route ID 'corpora'.
                           Did you mean { type: 'route-path', target: '/corpora' }?
```

Wire both into your `package.json` scripts and CI — red output, nonzero exit, no partial passes.

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era. The browser-side counterpart is [`@diamondjs/app`](https://www.npmjs.com/package/@diamondjs/app); the union of both is [`@diamondjs/all`](https://www.npmjs.com/package/@diamondjs/all).

## License

MIT
