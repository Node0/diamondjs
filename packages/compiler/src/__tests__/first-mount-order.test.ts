/**
 * @vitest-environment happy-dom
 *
 * Issue #7 — structural directives must render on first mount.
 *
 * The generator used to emit the DiamondCore.if/switch/repeat call BEFORE the
 * parent appended the anchor; the runtime's first pass then found a detached
 * anchor and the branch appeared only on the next condition change. The
 * generator now emits: create anchor → append anchor → wire the directive.
 * The end-to-end tests compile a template, evaluate the generated method on
 * a real Component and mount it — the first render must be SYNCHRONOUS for
 * every nested structural (no microtask needed).
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'
import { Component, DiamondCore } from '@diamondjs/runtime'

const compiler = new DiamondCompiler()

/** Build a Component subclass whose createTemplate() is the compiled output. */
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

const before = (code: string, a: string, b: string): boolean =>
  code.indexOf(a) !== -1 && code.indexOf(b) !== -1 && code.indexOf(a) < code.indexOf(b)

describe('generator: anchors are appended before the structural call', () => {
  it('if: appendChild(anchor) precedes DiamondCore.if(anchor', () => {
    const { code } = compiler.compile('<div><p if="ready">on</p></div>')
    const anchor = /const (ifAnchor_\d+) = document\.createComment\('if'\)/.exec(code)![1]
    expect(before(code, `el_div_0.appendChild(${anchor});`, `DiamondCore.if(${anchor}, [`)).toBe(
      true
    )
  })

  it('repeat: appendChild(anchor) precedes DiamondCore.repeat(anchor', () => {
    const { code } = compiler.compile('<ul><li repeat.for="u of users">${u}</li></ul>')
    const anchor = /const (repeatAnchor_\d+) = document\.createComment\('repeat'\)/.exec(code)![1]
    expect(
      before(code, `el_ul_0.appendChild(${anchor});`, `DiamondCore.repeat(${anchor}, `)
    ).toBe(true)
  })

  it('switch: appendChild(anchor) precedes DiamondCore.switch(anchor', () => {
    const { code } = compiler.compile(
      '<div><switch on="status"><case if="\'a\'"><i>A</i></case><default><b>D</b></default></switch></div>'
    )
    const anchor = /const (switchAnchor_\d+) = document\.createComment\('switch'\)/.exec(code)![1]
    expect(
      before(code, `el_div_0.appendChild(${anchor});`, `DiamondCore.switch(${anchor}, `)
    ).toBe(true)
  })

  it('multi-root template: the fragment appends the anchor before the call', () => {
    const { code } = compiler.compile('<p if="a">A</p><span>tail</span>')
    const anchor = /const (ifAnchor_\d+) = document\.createComment\('if'\)/.exec(code)![1]
    expect(before(code, `root.appendChild(${anchor});`, `DiamondCore.if(${anchor}, [`)).toBe(true)
  })

  it('siblings following a structural are appended in source order', () => {
    const { code } = compiler.compile('<div><p if="a">A</p><span>after</span></div>')
    const anchor = /const (ifAnchor_\d+) = document\.createComment\('if'\)/.exec(code)![1]
    const spanVar = /const (el_span_\d+) = document\.createElement\('span'\)/.exec(code)![1]
    expect(
      before(code, `el_div_0.appendChild(${anchor});`, `el_div_0.appendChild(${spanVar});`)
    ).toBe(true)
  })

  it('a loop variable stays in scope for structurals nested inside a repeat body', () => {
    const { code } = compiler.compile(
      '<ul><li repeat.for="g of groups"><span repeat.for="m of g.members">${m}</span><i if="g.open">open</i></li></ul>'
    )
    expect(code).toContain('() => g.members')
    expect(code).toContain('when: () => g.open')
    expect(code).not.toContain('this.g.')
    expect(code).not.toContain('this.m')
  })
})

describe('end-to-end: compiled structurals render synchronously on mount', () => {
  it('if="ready" inside a section renders on mount (the blank-page case)', () => {
    const c = componentFrom('<section><div if="ready">READY</div></section>', {
      ready: true,
    })
    const host = document.createElement('div')
    c.mount(host)
    expect(host.innerHTML).toBe('<section><div>READY</div><!--if--></section>')
    c.unmount()
  })

  it('repeat.for over a pre-populated list renders every row on mount', () => {
    const c = componentFrom('<ul><li repeat.for="u of users">${u}</li></ul>', {
      users: ['ann', 'bob'],
    })
    const host = document.createElement('div')
    c.mount(host)
    expect(Array.from(host.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'ann',
      'bob',
    ])
    c.unmount()
  })

  it('switch renders the matching case on mount', () => {
    const c = componentFrom(
      '<div><switch on="status"><case if="\'ready\'"><b>R</b></case><default><i>D</i></default></switch></div>',
      { status: 'ready' }
    )
    const host = document.createElement('div')
    c.mount(host)
    expect(host.querySelector('b')?.textContent).toBe('R')
    c.unmount()
  })

  it('nested: an if inside a repeat row renders on mount', () => {
    const c = componentFrom(
      '<ul><li repeat.for="r of rows"><em if="r.on">on</em>${r.id}</li></ul>',
      { rows: [{ id: 1, on: true }, { id: 2, on: false }] }
    )
    const host = document.createElement('div')
    c.mount(host)
    const lis = Array.from(host.querySelectorAll('li'))
    expect(lis).toHaveLength(2)
    expect(lis[0].querySelector('em')?.textContent).toBe('on')
    expect(lis[1].querySelector('em')).toBeNull()
    c.unmount()
  })

  it('a structural at the template ROOT renders after one microtask (runtime guard)', async () => {
    const c = componentFrom('<div if="ready">ROOT</div>', { ready: true })
    const host = document.createElement('div')
    c.mount(host)
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(host.innerHTML).toBe('<div>ROOT</div><!--if-->')
    c.unmount()
  })
})
