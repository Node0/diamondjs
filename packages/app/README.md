# 💎 @diamondjs/app

**Everything DiamondJS ships to the browser, exact-pinned as one tested constellation.**

---

## What is this?

The application meta-package. One install gives you the complete browser-side framework at versions that were tested *together* — exact pins, never ranges:

| Package | What it is |
|---------|------------|
| [`@diamondjs/runtime`](https://www.npmjs.com/package/@diamondjs/runtime) | Reactivity, components, binding engine, scheduler, `Collection`, security allowlist, **Router, Guard, Pending** |
| [`@diamondjs/converters`](https://www.npmjs.com/package/@diamondjs/converters) | The data batteries: Currency, Date, Phone, Int, Slug |
| [`@diamondjs/guards`](https://www.npmjs.com/package/@diamondjs/guards) | The policy batteries (scaffold — type re-exports today) |
| [`@diamondjs/primafacie`](https://www.npmjs.com/package/@diamondjs/primafacie) | The `Print(logType, message)` logging paradigm + pluggable sinks |

## Quick start

The whole framework is two installs — one for what ships to the browser, one for what runs at build time:

```bash
mkdir my-app && cd my-app
npm init -y

npm install @diamondjs/app
npm install --save-dev @diamondjs/dev

# Configure Parcel (2 lines)
echo '{ "extends": "@parcel/config-default", "transformers": { "*.html": ["@diamondjs/parcel-transformer-diamond", "..."] } }' > .parcelrc

npx parcel src/index.html
```

Your imports still name the real packages — the meta-package only pins the constellation:

```typescript
import { Component, reactive, Router } from '@diamondjs/runtime';
import { IntConverter } from '@diamondjs/converters';
import { Print } from '@diamondjs/primafacie';
```

## Why exact pins?

Decisions decrease energy. A DiamondJS release is one tested whole; ranges would let the constellation drift into combinations nobody ever ran. Upgrading DiamondJS means bumping one number in one place.

Want the union of app + dev in a single dependency? That's [`@diamondjs/all`](https://www.npmjs.com/package/@diamondjs/all).

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era. The entire framework fits in an LLM context window; that's a design constraint, not an accident.

## License

MIT
