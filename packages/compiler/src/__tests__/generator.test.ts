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
      expect(result.code).toContain('root.appendChild(div0)')
      expect(result.code).toContain('root.appendChild(span1)')
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

      expect(result.code).toContain("div0.className = 'container'")
    })

    it('generates other attributes with setAttribute', () => {
      const attrs = new Map([['id', 'main'], ['data-value', 'test']])
      const nodes: NodeInfo[] = [createElement('div', { staticAttrs: attrs })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("div0.setAttribute('id', 'main')")
      expect(result.code).toContain("div0.setAttribute('data-value', 'test')")
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

      expect(result.code).toContain('span0.textContent = this.title')
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

      expect(result.code).toContain("DiamondCore.bind(span0, 'textContent', () => this.message)")
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
      expect(result.code).toContain("DiamondCore.bind(input0, 'value', undefined, (v) => this.query = v)")
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

      expect(result.code).toContain("DiamondCore.bind(input0, 'value', () => this.name, (v) => this.name = v)")
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
      expect(result.code).toContain("DiamondCore.bind(div0, 'innerHTML', () => this.userHtml)")
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

      expect(result.code).toContain("span0.textContent = 'hello'")
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

      expect(result.code).toContain("DiamondCore.on(button0, 'click', (e) => this.save())")
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

      expect(result.code).toContain("DiamondCore.on(div0, 'click', (e) => this.onCapture(), true)")
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

      expect(result.code).toContain("document.createTextNode('Hello World')")
    })

    it('generates text with interpolation', () => {
      const nodes: NodeInfo[] = [
        createElement('div', {
          children: [createText('Hello ${name}!', [{ expression: 'name' }])],
        }),
      ]
      const result = generator.generate(nodes)

      expect(result.code).toContain("document.createTextNode('')")
      expect(result.code).toContain("DiamondCore.bind(text1, 'textContent', () => `Hello ${this.name}!`)")
      expect(result.code).toContain('// [Diamond] Text interpolation: Hello ${name}!')
    })

    it('skips empty text nodes', () => {
      const nodes: NodeInfo[] = [
        createElement('div', {
          children: [createText('   ')],
        }),
      ]
      const result = generator.generate(nodes)

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
      expect(result.code).toContain('div0.appendChild(span1)')
      expect(result.code).toContain('div0.appendChild(p2)')
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
