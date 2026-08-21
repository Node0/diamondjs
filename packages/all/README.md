# 💎 @diamondjs/all

**All of DiamondJS in one dependency: the browser constellation plus the dev toolchain.**

---

## What is this?

The union meta-package — literally [`@diamondjs/app`](https://www.npmjs.com/package/@diamondjs/app) + [`@diamondjs/dev`](https://www.npmjs.com/package/@diamondjs/dev), exact-pinned to one tested release:

```bash
npm install @diamondjs/all
```

That resolves to:

- **`@diamondjs/app`** — what ships to the browser: runtime (components, reactivity, Router, Guard, Pending), converters, guards, primafacie logging
- **`@diamondjs/dev`** — what runs at build time: compiler, Parcel transformer, Parcel itself, TypeScript, and the `stink-check`/`route-check` build gates

## When to use which

- **`app` + `dev` separately** (recommended for real projects) — keeps browser dependencies and build tooling in their proper `dependencies`/`devDependencies` homes:

  ```bash
  npm install @diamondjs/app
  npm install --save-dev @diamondjs/dev
  ```

- **`all`** — one-liner for spikes, sandboxes, and "just let me try it":

  ```bash
  npm install @diamondjs/all
  echo '{ "extends": "@parcel/config-default", "transformers": { "*.html": ["@diamondjs/parcel-transformer-diamond", "..."] } }' > .parcelrc
  npx parcel src/index.html
  ```

Either way you get the same exact-pinned constellation — one tested whole, never a drifted mix. Upgrading DiamondJS is bumping one number.

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era.

## License

MIT
