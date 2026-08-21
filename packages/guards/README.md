# 💎 @diamondjs/guards

**The policy batteries: abstract guard mid-classes between the runtime's `Guard` contract and your app's concrete policies.**

Converters are the data batteries; guards are the policy batteries.

---

## Scaffold status — read this first

**This package currently ships zero battery mid-classes.** As of v2.2 it re-exports the `GuardContext` and `Destination` types so a battery author sees the exact contract they extend — nothing more. This is deliberate: no family has a confirmed real-world guard inventory yet, and DiamondJS doesn't ship machinery described as shipped before it exists.

Recorded candidates for a future 2.2.x, once the first consuming application's guard inventory exists:

- `OAuthGuard` — static `issuer`/`clientId`; external-redirect deny
- `WebAuthnGuard` — static `maxSessionAge`; challenge-as-redirect idiom
- `CapabilityGuard`
- `TenantGuard`

The intended shape — configuration via static fields on app-tier subclasses:

```typescript
class CorpusSSO extends OAuthGuard {
  static issuer = 'https://idp.example.com';
  static clientId = 'corpus-web';
}
```

## Writing guards today

You don't need this package to write guards — extend `Guard` from [`@diamondjs/runtime`](https://www.npmjs.com/package/@diamondjs/runtime) directly:

```typescript
import { Guard, type GuardContext, type Destination } from '@diamondjs/runtime';

export class RequireLogin extends Guard {
  static check() { return session.user !== null; }
  static deny({ to }: GuardContext): Destination {
    return { type: 'route-id', target: 'login', query: { returnTo: to } };
  }
}
```

The runtime's execution envelope applies regardless: a `check()` that throws denies, a `check()` that hangs denies after `Guard.timeoutMs`, every decision is narrated through `Print`, and the base `check()` returns `false` — fail closed, everywhere.

```bash
# Usually installed via the app meta-package (exact-pinned constellation):
npm install @diamondjs/app
```

## Design constraints

- **< 400 LOC budget** — reserved for when the batteries land

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era.

## License

MIT
