# 💎 @diamondjs/primafacie

**One logging vocabulary for your whole stack: `Print(logType, message)` — typed, symboled, greppable, and pluggable from browser console to datestamped server files.**

---

## What is this?

Primafacie is the DiamondJS logging paradigm. One call shape, everywhere — the framework's own narration (router decisions, guard outcomes, dev-mode route tables) and your application logs share a single vocabulary:

```typescript
import { Print } from '@diamondjs/primafacie';

Print('STARTING', 'boot sequence');
Print('SUCCESS', 'corpus loaded: 1,204 documents');
Print('FAILURE', 'save rejected: version conflict');
```

Every line carries a type, a symbol, a timestamp, and the caller — color-coded via ANSI in terminals and CSS in browser consoles, and routed to the right console method (`log`/`info`/`warn`/`error`) automatically.

```bash
# Usually installed via the app meta-package (exact-pinned constellation):
npm install @diamondjs/app

# Or standalone:
npm install @diamondjs/primafacie
```

## Sinks — where lines go

Console output is the default. Add sinks for anything else:

```typescript
import { addSink, wsSink } from '@diamondjs/primafacie';

// Browser → server log relay over WebSocket
addSink(wsSink('ws://localhost:9600/logs'));
```

On the server side (Node), the `/node` entry point receives the relay and writes datestamped files:

```typescript
import { fileSink, wsReceiver } from '@diamondjs/primafacie/node';

const onMessage = wsReceiver(fileSink('./logs'));
// wire onMessage into your WebSocket server; browser Print() lines
// land in ./logs/<date>.log with their types and callers intact
```

Custom sinks are just functions receiving a structured `LogRecord` — implement `LogSink` and `addSink` it.

## Why a logging package in a frontend framework?

Because debuggability is the whole point. DiamondJS narrates its own runtime decisions — every guard allow/deny/throw/timeout, every route commit — through `Print`, so your log stream shows the framework's reasoning in the same greppable vocabulary as your own logs. In dev mode the router prints its entire resolved route table at startup, one line per route; "where's the route map?" is answered by your console.

## Design constraints

- **< 400 LOC** — currently ~75% of budget

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era.

## License

MIT
