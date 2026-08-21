# 💎 @diamondjs/converters

**The data batteries: `format`/`parse` pairs that make form inputs and URL params arrive already typed.**

Converters are the data batteries; guards are the policy batteries.

---

## What is this?

A converter is a class with two static methods — `format` (value → string for the view) and `parse` (string → `ParseResult<T>` from the view). One contract serves both of DiamondJS's typed boundaries:

- **Form bindings** — `value.two-way="amount | CurrencyConverter('USD')"` parses on the way in, formats on the way out, and a failed parse lands in ordinary reactive state via `error-into` (no exception choreography).
- **Route params** (v2.2) — every `:segment` in a route map requires a converter; params arrive in your component's constructor already parsed and typed. A failed parse simply means *the route doesn't match*.

```bash
# Usually installed via the app meta-package (exact-pinned constellation):
npm install @diamondjs/app

# Or standalone:
npm install @diamondjs/converters
```

## The batteries

| Converter | Parses | Notes |
|-----------|--------|-------|
| `CurrencyConverter` | `"$1,234.56"` → `1234.56` | Locale/currency aware formatting |
| `DateConverter` | Date strings ↔ `Date` | |
| `PhoneConverter` | Phone number strings | Normalized formatting |
| `IntConverter` | `"42"` → `42` | Integers only — the route-param workhorse |
| `SlugConverter` | Lowercase kebab-case slugs | URL-safe identifiers |

## Usage

In templates:

```html
<!-- Converter pipe + error surface — target becomes ordinary reactive state -->
<input value.two-way="amount | CurrencyConverter('USD')" value.error-into="amountError">
<p if="amountError">${amountError}</p>
```

In route maps:

```typescript
import { IntConverter, SlugConverter } from '@diamondjs/converters';

'review': {
  path: '/review/:corpusId',
  component: ReviewWorkspace,
  outlet: 'main',
  params: { corpusId: SlugConverter },   // parse failure ⇒ route doesn't match
  children: {
    'document': {
      path: 'documents/:docId',
      component: DocumentViewer,
      outlet: 'content',
      params: { docId: IntConverter },
    },
  },
},
```

Writing your own is the same shape — a class with static `format`/`parse` returning `ParseResult<T>`. No registration, no plugin API; the compiler resolves converter references from ordinary imports.

## Design constraints

- **< 500 LOC** — currently ~25% of budget; batteries earn their place or stay out

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era.

## License

MIT
