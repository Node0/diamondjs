# 💎 DiamondJS

> **A Human + LLM Optimized Frontend Framework**  
> *Ergonomic syntax. Radically transparent runtime. Zero magic.*

---

## 🎯 Vision

DiamondJS is a modern frontend framework designed from the ground up for the era of human-AI collaborative development. It combines the ergonomic, developer-friendly syntax of Aurelia with a radically transparent architecture that makes debugging with LLMs, especially smaller open-source models (32B class), not just possible, but *effortless*.

### The Problem We're Solving

Modern frameworks often suffer from "Abstraction Suffocation", i.e. "White Screen of Death" (WSOD) problem: a simple refactor breaks your app in mysterious ways, and even frontier LLMs spend hours unable to diagnose the issue. Why? Because the runtime is opaque, filled with dependency injection magic, runtime reflection, and invisible state that neither humans nor AI can easily trace.

DiamondJS takes a different approach: **build-time magic, runtime transparency**.

---

## 🧪 The Experiment
We decided to test a hypothesis, what if we built  
a front end library design explicitly for Human+LLM synergy
in the post-generative AI era?  

What would such a library look like?  
What would it's core ontological assumptions be?  
Would they differ from the pre-generative AI era assumptions?  
Would they prove their validitity through unreasonably effective productivity?  

Where other libraries build frameworks, even meta-languages by exploiting the expressive
permissiveness of JavaScript; we instead decided to go literal and concrete, radically concrete.  



#### **Can we create a library where 32B open-source coding models are as effective as frontier models at development and debugging?**

To validate this, we're building a test harness that measures:
- Time to implement features
- Number of LLM attempts required
- Error rates across model sizes (32B, 70B, frontier)
- Success rate of LLM-generated fixes

#### **Target Success Criteria**:
- 32B models achieve **80% bug fix rate** (vs. 0% with opaque frameworks)
- Average fix time **< 30 seconds**
- Requires **< 2 clarifying questions**

**Baseline**: The "White Screen of Death" bug scenario—frontier models failed after 2 hours with Aurelia 2.0.

**DiamondJS Goal**: 32B models succeed in under 30 seconds.

---

## 🤝 Philosophy: The Goldilocks Architecture

We're seeking the sweet spot between two extremes:

- **Too Simple**: A pile of functions (like vanilla JS) gives you no scaffolding. Every project starts from scratch.
- **Too Magic**: Frameworks with hidden runtime state make debugging a nightmare when things break.

_**DiamondJS is Goldilocks**_: The ergonomic scaffolding of a framework, compiled down to the transparency of explicit code.

---

## 🚅 Why This Matters

The future of software development is human + AI collaboration. But current frameworks were designed for humans alone. Their abstractions optimize for human keystrokes, not AI comprehension.

DiamondJS flips the script: **optimize for shared comprehension between humans and models.**

This unlocks:
- **Faster debugging** - LLMs can actually help instead of hallucinating
- **Lower barrier to entry** - Smaller, cheaper models become viable
- **Better maintainability** - Explicit code is easier for everyone to understand
- **True AI-augmented development** - Not just autocomplete, but real collaboration
- **Performance optimization** - Hybrid reactivity handles all workload types optimally

---

## 🏗️ Architecture Philosophy

DiamondJS splits the framework into two distinct layers:

```
┌─────────────────────────────────────────┐
│  Write Time (Human + LLM Friendly)      │
│  ─────────────────────────────────────  │
│  • Frictionless syntax (.bind, etc)     │
│  • Class-based components               │
│  • HTML/JS/CSS triplets                 │
│  • Familiar patterns                    │
└──────────────┬──────────────────────────┘
               │
               ▼
     ┌─────────────────────┐
     │  Build Time         │
     │  ─────────────────  │
     │  diamond-compiler   │
     │  (~3.7K LOC)        │
     │  • Vite plugin      │
     │  • Source maps      │
     └─────────┬───────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Debug Time (LLM Comprehensible)        │
│  ─────────────────────────────────────  │
│  • Pure class-based code                │
│  • Explicit static methods              │
│  • Zero runtime magic                   │
│  • ~2.2K LOC runtime (~20KB gzipped)    │
└─────────────────────────────────────────┘
```

### Write Time: Beautiful Ergonomics

Write code that looks like this:

```html
<!-- my-component.html -->
<div repeat.for="item of items">
  <input value.bind="item.name">
  <button click.trigger="removeItem(item)">Remove</button>
</div>
```

```javascript
// my-component.js
export class MyComponent {
  items = [
    { name: 'Alice', id: 1 },
    { name: 'Bob', id: 2 }
  ];

  #internalCache = new Map();

  removeItem(item) {
    this.items = this.items.filter(i => i !== item);
  }

  async #fetchFromCache(id) {
    return this.#internalCache.get(id) ?? await this.#loadFromServer(id);
  }
}
```

### Debug Time: Transparent Output

The compiler transforms it into this "radically transparent" JavaScript:

```javascript
// my-component.compiled.js
import { DiamondCore } from 'diamond-runtime';

export class MyComponent {
  items = [
    { name: 'Alice', id: 1 },
    { name: 'Bob', id: 2 }
  ];

  #internalCache = new Map();

  removeItem(item) {
    this.items = this.items.filter(i => i !== item);
  }

  async #fetchFromCache(id) {
    return this.#internalCache.get(id) ?? await this.#loadFromServer(id);
  }

  // Compiler-generated static method - everything else stays untouched!
  static createTemplate() {
    return (vm) => {
      return DiamondCore.repeat(
        vm,
        'items',
        (item) => {
          const div = document.createElement('div');
          
          const input = document.createElement('input');
          DiamondCore.bind(input, 'value', () => item.name, (v) => item.name = v);
          
          const button = document.createElement('button');
          button.textContent = 'Remove';
          DiamondCore.on(button, 'click', () => vm.removeItem(item));
          
          div.append(input, button);
          return div;
        }
      );
    };
  }
}
```

**No magic. No hidden state. No WSOD.**

If `items` gets renamed and you miss a spot, the transpiler fails, or the JavaScript fails with a clear, traceable error. A 32B open-source LLM can understand and debug this code perfectly because there's nothing hidden.

---

## 🤔 Why Radically Transparent Compilation?

### The "Oh Wow" Moment

Look at what an LLM (or human) sees when debugging the compiled output:

1. **Your class is untouched** - All your logic, private fields, methods - exactly as you wrote them
2. **One static method added**: `createTemplate()` - which returns a pure function for rendering
3. **Zero magic**: Every function call is traceable:
   - `DiamondCore.bind(element, prop, getter, setter)` - crystal clear
   - `DiamondCore.on(element, event, handler)` - obvious
   - `DiamondCore.repeat(vm, propName, renderFn)` - self-documenting

When the "White Screen of Death" happens, the LLM can:
- See exactly which property binding failed
- Trace the exact function call
- Understand the loop iteration
- Know which event handler was attached where

### Compare: Opaque vs. Transparent

**Opaque (Traditional Runtime Magic):**
```javascript
// What you write
value.bind="item.name"

// What actually executes (simplified, reality is worse)
BindingCommand.create(
  Container.instance.get(ObserverLocator),
  target,
  'value',
  new AccessScope('item', 0).evaluate(scope)
    .then(obj => new AccessMember(obj, 'name'))
)
```

**Nobody** can debug that without the entire 50K LOC context.

**Transparent (DiamondJS Compilation):**
```javascript
// What you write
value.bind="item.name"

// What actually executes
DiamondCore.bind(input, 'value', () => item.name, (v) => item.name = v)
```

A 32B model can **easily** understand that second line. It cannot understand the first.

### Critical Design Insight: Preventing ES5-Style Autoregressive Steering

**The Problem**: LLMs are autoregressive, they predict tokens based on patterns in previous tokens. When debugging compiled code, if an LLM sees patterns associated with ES5 or functional paradigms (standalone exported functions, global scope patterns), it will be steered toward generating ES5-style solutions, even when modern class-based patterns would be more appropriate.

**The Solution**: ALL compiled output AND runtime library code maintains pure OOP patterns:
- ✅ Classes with static methods (not standalone functions)
- ✅ Instance methods for stateful operations
- ✅ Explicit imports of other classes/services
- ✅ Modern ES2022+ syntax throughout

This ensures LLMs stay in the correct mental model when generating fixes or suggestions.

### The Compilation Philosophy

The compiler should:
1. **Preserve** your class structure completely
2. **Add** one static method that returns a template factory function
3. **Inline** the template logic as plain DOM construction
4. **Never touch** your business logic

This means:
- ✅ Private fields work exactly as written
- ✅ Async/await preserved
- ✅ Optional chaining preserved
- ✅ Your imports preserved
- ✅ Only the template gets "compiled" into explicit code

---

## 📐 Core Principles

### 1. **LLM-First Design**
Every module fits in a single LLM context window (~25k tokens). The entire runtime is <2.5K LOC. Debugging doesn't require understanding 50,000 lines of framework internals.

### 2. **Build-Time Magic, Runtime Transparency**
All the ergonomic conveniences (data binding, component lifecycle, template DSL) are handled by a build-time compiler. The browser receives clean, traceable JavaScript with zero indirection.

### 3. **Pure Class-Based Architecture**
Every exported API is a class with static or instance methods, never standalone functions. This prevents autoregressive steering in LLMs and maintains consistent OOP patterns throughout the codebase.

### 4. **No Dependency Injection**
DI is powerful but opaque. DiamondJS uses explicit imports and modern ES6+ patterns. You can see exactly where every dependency comes from.

### 5. **Hybrid Reactivity for Optimal Performance**
- **Reactive Proxies** for small UI state (< 1,000 items) - automatic, ergonomic
- **Collection Class** for large datasets (> 1,000 items) - constant-time appends, perfect for logs, chat, terminals

### 6. **Standards-Native**
Built on modern Web Standards and ES2022+ features: private class fields (`#field`), public field declarations, optional chaining (`?.`), nullish coalescing (`??`), `async`/`await`, native modules, Custom Elements, Shadow DOM, URLPattern, CSS variables.

### 7. **Source Maps as the Bridge**
Errors map directly back to your ergonomic source code. Both humans and LLMs can trace issues from the compiled output back to the original `.html` template.

### 8. **Modular and Comprehensible**
The compiler itself is ~3.7K LOC, broken into digestible modules. Each module can fit in an LLM's context for easy understanding and modification.

---

## 🚀 Feature Set

DiamondJS provides everything you need for serious application development:

### **A. Composition & State**
- **`DiamondCore.reactive()`** - Reactive state for UI using native `Proxy`
- **`DiamondCore.collection()`** - High-performance collections for large datasets (logs, chat, lists)
- **`DiamondCore.bind()`** - Declarative DOM-data synchronization  
- **`Component`** - Base class with lifecycle hooks (constructor/mount/update/unmount)
- Modern ES2022+ syntax: private fields (`#field`), public field declarations, optional chaining, nullish coalescing
- Zero transpilation needed, runs natively in all modern browsers

### **B. Event Flow & Coordination**
- **`messageBus`** - Lightweight pub-sub for inter-component communication
- **`DiamondCore.on()`** - Event listeners with automatic cleanup
- **`DiamondCore.delegate()`** - Event delegation for performance
- First-class DOM event propagation

### **C. Routing**
- **`Router`** - Built atop native `URLPattern`
- Treat navigation as state, not framework magic
- Simple configuration in a single file
- No nested router complexity

### **D. Async & Data Fetching**
- **`DiamondCore.effect()`** - Reactive effects without "suspense" sorcery
- **`DiamondCore.computed()`** - Cached computed values
- Pairs naturally with reactive state

### **E. Style & Template Integration**
- Native HTML templates compiled at build time
- Optional Shadow DOM encapsulation
- Pure CSS, no preprocessors needed
- Component-scoped styles

### **F. Build & Delivery**
- Parcel plugin for seamless integration
- Fast HMR (< 100ms for component updates)
- Source maps for debugging
- Tree-shakeable runtime (~20KB gzipped)

### **G. Dev Ergonomics**
- Fast dev server with auto-reload
- **Browser-to-CLI log streaming** - See browser console in your terminal
- Structured logging with `BrowserPrint`
- State inspection for both humans and LLMs

---

## 📐 Design Constraints

| Constraint | Target | Rationale |
|------------|--------|-----------|
| Runtime LOC | < 2,500 lines | Fits in a single 25k token LLM context window |
| Compiler LOC | ~3,700 lines | Modular, comprehensible by LLMs |
| Bundle Size | < 20KB gzipped | Includes Collection class for performance |
| No Runtime DI | Zero | Explicit is better than magical |
| Source Maps | Required | Errors must trace back to source |
| Pure OOP | All code | Prevents ES5-style autoregressive steering |
| HMR Speed | < 100ms | Fast feedback loop |
| Browser Support | Modern evergreen | Chrome/Firefox/Safari/Edge 90+ |

---

## 🔧 Modern JavaScript Features

DiamondJS fully embraces ES2022+ features available in all modern browsers (2023+), eliminating the need for much of the "magic" traditional frameworks require:

### **Language Features We Leverage**

| Feature | Why It Matters | Example |
|---------|----------------|---------|
| **Private Fields (`#`)** | True encapsulation without closures or WeakMaps | `#state = new Map()` |
| **Public Field Declarations** | Clean, readable class properties | `items = []` |
| **Optional Chaining (`?.`)** | Safe property access without verbose checks | `data?.user?.name` |
| **Nullish Coalescing (`??`)** | Precise default values (not falsy checks) | `value ?? 'default'` |
| **Private Methods** | Encapsulated logic without naming conventions | `#updateInternal()` |
| **`async`/`await`** | Native async without callback hell | `await fetch(url)` |
| **Native Modules** | No AMD/CommonJS shims needed | `import { x } from 'y'` |
| **`Proxy`** | Fine-grained reactivity without getters/setters | `new Proxy(target, handler)` |
| **Static Class Methods** | Pure functions with class context | `static createTemplate()` |
| **Template Literals** | Native string interpolation | `` `Hello ${name}` `` |

### **Browser APIs We Use Directly**

- **Custom Elements v1** - Native web components
- **Shadow DOM v1** - Style encapsulation without CSS-in-JS
- **URLPattern** - Routing without regex gymnastics  
- **`structuredClone()`** - Deep cloning without libraries
- **`AbortController`** - Native request cancellation
- **Constructable Stylesheets** - Efficient style sharing

### **The Result**

By leveraging these native features, DiamondJS needs **less code** and provides **more clarity**. The JavaScript you write is the JavaScript that runs, no elaborate transpilation, no runtime polyfills, no magic transforms.

**Browser Support:** Chrome/Edge 90+, Firefox 90+, Safari 15+, all mobile browsers from 2023+

---

## ⚡ Performance: Hybrid Reactivity System

DiamondJS uses a **dual-mode reactivity system** optimized for different workload characteristics:

### When to Use Each Approach

| Workload Type | Use | Memory (100K items) | Append Time | Best For |
|---------------|-----|---------------------|-------------|----------|
| **Small UI State** | `reactive()` | ~1 MB | 0.01ms | Forms, toggles, small lists |
| **Large Datasets** | `collection()` | ~24 MB | **0.005ms** | Logs, chat, terminal, bulk data |

### The Performance Problem Solved

Traditional reactive proxies degrade on large arrays:
- At 1,000 items: 0.01ms per append
- At 10,000 items: 0.05ms per append  
- At 100,000 items: **0.2ms per append** ⚠️ (40x slower!)

**Why?** Proxy must check dependency map on every mutation. As arrays grow, lookup time increases.

### The Collection Solution

```typescript
// For large datasets - use Collection
const logs = DiamondCore.collection<string>();

// O(1) constant time - 0.005ms regardless of size
logs.push('New log line');

// Subscribe to individual appends
logs.subscribeAppend((line, index) => {
  renderLine(line, index);
});

// Search without proxy overhead
const results = logs.search(line => line.includes('ERROR'));
```

**Performance**: Constant 0.005ms append time even at 100K+ items.

### Decision Matrix

| Criteria | Use Reactive | Use Collection |
|----------|--------------|----------------|
| **Size** | < 1,000 items | > 1,000 items |
| **Pattern** | Update-heavy | Append-heavy |
| **Visibility** | All visible | Virtual scrolling |
| **Examples** | Forms, UI state, grids | Logs, chat, terminal |
| **Developer UX** | Automatic tracking | Explicit subscribe |

### Example: Terminal with 100K Lines

```typescript
export class Terminal extends Component {
  // Use Collection for large dataset
  private lines = DiamondCore.collection<string>();
  
  // Use reactive for UI state
  private viewport = DiamondCore.reactive({
    start: 0,
    end: 50
  });
  
  appendLog(line: string): void {
    this.lines.push(line); // 0.005ms - constant time!
  }
  
  search(query: string): number[] {
    return this.lines.search(line => 
      new RegExp(query, 'gi').test(line)
    ); // ~120ms for 100K lines
  }
}
```

---

## 🎓 Development Philosophy

> **"If a junior dev and a 32B model can both understand it without running it, it's good code."**

DiamondJS is built for the era of human-AI collaborative development. This means:

1. **Every abstraction must be traceable** - No runtime reflection or hidden state
2. **Optimize for comprehension per token** - Not just keystrokes, but understanding
3. **The compiled code is the source of truth** - Debug what the browser runs
4. **Pure OOP patterns prevent steering** - Classes and static methods, not standalone functions
5. **Performance is transparent** - Clear guidance on reactive vs. collection usage

---
## Current Status

See [ROADMAP.md](ROADMAP.md) for detailed development plans and milestones.

---

## 📖 Documentation

### Architecture & Design

- (Forthcoming in upcoming `design_docs` folder)

### Research & Analysis

- (Forthcoming in `research_docs` folder)

### Available at Alpha release

- API Reference
- Tutorial Series
- Example Applications

---

## 📜 License

Affero General Public License 3.0

Note: Interested organizations may inquire about
more permissive FLOSS licenses on a case-by-case basis.

---

## 💎 Made with transparency in mind

*"Everything the browser already does, remove.  
Everything an LLM can easily infer, leave explicit.  
Everything left that truly speeds up human creation, keep."*

---

**Star this repo if you believe the future of frameworks is transparent! 🌟**
