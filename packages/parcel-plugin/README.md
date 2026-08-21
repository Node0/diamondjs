# 💎 @diamondjs/parcel-transformer-diamond

**Zero-config Parcel 2 integration: your `.html` templates compile to transparent JavaScript during bundling. Configuration is two lines.**

---

## What is this?

The Parcel 2 transformer that wires [`@diamondjs/compiler`](https://www.npmjs.com/package/@diamondjs/compiler) into your build. It detects Diamond templates (binding commands, `${interpolation}`, structural elements), compiles them with source maps, pairs them with their component classes, and injects the `run_mode` → `__DIAMOND_DEV__` flag that dev-only framework paths (route-table narration, richer diagnostics) are dead-code-eliminated by in prod builds.

No `vite.config.js`. No `webpack.config.js`. Just `.parcelrc`:

```json
{
  "extends": "@parcel/config-default",
  "transformers": {
    "*.html": ["@diamondjs/parcel-transformer-diamond", "..."]
  }
}
```

```bash
# Usually installed via the dev meta-package (compiler + transformer + parcel + typescript + tool bins):
npm install --save-dev @diamondjs/dev

# Or standalone (bring your own parcel):
npm install --save-dev @diamondjs/parcel-transformer-diamond parcel
```

Then:

```bash
npx parcel src/index.html          # dev server
npx parcel build src/index.html    # production build
```

## Dev/prod modes

`app/config/config.json` → `run_mode: "dev" | "prod"` controls `__DIAMOND_DEV__` injection. In dev, the router narrates its resolved route table at startup through `Print` and dev-only diagnostics stay live; in prod, every such path is eliminated from the bundle.

## Design constraints

- **< 300 LOC** — currently ~55% of budget; the transformer stays a thin honest adapter, with the real work in the compiler

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era.

## License

MIT
