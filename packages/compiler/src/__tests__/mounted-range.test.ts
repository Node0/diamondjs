/**
 * @vitest-environment happy-dom
 *
 * Issue #17 — multi-root bodies, end to end.
 *
 * combineRoots() mounts a body with 2+ roots as a DocumentFragment, which is
 * empty once inserted. These tests compile the issue's templates, mount the
 * generated method on a real Component, and drive the switch / unmount paths
 * that used to call .remove() on the spent fragment.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DiamondCompiler } from '../compiler'
import { Component, DiamondCore } from '@diamondjs/runtime'

const compiler = new DiamondCompiler()
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** Build a Component whose createTemplate() is the compiled output, over reactive `state`. */
function componentFrom<S extends object>(template: string, state: S): Component & { state: S } {
  const { code, diagnostics } = compiler.compile(template)
  expect(diagnostics?.filter((d) => d.severity === 'error')).toEqual([])
  const factory = new Function(
    'Component',
    'DiamondCore',
    `return class Compiled extends Component {\n${code}\n}`
  ) as (C: typeof Component, D: typeof DiamondCore) => new () => Component & { state: S }
  const instance = new (factory(Component, DiamondCore))()
  instance.state = DiamondCore.reactive(state)
  return instance
}

function mounted<S extends object>(template: string, state: S) {
  const c = componentFrom(template, state)
  const host = document.createElement('main')
  c.mount(host)
  return { c, host, state: c.state }
}

const errors = vi.spyOn(console, 'error')
afterEach(() => errors.mockClear())

describe('compiled <switch>: multi-root bodies (#17)', () => {
  it('the issue repro: a two-root case is replaced on switch-away and rebuilt on switch-back', async () => {
    const { host, state } = mounted(
      '<div><switch on="state.mode"><case if="a"><b>A1</b><b>A2</b></case><case if="b"><i>B</i></case></switch></div>',
      { mode: 'a' }
    )
    expect(host.innerHTML).toBe('<div><b>A1</b><b>A2</b><!--switch--></div>')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<div><i>B</i><!--switch--></div>')
    expect(errors).not.toHaveBeenCalled()

    state.mode = 'a'
    await tick()
    expect(host.innerHTML).toBe('<div><b>A1</b><b>A2</b><!--switch--></div>')
    expect(errors).not.toHaveBeenCalled()
  })

  it('a two-root <default> behaves the same way', async () => {
    const { host, state } = mounted(
      '<div><switch on="state.mode"><case if="a"><i>A</i></case><default><b>D1</b><b>D2</b></default></switch></div>',
      { mode: 'zzz' }
    )
    expect(host.innerHTML).toBe('<div><b>D1</b><b>D2</b><!--switch--></div>')

    state.mode = 'a'
    await tick()
    expect(host.innerHTML).toBe('<div><i>A</i><!--switch--></div>')
    expect(errors).not.toHaveBeenCalled()

    state.mode = 'zzz'
    await tick()
    expect(host.innerHTML).toBe('<div><b>D1</b><b>D2</b><!--switch--></div>')
  })

})

describe('compiled <switch>: bodies holding nested structurals (#17)', () => {
  it('a case body with an if and a repeat that inserted nodes is fully removed', async () => {
    const { host, state } = mounted(
      '<div><switch on="state.mode"><case if="a">' +
        '<p if="state.show">X</p><b>mid</b><li repeat.for="u of state.users">${u}</li>' +
        '</case><case if="b"><i>B</i></case></switch></div>',
      { mode: 'a', show: false, users: ['ann'] }
    )
    state.show = true // both structurals insert AFTER the body was mounted
    state.users = ['ann', 'bob']
    await tick()
    expect(host.textContent).toBe('Xmidannbob')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<div><i>B</i><!--switch--></div>')
    expect(errors).not.toHaveBeenCalled()
  })

  it('a case body that begins with an if rendered at mount, then replaced, is fully removed', async () => {
    const { host, state } = mounted(
      '<div><switch on="state.mode"><case if="a"><p if="state.show">X</p><b>tail</b></case>' +
        '<case if="b"><i>B</i></case></switch></div>',
      { mode: 'a', show: true }
    )
    expect(host.textContent).toBe('Xtail')
    state.show = false
    await tick()
    state.show = true // a new <p>; the one mounted first is detached
    await tick()
    expect(host.textContent).toBe('Xtail')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<div><i>B</i><!--switch--></div>')
    expect(errors).not.toHaveBeenCalled()
  })

  it('a case body that is only an if is fully removed', async () => {
    const { host, state } = mounted(
      '<div><switch on="state.mode"><case if="a"><p if="state.show">X</p></case><case if="b"><i>B</i></case></switch></div>',
      { mode: 'a', show: true }
    )
    await tick()
    expect(host.textContent).toBe('X')

    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<div><i>B</i><!--switch--></div>')
  })

})

describe('compiled <switch>: mounted output shape (#17)', () => {
  it('empty-case and dead-switch placeholders mount without a start marker', async () => {
    const { host, state } = mounted(
      '<div><switch on="state.mode"><case if="a"></case>' +
        '<case if="b"><switch on="\'x\'"><case if="\'y\'"><b>never</b></case></switch></case>' +
        '<case if="c"><i>C</i></case></switch></div>',
      { mode: 'a' }
    )
    expect(host.innerHTML).toBe('<div><!--empty--><!--switch--></div>')

    state.mode = 'b'
    await tick()
    expect(host.querySelector('div')!.childNodes).toHaveLength(2) // dead-switch comment + anchor
    expect(host.innerHTML).not.toContain('<!---->')

    state.mode = 'c'
    await tick()
    expect(host.innerHTML).toBe('<div><i>C</i><!--switch--></div>')
  })

  it('single-root output is unchanged: no marker nodes are emitted or mounted', async () => {
    const template =
      '<div><switch on="state.mode"><case if="a"><b>A</b></case><case if="b"><i>B</i></case></switch></div>'
    expect(compiler.compile(template).code).not.toContain('createDocumentFragment')
    const { host, state } = mounted(template, { mode: 'a' })
    expect(host.innerHTML).toBe('<div><b>A</b><!--switch--></div>')
    state.mode = 'b'
    await tick()
    expect(host.innerHTML).toBe('<div><i>B</i><!--switch--></div>')
  })
})

describe('compiled multi-root component (#17)', () => {
  it('mount then unmount leaves the host empty, and the component can remount', () => {
    const { c, host } = mounted('<h1>Title</h1><p>Body</p>', {})
    expect(host.innerHTML).toBe('<h1>Title</h1><p>Body</p>')

    expect(() => c.unmount()).not.toThrow()
    expect(host.innerHTML).toBe('')

    c.mount(host)
    expect(host.innerHTML).toBe('<h1>Title</h1><p>Body</p>')
    c.unmount()
    expect(host.innerHTML).toBe('')
  })

  it('stops bindings updating after unmount', async () => {
    const { c, host, state } = mounted('<h1>${state.title}</h1><p>Body</p>', { title: 'one' })
    const h1 = host.querySelector('h1')!
    expect(h1.textContent).toBe('one')

    c.unmount()
    state.title = 'two'
    await tick()
    expect(h1.textContent).toBe('one')
    expect(host.innerHTML).toBe('')
    expect(errors).not.toHaveBeenCalled()
  })

  it('a root-level if followed by a sibling is fully removed on unmount', async () => {
    const { c, host } = mounted('<p if="state.a">A</p><span>tail</span>', { a: true })
    await tick()
    expect(host.textContent).toBe('Atail')

    c.unmount()
    expect(host.innerHTML).toBe('')
  })
})
