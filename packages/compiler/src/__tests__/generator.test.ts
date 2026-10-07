/**
 * CodeGenerator Tests
 */

import { describe, it, expect } from 'vitest'
import { CodeGenerator } from '../generator'
import type { ElementInfo, TextInfo, NodeInfo } from '../types'

describe('CodeGenerator', () => {
  const generator = new CodeGenerator()

  // Helper to create element info
  function createElement(
    tagName: string,
    options: Partial<ElementInfo> = {}
  ): ElementInfo {
    return {
      tagName,
      bindings: [],
      events: [],
      interpolations: [],
      staticAttrs: new Map(),
      children: [],
      location: null,
      ...options,
    }
  }

  // Helper to create text info
  function createText(content: string, interpolations: { expression: string }[] = []): TextInfo {
    return {
      content,
      interpolations: interpolations.map(i => ({ ...i, location: null })),
      location: null,
    }
  }

  describe('basic element generation', () => {
    it('generates code for a simple element', () => {
      const nodes: NodeInfo[] = [createElement('div')]
      const result = generator.generate(nodes)

      expect(result.code).toContain('createTemplate()')
      expect(result.code).not.toContain('static createTemplate()')
      expect(result.code).not.toContain('return (vm) =>')
      expect(result.code).toContain("document.createElement('div')")
    })

    it('generates [Diamond] hint comment for instance method', () => {
      const nodes: NodeInfo[] = [createElement('div')]
      const result = generator.generate(nodes)

      expect(result.code).toContain('// [Diamond] Compiler-generated instance template method')
    })

    it('generates code for multiple root elements', () => {
      const nodes: NodeInfo[] = [
        createElement('div'),
        createElement('span'),
      ]
      const result = generator.generate(nodes)

      expect(result.code).toContain('document.createDocumentFragment()')
      expect(result.code).toContain('root.append(el_div_0, el_span_1);')
    })

    it('separates tag and counter in variable names (h2 at index 1 is el_h2_1, not h21)', () => {
      const nodes: NodeInfo[] = [createElement('div'), createElement('h2')]
      const result = generator.generate(nodes)

      expect(result.code).toContain("const el_h2_1 = document.createElement('h2')")
      expect(result.code).not.toMatch(/\bh21\b/)
    })

    it('handles empty template', () => {
      const nodes: NodeInfo[] = []
      const result = generator.generate(nodes)

      expect(result.code).toContain("document.createComment('empty')")
    })
  })

  describe('static attribute generation', () => {
    it('generates class attribute', () => {
      const attrs = new Map([['class', 'container']])
      const nodes: NodeInfo[] = [createElement('div', { staticAttrs: attrs })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("el_div_0.className = 'container'")
    })

    it('generates other attributes with setAttribute', () => {
      const attrs = new Map([['id', 'main'], ['data-value', 'test']])
      const nodes: NodeInfo[] = [createElement('div', { staticAttrs: attrs })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("el_div_0.setAttribute('id', 'main')")
      expect(result.code).toContain("el_div_0.setAttribute('data-value', 'test')")
    })

    it('escapes special characters in attributes', () => {
      const attrs = new Map([['title', "Hello 'World'"]])
      const nodes: NodeInfo[] = [createElement('div', { staticAttrs: attrs })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("\\'World\\'")
    })
  })

  describe('binding generation', () => {
    it('generates set binding (was .one-time) as a direct write', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'set',
          property: 'textContent',
          expression: 'title',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('el_span_0.textContent = this.title')
      expect(result.code).not.toContain('DiamondCore.bind')
      expect(result.code).toContain('// [Diamond] Set (static one-shot)')
    })

    it('generates to-view binding', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'to-view',
          property: 'textContent',
          expression: 'message',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.bind(el_span_0, 'textContent', () => this.message)")
      expect(result.code).not.toContain('(v) =>')
      expect(result.code).toContain('// [Diamond] One-way binding')
    })

    it('generates from-view binding as one-way (no getter — model never pushes to sink)', () => {
      const nodes: NodeInfo[] = [createElement('input', {
        bindings: [{
          type: 'from-view',
          property: 'value',
          expression: 'query',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      // undefined getter — DOM → model only
      expect(result.code).toContain("DiamondCore.bind(el_input_0, 'value', undefined, (v) => this.query = v)")
      // must NOT wire a model → DOM getter (that would be two-way)
      expect(result.code).not.toContain('() => this.query,')
      expect(result.code).toContain('// [Diamond] From-view binding (one-way')
    })

    it('generates two-way binding', () => {
      const nodes: NodeInfo[] = [createElement('input', {
        bindings: [{
          type: 'bind',
          property: 'value',
          expression: 'name',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.bind(el_input_0, 'value', () => this.name, (v) => this.name = v)")
      expect(result.code).toContain('// [Diamond] Two-way binding')
    })

    it('marks a raw binding with the RAW hint tag', () => {
      const nodes: NodeInfo[] = [createElement('div', {
        bindings: [{
          type: 'to-view',
          property: 'innerHTML',
          expression: 'userHtml',
          raw: true,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('// [Diamond] RAW One-way binding')
      expect(result.code).toContain("DiamondCore.bind(el_div_0, 'innerHTML', () => this.userHtml)")
    })

    it('handles property paths', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'bind',
          property: 'textContent',
          expression: 'user.profile.name',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('this.user.profile.name')
    })

    it('does not prefix literals', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'set',
          property: 'textContent',
          expression: "'hello'",
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("el_span_0.textContent = 'hello'")
      expect(result.code).not.toContain("this.'hello'")
    })
  })

  describe('security gate diagnostics', () => {
    it('emits stink:warn for an unsafe sink written without raw', () => {
      const nodes: NodeInfo[] = [createElement('div', {
        bindings: [{
          type: 'to-view',
          property: 'innerHTML',
          expression: 'userHtml',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(
        result.diagnostics?.some((d) => d.code === 'stink:warn')
      ).toBe(true)
    })

    it('emits stink:declared for a raw write to an unsafe sink', () => {
      const nodes: NodeInfo[] = [createElement('div', {
        bindings: [{
          type: 'to-view',
          property: 'innerHTML',
          expression: 'userHtml',
          raw: true,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(
        result.diagnostics?.some((d) => d.code === 'stink:declared')
      ).toBe(true)
    })

    it('emits no diagnostics for a safe sink', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'set',
          property: 'textContent',
          expression: 'title',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.diagnostics).toHaveLength(0)
    })

    it('does NOT outbound-gate from-view (inbound — never writes the sink)', () => {
      // innerHTML.from-view would warn if it were treated as an outbound write;
      // it is inbound (DOM → model), so no stink is emitted here (Phase 3 covers it).
      const nodes: NodeInfo[] = [createElement('div', {
        bindings: [{
          type: 'from-view',
          property: 'innerHTML',
          expression: 'userHtml',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(
        result.diagnostics?.some((d) => d.code?.startsWith('stink'))
      ).toBeFalsy()
    })
  })

  describe('event generation', () => {
    it('generates calls event (was .trigger)', () => {
      const nodes: NodeInfo[] = [createElement('button', {
        events: [{
          type: 'calls',
          property: 'click',
          expression: 'save()',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.on(el_button_0, 'click', (e) => this.save())")
      expect(result.code).toContain('// [Diamond] Event binding')
    })

    it('generates capture event', () => {
      const nodes: NodeInfo[] = [createElement('div', {
        events: [{
          type: 'capture',
          property: 'click',
          expression: 'onCapture()',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.on(el_div_0, 'click', (e) => this.onCapture(), true)")
      expect(result.code).toContain('// [Diamond] Capture event')
    })

    it('handles $event parameter', () => {
      const nodes: NodeInfo[] = [createElement('input', {
        events: [{
          type: 'calls',
          property: 'input',
          expression: 'handleInput($event)',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('(e) => this.handleInput(e)')
    })

    it('handles method with arguments', () => {
      const nodes: NodeInfo[] = [createElement('button', {
        events: [{
          type: 'calls',
          property: 'click',
          expression: 'addItem(item, index)',
          raw: false,
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('(e) => this.addItem(this.item, this.index)')
    })
  })

  describe('text and interpolation generation', () => {
    it('generates static text node', () => {
      const nodes: NodeInfo[] = [
        createElement('div', {
          children: [createText('Hello World')],
        }),
      ]
      const result = generator.generate(nodes)

      // #15: static text rides along as a string argument of the parent's append().
      expect(result.code).toContain("el_div_0.append('Hello World');")
      expect(result.code).not.toContain('createTextNode')
    })

    it('generates text with interpolation', () => {
      const nodes: NodeInfo[] = [
        createElement('div', {
          children: [createText('Hello ${name}!', [{ expression: 'name' }])],
        }),
      ]
      const result = generator.generate(nodes)

      expect(result.code).toContain("document.createTextNode('')")
      expect(result.code).toContain("DiamondCore.bind(text_1, 'textContent', () => `Hello ${this.name}!`)")
      expect(result.code).toContain('// [Diamond] Text interpolation: Hello ${name}!')
    })

    it('keeps whitespace-only text (#15)', () => {
      const nodes: NodeInfo[] = [
        createElement('div', {
          children: [createText('   ')],
        }),
      ]
      const result = generator.generate(nodes)

      expect(result.code).toContain("el_div_0.append('   ');")
      expect(result.code).not.toContain('createTextNode')
    })
  })

  describe('nested elements', () => {
    it('generates code for nested elements', () => {
      const nodes: NodeInfo[] = [
        createElement('div', {
          children: [
            createElement('span'),
            createElement('p'),
          ],
        }),
      ]
      const result = generator.generate(nodes)

      expect(result.code).toContain("document.createElement('div')")
      expect(result.code).toContain("document.createElement('span')")
      expect(result.code).toContain("document.createElement('p')")
      expect(result.code).toContain('el_div_0.append(el_span_1, el_p_2);')
    })
  })

  // #18 — whitespace between two branches is syntax; whitespace after the
  // last branch is content and must be left for the caller to generate.
  describe('if / else-if chain collection', () => {
    const branch = (type: 'if' | 'else-if', expression: string): ElementInfo =>
      createElement('span', { structural: { type, expression, location: null } })
    const NBSP = String.fromCharCode(0xa0)
    // collectIfChain is private; bracket access keeps the call type-checked.
    const collect = (nodes: NodeInfo[]) => generator['collectIfChain'](nodes, 0)

    it('does not consume whitespace after an if when no else-if follows', () => {
      const { branches, next } = collect([branch('if', 'ok'), createText(' '), createElement('b')])
      expect(branches).toHaveLength(1)
      expect(next).toBe(1)
    })

    it('consumes whitespace between branches but not after the last one', () => {
      const { branches, next } = collect([
        branch('if', 'a'),
        createText('\n  '),
        branch('else-if', 'b'),
        createText('\n'),
        createElement('p'),
      ])
      expect(branches).toHaveLength(2)
      expect(next).toBe(3) // the trailing whitespace
    })

    it('collects a chain of three across whitespace', () => {
      const { branches, next } = collect([
        branch('if', 'a'),
        createText(' \t'),
        branch('else-if', 'b'),
        createText('\r\n\f'),
        branch('else-if', 'c'),
      ])
      expect(branches.map((b) => b.structural?.expression)).toEqual(['a', 'b', 'c'])
      expect(next).toBe(5)
    })

    it('adjacent branches still chain, and an if at the end of its parent stops cleanly', () => {
      expect(collect([branch('if', 'a'), branch('else-if', 'b')])).toMatchObject({ next: 2 })
      expect(collect([branch('if', 'a')])).toMatchObject({ next: 1 })
      expect(collect([branch('if', 'a'), createText('\n')])).toMatchObject({ next: 1 })
    })

    it('an NBSP between if and else-if is content: the else-if is orphaned', () => {
      const children = [branch('if', 'a'), createText(NBSP), branch('else-if', 'b')]
      expect(collect(children)).toMatchObject({ next: 1 })

      const result = generator.generate([createElement('div', { children })])
      expect(result.diagnostics?.some((d) => d.code === 'orphan-else-if')).toBe(true)
      expect(result.code).toContain('// [Diamond] Conditional: if="a"')
      expect(result.code).not.toContain('else-if)')
    })
  })

  describe('source maps', () => {
    it('generates source map when enabled', () => {
      const gen = new CodeGenerator({ sourceMap: true, filePath: 'test.html' })
      const nodes: NodeInfo[] = [createElement('div')]
      const result = gen.generate(nodes)

      expect(result.map).toBeDefined()
      const map = JSON.parse(result.map!)
      expect(map.version).toBe(3)
      expect(map.sources).toContain('test.html')
    })

    it('does not generate source map when disabled', () => {
      const gen = new CodeGenerator({ sourceMap: false })
      const nodes: NodeInfo[] = [createElement('div')]
      const result = gen.generate(nodes)

      expect(result.map).toBeUndefined()
    })
  })
})
