0 / 14 viewed
0 of 14 files viewed
Filter files…
File tree
packages
compiler/src
__tests__
compiler.test.ts
generator.test.ts
parser.test.ts
compiler.ts
generator.ts
parser.ts
types.ts
parcel-plugin/src
__tests__
transformer.test.ts
utils.ts
runtime
src
core.ts
decorators.ts
tests
core.test.ts
FAQ.md
README.md
packages/compiler/src/__tests__/compiler.test.ts
+16
Lines changed: 16 additions & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change
      expect(result.code).toContain('this.message')
      expect(result.code).toContain('this.message')
    })
    })


    it('blocks unsafe DOM sink bindings by default', () => {
      expect(() => {
        compiler.compile('<div innerhtml.bind="userContent"></div>')
      }).toThrow(CompileError)
    })
    it('allows unsafe DOM sink bindings with explicit unsafe-bind', () => {
      const result = compiler.compile(
        '<div innerhtml.unsafe-bind="trustedHtml"></div>'
      )
      expect(result.code).toContain(
        "DiamondCore.bindUnsafe(div0, 'innerHTML', () => this.trustedHtml, (v) => this.trustedHtml = v)"
      )
    })
    it('emits [Diamond] hint comments', () => {
    it('emits [Diamond] hint comments', () => {
      const result = compiler.compile('<input value.bind="name">')
      const result = compiler.compile('<input value.bind="name">')


packages/compiler/src/__tests__/generator.test.ts
+15
Lines changed: 15 additions & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change
      expect(result.code).toContain('// [Diamond] Two-way binding')
      expect(result.code).toContain('// [Diamond] Two-way binding')
    })
    })


    it('generates explicit unsafe binding', () => {
      const nodes: NodeInfo[] = [createElement('div', {
        bindings: [{
          type: 'unsafe-bind',
          property: 'innerHTML',
          expression: 'trustedHtml',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)
      expect(result.code).toContain("DiamondCore.bindUnsafe(div0, 'innerHTML', () => this.trustedHtml, (v) => this.trustedHtml = v)")
      expect(result.code).toContain('// [Diamond] UNSAFE two-way binding (opt-in)')
    })
    it('handles property paths', () => {
    it('handles property paths', () => {
      const nodes: NodeInfo[] = [createElement('span', {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
        bindings: [{
packages/compiler/src/__tests__/parser.test.ts
+11
Lines changed: 11 additions & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change
      }
      }
    })
    })


    it('parses unsafe-bind binding', () => {
      const nodes = parser.parse('<div innerhtml.unsafe-bind="trustedHtml"></div>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('unsafe-bind')
        expect(nodes[0].bindings[0].property).toBe('innerHTML')
        expect(nodes[0].bindings[0].expression).toBe('trustedHtml')
      }
    })
    it('parses property paths', () => {
    it('parses property paths', () => {
      const nodes = parser.parse('<span textContent.bind="user.profile.name"></span>')
      const nodes = parser.parse('<span textContent.bind="user.profile.name"></span>')
      expect(nodes).toHaveLength(1)
      expect(nodes).toHaveLength(1)
packages/compiler/src/compiler.ts
+46
-1
Lines changed: 46 additions & 1 deletion
Original file line number	Original file line	Diff line number	Diff line change


import { TemplateParser } from './parser'
import { TemplateParser } from './parser'
import { CodeGenerator } from './generator'
import { CodeGenerator } from './generator'
import type { CompilerOptions, CompileResult } from './types'
import type { CompilerOptions, CompileResult, NodeInfo, ElementInfo } from './types'
import { isElementInfo } from './types'
const UNSAFE_DOM_SINK_PROPERTIES = new Set(['innerhtml', 'outerhtml', 'srcdoc'])


/**
/**
 * DiamondCompiler - The main template compiler
 * DiamondCompiler - The main template compiler
    // Parse the template
    // Parse the template
    const nodes = this.parser.parse(template)
    const nodes = this.parser.parse(template)


    // Security validation
    this.validateBindingSecurity(nodes)
    // Generate code
    // Generate code
    const generator = new CodeGenerator(options)
    const generator = new CodeGenerator(options)
    return generator.generate(nodes)
    return generator.generate(nodes)
  }
  }


  /**
   * Block unsafe DOM sink bindings unless explicitly opted in with .unsafe-bind
   */
  private validateBindingSecurity(nodes: NodeInfo[]): void {
    for (const node of nodes) {
      if (!isElementInfo(node)) continue
      this.validateElementBindingSecurity(node)
    }
  }
  private validateElementBindingSecurity(element: ElementInfo): void {
    for (const binding of element.bindings) {
      if (binding.type === 'unsafe-bind') {
        continue
      }
      if (!this.isUnsafeDomSinkProperty(binding.property)) {
        continue
      }
      const location = binding.location || element.location || { line: 1, column: 0 }
      throw new CompileError(
        `Unsafe DOM sink "${binding.property}" is blocked by default. ` +
          `Use .unsafe-bind only with trusted, sanitized content.`,
        { line: location.line, column: location.column }
      )
    }
    for (const child of element.children) {
      if (isElementInfo(child)) {
        this.validateElementBindingSecurity(child)
      }
    }
  }
  private isUnsafeDomSinkProperty(property: string): boolean {
    return UNSAFE_DOM_SINK_PROPERTIES.has(property.toLowerCase())
  }
  /**
  /**
   * Compile a template and inject into a component class
   * Compile a template and inject into a component class
   *
   *
packages/compiler/src/generator.ts
+11
Lines changed: 11 additions & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change
        )
        )
        break
        break


      case 'unsafe-bind':
        // [Diamond] hint
        this.emitLine(
          `// [Diamond] UNSAFE two-way binding (opt-in): ${binding.property} ↔ this.${binding.expression}`
        )
        this.emitLine(
          `DiamondCore.bindUnsafe(${varName}, '${binding.property}', () => ${expr}, (v) => ${expr} = v);`,
          binding.location
        )
        break
      case 'from-view':
      case 'from-view':
        // [Diamond] hint
        // [Diamond] hint
        this.emitLine(
        this.emitLine(
packages/compiler/src/parser.ts
+1
Lines changed: 1 addition & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change
  private parseBindingCommand(command: string): BindingType {
  private parseBindingCommand(command: string): BindingType {
    const commandMap: Record<string, BindingType> = {
    const commandMap: Record<string, BindingType> = {
      bind: 'bind',
      bind: 'bind',
      'unsafe-bind': 'unsafe-bind',
      'one-time': 'one-time',
      'one-time': 'one-time',
      'to-view': 'to-view',
      'to-view': 'to-view',
      'from-view': 'from-view',
      'from-view': 'from-view',
packages/compiler/src/types.ts
+1
Lines changed: 1 addition & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change
 */
 */
export type BindingType =
export type BindingType =
  | 'bind'      // Two-way binding (default)
  | 'bind'      // Two-way binding (default)
  | 'unsafe-bind' // Two-way binding to unsafe DOM sinks (explicit opt-in)
  | 'one-time'  // One-time binding (no updates)
  | 'one-time'  // One-time binding (no updates)
  | 'to-view'   // One-way to view
  | 'to-view'   // One-way to view
  | 'from-view' // One-way from view
  | 'from-view' // One-way from view
packages/parcel-plugin/src/__tests__/transformer.test.ts
+6
Lines changed: 6 additions & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change
    expect(isDiamondTemplate('<input value.bind="name">')).toBe(true)
    expect(isDiamondTemplate('<input value.bind="name">')).toBe(true)
  })
  })


  it('detects .unsafe-bind syntax', () => {
    expect(
      isDiamondTemplate('<div innerhtml.unsafe-bind="trustedHtml"></div>')
    ).toBe(true)
  })
  it('detects .one-time syntax', () => {
  it('detects .one-time syntax', () => {
    expect(isDiamondTemplate('<span textContent.one-time="title"></span>')).toBe(
    expect(isDiamondTemplate('<span textContent.one-time="title"></span>')).toBe(
      true
      true
packages/parcel-plugin/src/utils.ts
+1
-1
Lines changed: 1 addition & 1 deletion
Original file line number	Original file line	Diff line number	Diff line change
export function isDiamondTemplate(code: string): boolean {
export function isDiamondTemplate(code: string): boolean {
  // Check for binding syntax: property.command="expression"
  // Check for binding syntax: property.command="expression"
  const bindingPattern =
  const bindingPattern =
    /\.\s*(bind|one-time|to-view|from-view|two-way|trigger|delegate|capture)\s*=/
    /\.\s*(bind|unsafe-bind|one-time|to-view|from-view|two-way|trigger|delegate|capture)\s*=/
  // Check for interpolation syntax: ${...}
  // Check for interpolation syntax: ${...}
  const interpolationPattern = /\$\{[^}]+\}/
  const interpolationPattern = /\$\{[^}]+\}/


packages/runtime/src/core.ts
+45
Lines changed: 45 additions & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change


type CleanupFn = () => void
type CleanupFn = () => void


const UNSAFE_DOM_SINK_PROPERTIES = new Set(['innerhtml', 'outerhtml', 'srcdoc'])
/**
/**
 * DiamondCore - The main runtime API class
 * DiamondCore - The main runtime API class
 * 
 * 
    getter: () => unknown,
    getter: () => unknown,
    setter?: (value: unknown) => void
    setter?: (value: unknown) => void
  ): CleanupFn {
  ): CleanupFn {
    return this.bindInternal(element, property, getter, setter, false)
  }
  /**
   * Bind to an unsafe DOM sink (innerHTML/outerHTML/srcdoc).
   * Use only with trusted, sanitized content.
   */
  static bindUnsafe(
    element: HTMLElement,
    property: string,
    getter: () => unknown,
    setter?: (value: unknown) => void
  ): CleanupFn {
    return this.bindInternal(element, property, getter, setter, true)
  }
  /**
   * Shared binding implementation for safe and explicit-unsafe paths.
   */
  private static bindInternal(
    element: HTMLElement,
    property: string,
    getter: () => unknown,
    setter: ((value: unknown) => void) | undefined,
    allowUnsafe: boolean
  ): CleanupFn {
    this.assertSafeBindingProperty(property, allowUnsafe)
    // Cast element for dynamic property access
    // Cast element for dynamic property access
    const el = element as unknown as Record<string, unknown>
    const el = element as unknown as Record<string, unknown>


    }
    }
  }
  }


  private static assertSafeBindingProperty(
    property: string,
    allowUnsafe: boolean
  ): void {
    const normalized = property.toLowerCase()
    if (allowUnsafe || !UNSAFE_DOM_SINK_PROPERTIES.has(normalized)) {
      return
    }
    throw new Error(
      `[Diamond] Refused unsafe binding to "${property}". ` +
        'Use .unsafe-bind in templates or DiamondCore.bindUnsafe() with trusted, sanitized content.'
    )
  }
  /**
  /**
   * Attach an event listener to an element
   * Attach an event listener to an element
   * 
   * 
packages/runtime/src/decorators.ts
+1
-1
Lines changed: 1 addition & 1 deletion
Original file line number	Original file line	Diff line number	Diff line change
      return store ? store.value : undefined
      return store ? store.value : undefined
    },
    },
    set(this: Record<symbol, { value: unknown }>, newValue: unknown) {
    set(this: Record<symbol, { value: unknown }>, newValue: unknown) {
      let store = this[storageKey]
      const store = this[storageKey]
      if (!store) {
      if (!store) {
        // First assignment (field initializer) — create reactive backing store
        // First assignment (field initializer) — create reactive backing store
        this[storageKey] = reactivityEngine.createProxy({ value: newValue })
        this[storageKey] = reactivityEngine.createProxy({ value: newValue })
packages/runtime/tests/core.test.ts
+18
Lines changed: 18 additions & 0 deletions
Original file line number	Original file line	Diff line number	Diff line change
      expect(div.textContent).toBe('Hello')
      expect(div.textContent).toBe('Hello')
    })
    })


    it('should block unsafe DOM sink bindings by default', () => {
      const div = document.createElement('div')
      expect(() => {
        DiamondCore.bind(div, 'innerHTML', () => '<img src=x onerror=alert(1)>')
      }).toThrow('Refused unsafe binding')
    })
    it('should allow unsafe DOM sink bindings with explicit bindUnsafe', async () => {
      const state = DiamondCore.reactive({ html: '<strong>trusted</strong>' })
      const div = document.createElement('div')
      DiamondCore.bindUnsafe(div, 'innerHTML', () => state.html)
      await vi.runAllTimersAsync()
      expect(div.innerHTML).toBe('<strong>trusted</strong>')
    })
    it('should use change event for checkboxes', async () => {
    it('should use change event for checkboxes', async () => {
      const state = DiamondCore.reactive({ checked: false })
      const state = DiamondCore.reactive({ checked: false })
      const input = document.createElement('input')
      const input = document.createElement('input')
FAQ.md
+3
Lines changed: 3 additions & 0 deletions


Original file line number	Original file line	Diff line number	Diff line change
## **Q: Which browsers are supported?**
Chrome/Edge 90+, Firefox 90+, Safari 15+, and all mobile browsers from 2023+. We target browsers with native support for private class fields, optional chaining, nullish coalescing, and other ES2022+ features.

## **Q: When should I use `collection()` vs `reactive()`?**
Use `reactive()` for small UI state (< 1,000 items, update-heavy workloads like forms). Use `collection()` for large datasets (> 1,000 items, append-heavy workloads like logs, chat, terminals). The performance difference is dramatic: constant 0.005ms appends with Collection vs. degrading to 0.2ms at 100K items with reactive.

README.md
+5
Lines changed: 5 additions & 0 deletions


Original file line number	Original file line	Diff line number	Diff line change
<!-- Interpolation -->
<!-- Interpolation -->
<p>Hello, ${name}!</p>
<p>Hello, ${name}!</p>


<!-- Explicit unsafe HTML binding (trusted/sanitized content only) -->
<div innerhtml.unsafe-bind="trustedHtml"></div>
<!-- Conditional rendering -->
<!-- Conditional rendering -->
<div if.bind="isLoggedIn">Welcome back</div>
<div if.bind="isLoggedIn">Welcome back</div>


</ul>
</ul>
```
```


Security defaults: DiamondJS blocks unsafe DOM sink bindings (`innerHTML`, `outerHTML`, `srcdoc`) for normal `.bind`/`.to-view`/`.two-way` usage. Use `.unsafe-bind` only for trusted, sanitized content.
---
---


## Project Structure
## Project Structure
