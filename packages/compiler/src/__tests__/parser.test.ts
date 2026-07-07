/**
 * TemplateParser Tests
 */

import { describe, it, expect } from 'vitest'
import { TemplateParser } from '../parser'
import { isElementInfo, isTextInfo } from '../types'

describe('TemplateParser', () => {
  const parser = new TemplateParser()

  describe('basic element parsing', () => {
    it('parses a simple element', () => {
      const nodes = parser.parse('<div></div>')
      expect(nodes).toHaveLength(1)
      expect(isElementInfo(nodes[0])).toBe(true)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].tagName).toBe('div')
      }
    })

    it('parses self-closing elements', () => {
      const nodes = parser.parse('<input>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].tagName).toBe('input')
      }
    })

    it('parses nested elements', () => {
      const nodes = parser.parse('<div><span></span></div>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].tagName).toBe('div')
        expect(nodes[0].children).toHaveLength(1)
        const child = nodes[0].children[0]
        if (isElementInfo(child)) {
          expect(child.tagName).toBe('span')
        }
      }
    })

    it('parses multiple root elements', () => {
      const nodes = parser.parse('<div></div><span></span>')
      expect(nodes).toHaveLength(2)
      if (isElementInfo(nodes[0]) && isElementInfo(nodes[1])) {
        expect(nodes[0].tagName).toBe('div')
        expect(nodes[1].tagName).toBe('span')
      }
    })
  })

  describe('static attributes', () => {
    it('parses static attributes', () => {
      const nodes = parser.parse('<div class="container" id="main"></div>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].staticAttrs.get('class')).toBe('container')
        expect(nodes[0].staticAttrs.get('id')).toBe('main')
      }
    })

    it('parses attributes without values', () => {
      const nodes = parser.parse('<input disabled>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].staticAttrs.has('disabled')).toBe(true)
      }
    })
  })

  describe('binding parsing', () => {
    it('parses value.bind binding', () => {
      const nodes = parser.parse('<input value.bind="name">')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('bind')
        expect(nodes[0].bindings[0].property).toBe('value')
        expect(nodes[0].bindings[0].expression).toBe('name')
      }
    })

    it('parses set binding (was .one-time)', () => {
      const nodes = parser.parse('<span textContent.set="title"></span>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('set')
        expect(nodes[0].bindings[0].raw).toBe(false)
        expect(nodes[0].bindings[0].property).toBe('textContent')
        expect(nodes[0].bindings[0].expression).toBe('title')
      }
    })

    it('parses rawSet binding (raw flag set)', () => {
      const nodes = parser.parse('<div innerHTML.rawSet="html"></div>')
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('set')
        expect(nodes[0].bindings[0].raw).toBe(true)
        expect(nodes[0].bindings[0].property).toBe('innerHTML')
      }
    })

    it('parses three-segment rawBind.to-view (raw flag, no flattened token)', () => {
      const nodes = parser.parse('<div innerHTML.rawBind.to-view="html"></div>')
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('to-view')
        expect(nodes[0].bindings[0].raw).toBe(true)
        expect(nodes[0].bindings[0].property).toBe('innerHTML')
      }
    })

    it('parses three-segment bind.from-view', () => {
      const nodes = parser.parse('<input value.bind.from-view="query">')
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings[0].type).toBe('from-view')
        expect(nodes[0].bindings[0].raw).toBe(false)
      }
    })

    it('parses to-view binding', () => {
      const nodes = parser.parse('<span textContent.to-view="message"></span>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('to-view')
      }
    })

    it('parses from-view binding', () => {
      const nodes = parser.parse('<input value.from-view="query">')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('from-view')
      }
    })

    it('parses two-way binding', () => {
      const nodes = parser.parse('<input value.two-way="email">')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('two-way')
      }
    })

    it('parses property paths', () => {
      const nodes = parser.parse('<span textContent.bind="user.profile.name"></span>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings[0].expression).toBe('user.profile.name')
      }
    })
  })

  describe('event binding parsing', () => {
    it('parses calls event (was .trigger)', () => {
      const nodes = parser.parse('<button click.calls="save()"></button>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].events).toHaveLength(1)
        expect(nodes[0].events[0].type).toBe('calls')
        expect(nodes[0].events[0].property).toBe('click')
        expect(nodes[0].events[0].expression).toBe('save()')
      }
    })

    it('parses capture event', () => {
      const nodes = parser.parse('<div click.capture="onCapture()"></div>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].events).toHaveLength(1)
        expect(nodes[0].events[0].type).toBe('capture')
      }
    })

    it('parses event with $event', () => {
      const nodes = parser.parse('<input input.calls="handleInput($event)"></input>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].events[0].expression).toBe('handleInput($event)')
      }
    })
  })

  describe('retired / unknown command diagnostics', () => {
    it('rejects .one-time with a retired-command error and drops the binding', () => {
      const nodes = parser.parse('<span textContent.one-time="t"></span>')
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(0)
      }
      expect(
        parser.diagnostics.some(
          (d) => d.severity === 'error' && d.code === 'retired-command'
        )
      ).toBe(true)
    })

    it('rejects .trigger with a retired-command error', () => {
      parser.parse('<button click.trigger="save()"></button>')
      const diag = parser.diagnostics.find((d) => d.code === 'retired-command')
      expect(diag?.message).toContain("'.calls'")
    })

    it('rejects removed .delegate with a retired-command error and drops the event', () => {
      const nodes = parser.parse('<button click.delegate="f()"></button>')
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].events).toHaveLength(0)
      }
      expect(
        parser.diagnostics.some((d) => d.code === 'retired-command')
      ).toBe(true)
    })

    it('rejects an unknown command (no silent bind fallback)', () => {
      const nodes = parser.parse('<span value.bnid="x"></span>')
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(0)
      }
      expect(
        parser.diagnostics.some(
          (d) => d.severity === 'error' && d.code === 'unknown-command'
        )
      ).toBe(true)
    })

    it('resets diagnostics between parses', () => {
      parser.parse('<button click.trigger="save()"></button>')
      expect(parser.diagnostics.length).toBeGreaterThan(0)
      parser.parse('<button click.calls="save()"></button>')
      expect(parser.diagnostics).toHaveLength(0)
    })
  })

  describe('text and interpolation parsing', () => {
    it('parses static text', () => {
      const nodes = parser.parse('<div>Hello World</div>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].children).toHaveLength(1)
        const textNode = nodes[0].children[0]
        if (isTextInfo(textNode)) {
          expect(textNode.content).toBe('Hello World')
          expect(textNode.interpolations).toHaveLength(0)
        }
      }
    })

    it('parses text with interpolation', () => {
      const nodes = parser.parse('<div>Hello ${name}!</div>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        const textNode = nodes[0].children[0]
        if (isTextInfo(textNode)) {
          expect(textNode.content).toBe('Hello ${name}!')
          expect(textNode.interpolations).toHaveLength(1)
          expect(textNode.interpolations[0].expression).toBe('name')
        }
      }
    })

    it('parses multiple interpolations', () => {
      const nodes = parser.parse('<div>${firstName} ${lastName}</div>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        const textNode = nodes[0].children[0]
        if (isTextInfo(textNode)) {
          expect(textNode.interpolations).toHaveLength(2)
          expect(textNode.interpolations[0].expression).toBe('firstName')
          expect(textNode.interpolations[1].expression).toBe('lastName')
        }
      }
    })

    it('skips whitespace-only text nodes', () => {
      const nodes = parser.parse('<div>   </div>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].children).toHaveLength(0)
      }
    })
  })

  describe('source location tracking', () => {
    it('tracks element locations', () => {
      const nodes = parser.parse('<div></div>')
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].location).not.toBeNull()
        expect(nodes[0].location?.line).toBe(1)
      }
    })

    it('tracks binding locations', () => {
      const nodes = parser.parse('<input value.bind="name">')
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings[0].location).not.toBeNull()
      }
    })
  })

  describe('mixed content', () => {
    it('parses element with bindings, events, and children', () => {
      const html = `
        <div class="container" id.bind="dynamicId" click.calls="handleClick()">
          <span textContent.bind="message"></span>
          <input value.bind="inputValue">
        </div>
      `
      const nodes = parser.parse(html)
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].tagName).toBe('div')
        expect(nodes[0].staticAttrs.get('class')).toBe('container')
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].events).toHaveLength(1)
        // Children include whitespace text nodes that are filtered, plus 2 elements
        const elementChildren = nodes[0].children.filter(isElementInfo)
        expect(elementChildren).toHaveLength(2)
      }
    })
  })
})
