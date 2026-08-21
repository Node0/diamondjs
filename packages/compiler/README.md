# 💎 @diamondjs/compiler

**The half of DiamondJS that absorbs the complexity, so the runtime — and your head — don't have to.**

You write Aurelia-inspired template syntax; the compiler produces completely transparent JavaScript that both humans and AI models can debug instantly, with a `[Diamond]` semantic hint comment above every generated call.

---

## What is this?

The build-time template compiler: parser (parse5, with source locations), code generator, hint emitter, converter-pipe codegen, security diagnostics, and VLQ source maps. It turns this:

```html
<!-- counter.html — what you write -->
<div class="counter">
  <button click.calls="decrement()">-</button>
  <span>${count}</span>
  <button click.calls="increment()">+</button>
</div>
```

into a plain instance `createTemplate()` method on your component class:

```javascript
// What the compiler produces — what you debug
createTemplate() {
  const div = document.createElement('div');
  div.className = 'counter';

  const button1 = document.createElement('button');
  // [Diamond] Event binding: click → decrement()
  DiamondCore.on(button1, 'click', () => this.decrement());
  button1.textContent = '-';

  const span = document.createElement('span');
  // [Diamond] Binding reactive property 'count' → textContent
  DiamondCore.bind(span, 'textContent', () => this.count);
  // …
}
```

No JSX transform, no proxy magic, no custom format. Errors point at your `.html` template, not the compiled JS — source maps are required, not optional.

```bash
# Usually installed via the dev meta-package (with the Parcel transformer + toolchain):
npm install --save-dev @diamondjs/dev

# Or standalone:
npm install --save-dev @diamondjs/compiler
```

## Usage

Most projects never call the compiler directly — [`@diamondjs/parcel-transformer-diamond`](https://www.npmjs.com/package/@diamondjs/parcel-transformer-diamond) invokes it during bundling. The programmatic surface:

```typescript
import { DiamondCompiler } from '@diamondjs/compiler';

const compiler = new DiamondCompiler();
const result = compiler.compile(templateSource, { filePath: 'counter.html', sourceMap: true });
// result.code, result.map, result.diagnostics
```

## What it compiles

The full v2.x template grammar: `set`/`rawSet` and the binding commands (`.bind`, `.two-way`, `.calls`, `.capture`, `.delegate`, `.trigger`, `.one-time`), `${interpolation}`, `if`/`else-if`, `repeat.for`, exhaustive `switch`/`case`/`default`, attribute spread (`...attrs.bind`), converter pipes with the `ParseResult` contract, and `error-into` converter error surfaces.

## Diagnostics — the stink gate's fuel

Every compile emits typed diagnostics routed by **severity, never by code prefix**:

| Severity | Meaning | Gate behavior |
|----------|---------|---------------|
| `error` | Retired/unknown command — broken source | FAIL |
| `warn` | Latent hole nobody declared (unsafe sink without `raw`, dead switch) | FAIL (hard gate) |
| `declared` | Intentional `raw` escape hatch | Baselined; drift lands in code review, not a build block |
| `info` | Advisory | Never gated |

The `stink-check` bin in [`@diamondjs/dev`](https://www.npmjs.com/package/@diamondjs/dev) runs this taxonomy over your whole template tree as a CI gate.

## Design constraints

- **Compiler < 5,000 LOC** — modular, each pass independently comprehensible (currently ~45% of budget)
- **Complexity belongs in the compiler**, not in the runtime or the developer's head
- **Show your work** — every transformation is visible in compiled output

---

Part of [DiamondJS](https://github.com/Node0/diamondjs) — the first JavaScript framework designed for the human-LLM collaborative development era.

## License

MIT
