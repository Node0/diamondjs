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

    it('parses one-time binding', () => {
      const nodes = parser.parse('<span textContent.one-time="title"></span>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].bindings).toHaveLength(1)
        expect(nodes[0].bindings[0].type).toBe('one-time')
        expect(nodes[0].bindings[0].property).toBe('textContent')
        expect(nodes[0].bindings[0].expression).toBe('title')
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
    it('parses trigger event', () => {
      const nodes = parser.parse('<button click.trigger="save()"></button>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].events).toHaveLength(1)
        expect(nodes[0].events[0].type).toBe('trigger')
        expect(nodes[0].events[0].property).toBe('click')
        expect(nodes[0].events[0].expression).toBe('save()')
      }
    })

    it('parses delegate event', () => {
      const nodes = parser.parse('<button click.delegate="handleClick()"></button>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].events).toHaveLength(1)
        expect(nodes[0].events[0].type).toBe('delegate')
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
      const nodes = parser.parse('<input input.trigger="handleInput($event)"></input>')
      expect(nodes).toHaveLength(1)
      if (isElementInfo(nodes[0])) {
        expect(nodes[0].events[0].expression).toBe('handleInput($event)')
      }
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
        <div class="container" id.bind="dynamicId" click.trigger="handleClick()">
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
