/**
 * @vitest-environment happy-dom
 *
 * Issue #9 — <select value.two-way> was bound before its <option> children
 * existed. bind()'s first pass runs synchronously, and assigning `.value` to
 * an option-less select is a no-op, so the initial model value was lost: the
 * select showed its first option until the model changed again. The generator
 * now emits a <select>'s bindings (and handlers) after its children — including
 * repeat.for-generated options, whose structural call is wired first.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'
import { Component, DiamondCore } from '@diamondjs/runtime'

const compiler = new DiamondCompiler()

function componentFrom(template: string, fields: Record<string, unknown>): Component {
  const { code, diagnostics } = compiler.compile(template)
  expect(diagnostics?.filter((d) => d.severity === 'error')).toEqual([])
  const factory = new Function(
    'Component',
    'DiamondCore',
    `return class Compiled extends Component {\n${code}\n}`
  ) as (C: typeof Component, D: typeof DiamondCore) => new () => Component
  const Compiled = factory(Component, DiamondCore)
  const instance = new Compiled()
  Object.assign(instance, fields)
  return instance
}

const idx = (code: string, needle: string): number => {
  const i = code.indexOf(needle)
  expect(i, `expected output to contain ${JSON.stringify(needle)}`).toBeGreaterThan(-1)
  return i
}

const SELECT = `<select value.two-way="choice" change.calls="pick()">
  <option value="a">A</option>
  <option value="b">B</option>
</select>`

describe('generator: <select> wiring follows its children', () => {
  it('emits the value binding after the option appends', () => {
    const { code } = compiler.compile(SELECT)
    // #15: one append per parent, children in DOM order, indentation included.
    const append = idx(code, "el_select_0.append('\\n  ', el_option_1, '\\n  ', el_option_2, '\\n');")
    expect(idx(code, `DiamondCore.bind(el_select_0, 'value'`)).toBeGreaterThan(append)
    expect(idx(code, `DiamondCore.on(el_select_0, 'change'`)).toBeGreaterThan(append)
    expect(code).toContain('// [Diamond] <select> wiring follows its <option> children')
  })

  it('emits the value binding after a repeat.for-generated option list is wired', () => {
    const { code } = compiler.compile(
      '<select value.two-way="model"><option repeat.for="m of models" value.to-view="m">${m}</option></select>'
    )
    const anchor = /const (repeatAnchor_\d+) = document\.createComment\('repeat'\)/.exec(code)![1]
    const repeatCall = idx(code, `DiamondCore.repeat(${anchor}, `)
    expect(idx(code, `el_select_0.append(${anchor});`)).toBeLessThan(repeatCall)
    expect(idx(code, `DiamondCore.bind(el_select_0, 'value'`)).toBeGreaterThan(repeatCall)
  })

  it('leaves other elements unchanged: bindings still precede children', () => {
    const { code } = compiler.compile('<div classname.to-view="cls"><span>x</span></div>')
    expect(idx(code, `DiamondCore.bind(el_div_0, 'className'`)).toBeLessThan(
      idx(code, 'el_div_0.append(el_span_1);')
    )
    expect(code).not.toContain('<select> wiring')
  })

  it('emits no wiring hint for a <select> with nothing to wire', () => {
    const { code } = compiler.compile('<select><option value="a">A</option></select>')
    expect(code).not.toContain('<select> wiring')
  })
})

describe('end-to-end: the initial model value selects the matching option', () => {
  it('static options: choice = "b" renders with B selected', () => {
    const c = componentFrom(SELECT, { choice: 'b', pick: () => {} })
    const host = document.createElement('div')
    c.mount(host)
    const select = host.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('b')
    c.unmount()
  })

  it('repeat.for options populated before mount: model = "vllm" renders selected', () => {
    const c = componentFrom(
      '<select value.two-way="model"><option repeat.for="m of models" value.to-view="m">${m}</option></select>',
      { model: 'vllm', models: ['ollama', 'vllm', 'llamacpp'] }
    )
    const host = document.createElement('div')
    c.mount(host)
    const select = host.querySelector('select') as HTMLSelectElement
    expect(select.options.length).toBe(3)
    expect(select.value).toBe('vllm')
    c.unmount()
  })

  it('two-way still flows DOM → model after mount', () => {
    const c = componentFrom(SELECT, { choice: 'a', pick: () => {} }) as Component & {
      choice: string
    }
    const host = document.createElement('div')
    c.mount(host)
    const select = host.querySelector('select') as HTMLSelectElement
    select.value = 'b'
    select.dispatchEvent(new Event('change'))
    expect(c.choice).toBe('b')
    c.unmount()
  })
})
