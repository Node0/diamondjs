/**
 * DiamondCompiler Tests
 */

import { describe, it, expect } from 'vitest'
import { DiamondCompiler, CompileError } from '../compiler'

describe('DiamondCompiler', () => {
  const compiler = new DiamondCompiler()

  describe('compile()', () => {
    it('compiles a simple element', () => {
      const result = compiler.compile('<div></div>')

      expect(result.code).toContain('createTemplate()')
      expect(result.code).not.toContain('static createTemplate()')
      expect(result.code).toContain("document.createElement('div')")
    })

    it('compiles element with binding', () => {
      const result = compiler.compile('<input value.bind="name">')

      expect(result.code).toContain("DiamondCore.bind(el_input_0, 'value', () => this.name")
    })

    it('compiles element with event', () => {
      const result = compiler.compile('<button click.calls="save()"></button>')

      expect(result.code).toContain("DiamondCore.on(el_button_0, 'click'")
    })

    it('compiles element with interpolation', () => {
      const result = compiler.compile('<div>${message}</div>')

      expect(result.code).toContain('DiamondCore.bind')
      expect(result.code).toContain('this.message')
    })

    it('emits [Diamond] hint comments', () => {
      const result = compiler.compile('<input value.bind="name">')

      expect(result.code).toContain('// [Diamond]')
    })

    it('generates source map when filePath provided', () => {
      const result = compiler.compile('<div></div>', { filePath: 'test.html' })

      expect(result.map).toBeDefined()
    })

    it('does not generate source map when disabled', () => {
      const result = compiler.compile('<div></div>', { sourceMap: false })

      expect(result.map).toBeUndefined()
    })
  })

  describe('compileAndInject()', () => {
    it('injects createTemplate into a component class', () => {
      const template = '<input value.bind="name">'
      const componentSource = `
export class MyComponent {
  name = ''
}
`
      const result = compiler.compileAndInject(template, componentSource)

      expect(result.code).toContain('createTemplate()')
      expect(result.code).not.toContain('static createTemplate()')
      expect(result.code).toContain('export class MyComponent')
      expect(result.code).toContain("DiamondCore.bind(el_input_0, 'value', () => this.name")
    })

    it('adds DiamondCore import if missing', () => {
      const template = '<div></div>'
      const componentSource = `
export class MyComponent {
}
`
      const result = compiler.compileAndInject(template, componentSource)

      expect(result.code).toContain("import { DiamondCore } from '@diamondjs/runtime'")
    })

    it('extends existing diamond import', () => {
      const template = '<div></div>'
      const componentSource = `
import { Component } from '@diamondjs/runtime'

export class MyComponent extends Component {
}
`
      const result = compiler.compileAndInject(template, componentSource)

      expect(result.code).toContain('Component, DiamondCore')
    })

    it('does not duplicate DiamondCore import', () => {
      const template = '<div></div>'
      const componentSource = `
import { DiamondCore } from '@diamondjs/runtime'

export class MyComponent {
}
`
      const result = compiler.compileAndInject(template, componentSource)

      // Count occurrences of DiamondCore import
      const importMatches = result.code.match(/import.*DiamondCore.*from/g)
      expect(importMatches).toHaveLength(1)
    })

    it('uses specified className', () => {
      const template = '<div></div>'
      const componentSource = `
class Foo {}
export class MyComponent {}
`
      const result = compiler.compileAndInject(template, componentSource, {
        className: 'MyComponent',
      })

      // Should inject into MyComponent, not Foo
      expect(result.code).toContain('export class MyComponent {\n')
      expect(result.code).toContain('createTemplate()')
    })

    it('throws if class not found', () => {
      const template = '<div></div>'
      const componentSource = `const x = 1;`

      expect(() => {
        compiler.compileAndInject(template, componentSource)
      }).toThrow(CompileError)
    })

    it('throws if specified className not found', () => {
      const template = '<div></div>'
      const componentSource = `export class MyComponent {}`

      expect(() => {
        compiler.compileAndInject(template, componentSource, {
          className: 'NonExistent',
        })
      }).toThrow(CompileError)
    })
  })

  describe('integration scenarios', () => {
    it('compiles a complete form', () => {
      const template = `
        <form submit.calls="onSubmit()">
          <label>Name:</label>
          <input type="text" value.bind="name">
          <label>Email:</label>
          <input type="email" value.bind="email">
          <button type="submit">Submit</button>
        </form>
      `
      const result = compiler.compile(template)

      expect(result.code).toContain("document.createElement('form')")
      expect(result.code).toContain("DiamondCore.on(el_form_0, 'submit'")
      // Use patterns since variable numbering includes text nodes
      expect(result.code).toMatch(/DiamondCore\.bind\(el_input_\d+, 'value', \(\) => this\.name/)
      expect(result.code).toMatch(/DiamondCore\.bind\(el_input_\d+, 'value', \(\) => this\.email/)
    })

    it('compiles a component with all binding types', () => {
      const template = `
        <div>
          <span textContent.set="title"></span>
          <span textContent.to-view="message"></span>
          <input value.from-view="query">
          <input value.two-way="name">
          <input value.bind="email">
        </div>
      `
      const result = compiler.compile(template)

      // One-time: direct assignment (use pattern since variable numbering varies)
      expect(result.code).toMatch(/el_span_\d+\.textContent = this\.title/)
      // To-view: one-way binding
      expect(result.code).toMatch(/DiamondCore\.bind\(el_span_\d+, 'textContent', \(\) => this\.message\)/)
      // From-view, two-way, bind: all have setter
      expect(result.code).toContain('(v) => this.query = v')
      expect(result.code).toContain('(v) => this.name = v')
      expect(result.code).toContain('(v) => this.email = v')
    })

    it('compiles data-*/aria-* outbound bindings as attribute writes', () => {
      const r = compiler.compile(
        '<div data-user-id.set="user.id" aria-label.to-view="labelText"></div>'
      )
      expect(r.code).toContain("el_div_0.setAttribute('data-user-id', this.user.id)")
      expect(r.code).toContain("DiamondCore.bind(el_div_0, 'aria-label', () => this.labelText)")
      // Attribute branch is gate-clean: no stink diagnostics
      expect(r.diagnostics?.some((d) => d.code === 'stink:warn')).toBe(false)
    })

    it('rejects inbound bindings on dashed attribute names', () => {
      const r = compiler.compile('<div data-user-id.two-way="user.id"></div>')
      expect(
        r.diagnostics?.some((d) => d.code === 'attr-binding-outbound-only')
      ).toBe(true)
    })

    it('compiles a counter component', () => {
      const template = `
        <div class="counter">
          <button click.calls="decrement()">-</button>
          <span>\${count}</span>
          <button click.calls="increment()">+</button>
        </div>
      `
      const result = compiler.compile(template)

      expect(result.code).toContain("el_div_0.className = 'counter'")
      expect(result.code).toContain('this.decrement()')
      expect(result.code).toContain('this.increment()')
      expect(result.code).toContain('this.count')
    })
  })
})

describe('CompileError', () => {
  it('includes location in message', () => {
    const error = new CompileError('Test error', { line: 5, column: 10 })
    expect(error.message).toContain('line 5')
    expect(error.message).toContain('column 10')
  })

  it('has name CompileError', () => {
    const error = new CompileError('Test', { line: 1, column: 0 })
    expect(error.name).toBe('CompileError')
  })

  it('exposes location property', () => {
    const error = new CompileError('Test', { line: 3, column: 7 })
    expect(error.location.line).toBe(3)
    expect(error.location.column).toBe(7)
  })
})
