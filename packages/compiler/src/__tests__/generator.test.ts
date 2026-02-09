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

      expect(result.code).toContain('static createTemplate()')
      expect(result.code).toContain('return (vm) =>')
      expect(result.code).toContain("document.createElement('div')")
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
    it('generates one-time binding', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'one-time',
          property: 'textContent',
          expression: 'title',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('span0.textContent = vm.title')
      expect(result.code).not.toContain('DiamondCore.bind')
    })

    it('generates to-view binding', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'to-view',
          property: 'textContent',
          expression: 'message',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.bind(span0, 'textContent', () => vm.message)")
      expect(result.code).not.toContain('(v) =>')
    })

    it('generates from-view binding', () => {
      const nodes: NodeInfo[] = [createElement('input', {
        bindings: [{
          type: 'from-view',
          property: 'value',
          expression: 'query',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.bind(input0, 'value', () => vm.query, (v) => vm.query = v)")
    })

    it('generates two-way binding', () => {
      const nodes: NodeInfo[] = [createElement('input', {
        bindings: [{
          type: 'bind',
          property: 'value',
          expression: 'name',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.bind(input0, 'value', () => vm.name, (v) => vm.name = v)")
    })

    it('handles property paths', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'bind',
          property: 'textContent',
          expression: 'user.profile.name',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('vm.user.profile.name')
    })

    it('does not prefix literals', () => {
      const nodes: NodeInfo[] = [createElement('span', {
        bindings: [{
          type: 'one-time',
          property: 'textContent',
          expression: "'hello'",
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("span0.textContent = 'hello'")
      expect(result.code).not.toContain("vm.'hello'")
    })
  })

  describe('event generation', () => {
    it('generates trigger event', () => {
      const nodes: NodeInfo[] = [createElement('button', {
        events: [{
          type: 'trigger',
          property: 'click',
          expression: 'save()',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.on(button0, 'click', (e) => vm.save())")
    })

    it('generates capture event', () => {
      const nodes: NodeInfo[] = [createElement('div', {
        events: [{
          type: 'capture',
          property: 'click',
          expression: 'onCapture()',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain("DiamondCore.on(div0, 'click', (e) => vm.onCapture(), true)")
    })

    it('handles $event parameter', () => {
      const nodes: NodeInfo[] = [createElement('input', {
        events: [{
          type: 'trigger',
          property: 'input',
          expression: 'handleInput($event)',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('(e) => vm.handleInput(e)')
    })

    it('handles method with arguments', () => {
      const nodes: NodeInfo[] = [createElement('button', {
        events: [{
          type: 'trigger',
          property: 'click',
          expression: 'addItem(item, index)',
          location: null,
        }],
      })]
      const result = generator.generate(nodes)

      expect(result.code).toContain('(e) => vm.addItem(vm.item, vm.index)')
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
      expect(result.code).toContain("DiamondCore.bind(text1, 'textContent', () => `Hello ${vm.name}!`)")
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
