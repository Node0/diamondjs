/**
 * @vitest-environment happy-dom
 *
 * Issue #15 — template text is kept exactly as the HTML parser produces it.
 *
 * The compiler does not collapse, trim or drop content whitespace; static
 * and interpolated text follow the same rule; collapsing is CSS's job at
 * render time. Whitespace consumed as syntax is exactly: (a) between an
 * `if`/`else-if` and the `else-if` after it, only when one follows (#18);
 * (b) directly inside <switch>, between cases; (c) a whitespace-only text
 * node before the first root or after the last root of a template.
 *
 * The lossless property: for every fixture, the text nodes of the mounted
 * DOM equal, character for character, the text nodes of the same markup
 * parsed as plain HTML (directives removed, adjacent text nodes merged).
 * The oracle is parse5 — the compiler's own parser — so the comparison
 * measures the compiler, not two HTML parsers against each other.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { DiamondCompiler } from '../compiler'
import { TemplateParser } from '../parser'
import { isTextInfo } from '../types'
import { Component, DiamondCore } from '@diamondjs/runtime'

type P5Node = DefaultTreeAdapterMap['node']

const compiler = new DiamondCompiler()
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** Compile → evaluate (a SyntaxError here means the emitted code does not parse) → mount. */
function mount<S extends object>(template: string, state: S = {} as S) {
  const { code, diagnostics } = compiler.compile(template)
  expect(diagnostics?.filter((d) => d.severity === 'error')).toEqual([])
  const factory = new Function(
    'Component',
    'DiamondCore',
    `return class Compiled extends Component {\n${code}\n}`
  ) as (C: typeof Component, D: typeof DiamondCore) => new () => Component & { state: S }
  const instance = new (factory(Component, DiamondCore))()
  instance.state = DiamondCore.reactive(state)
  const host = document.createElement('div')
  document.body.appendChild(host)
  instance.mount(host)
  return { host, state: instance.state, code }
}

/**
 * The text nodes under `node`, in document order, with adjacent text nodes
 * merged. Comment nodes (the structurals' anchors) are transparent: text on
 * both sides of one merges, as it would once the comment were removed.
 */
function domText(node: Node): string[] {
  const out: string[] = []
  let run: string | null = null
  const flush = () => {
    if (run !== null) out.push(run)
    run = null
  }
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) run = (run ?? '') + (child as Text).data
    else if (child.nodeType === 8) continue
    else {
      flush()
      out.push(...domText(child))
    }
  }
  flush()
  return out
}

/** The same walk over a parse5 fragment of plain HTML. */
function plainText(html: string): string[] {
  const walk = (nodes: P5Node[]): string[] => {
    const out: string[] = []
    let run: string | null = null
    const flush = () => {
      if (run !== null) out.push(run)
      run = null
    }
    for (const n of nodes) {
      if (n.nodeName === '#text') run = (run ?? '') + (n as DefaultTreeAdapterMap['textNode']).value
      else if (n.nodeName === '#comment') continue
      else if ('childNodes' in n) {
        flush()
        out.push(...walk((n as DefaultTreeAdapterMap['element']).childNodes))
      }
    }
    flush()
    return out
  }
  return walk(parseFragment(html).childNodes)
}

/** Remove DiamondJS directive attributes so a template reads as plain HTML. */
const stripDirectives = (template: string): string =>
  template.replace(/\s+(?:if|else-if|repeat\.for)="[^"]*"/g, '')

const inlineBlock = `<div class="toolbar">
  <button>Save</button>
  <button>Cancel</button>
</div>`

/**
 * Fixtures whose plain-HTML form is the template with its directives removed
 * (no structural changes the state): [name, template, state].
 */
const SAME_SHAPE: Array<[string, string]> = [
  ['the issue: prose with an inline element', '<p>Set up a prompt and press <em>Start job</em> on the Prompt tab.</p>'],
  ['the issue: two spans separated by a space', '<h2><span class="lbl">Instructions</span> <span class="muted">(system prompt)</span></h2>'],
  ['inline elements on separate lines (Prettier)', '<p>\n  <span>A</span>\n  <span>B</span>\n</p>'],
  ['a wrapped paragraph (Prettier)', '<p>\n  Lorem ipsum dolor sit amet, <a href="/x">consectetur</a>\n  adipiscing elit, sed do <code>eiusmod</code> tempor.\n</p>'],
  ['indented block children', '<section>\n  <h1>Title</h1>\n  <p>Body</p>\n</section>'],
  ['indented inline-block siblings gain the HTML gap', inlineBlock],
  ['nested inline with a leading space in the inner element', '<p><b>Hello</b><i> <u>world</u></i></p>'],
  ['punctuation adjacency and split words', '<p>un<em>break</em>able — <strong>Stop</strong>!</p>'],
  ['NBSP is content: a table cell', '<table><tr><td>&nbsp;</td></tr></table>'],
  ['NBSP at the edges of a text run', '<p>&nbsp;indented&nbsp;</p>'],
  ['NBSP between inline elements', '<p><b>A</b>&nbsp;<b>B</b></p>'],
  ['tabs and runs of spaces', '<p>\tcol1\t\tcol2   end  </p>'],
  ['pre keeps its interior verbatim', '<pre>\n  line 1\n    line 2\n</pre>'],
  ['textarea keeps its content', '<textarea>\n  hello\n   world\n</textarea>'],
  ['a comment between text runs', '<p>before <!-- note --> after</p>'],
  ['thin and narrow spaces', '<p>A B C</p>'],
]

describe('#15 — the lossless property', () => {
  it.each(SAME_SHAPE)('%s', (_name, template) => {
    const { host } = mount(template)
    expect(domText(host)).toEqual(plainText(stripDirectives(template)))
  })

  it('whitespace around a template root is syntax (c): no stray roots', () => {
    const { host } = mount('\n  <p>Hi</p>\n')
    expect(host.childNodes.length).toBe(1)
    expect(host.innerHTML).toBe('<p>Hi</p>')
  })

  it('a text-only template keeps its own edges', () => {
    const { host } = mount('\n  Hello\n')
    expect(domText(host)).toEqual(['\n  Hello\n'])
  })

  it('static and interpolated text follow one rule', async () => {
    const { host, state } = mount('<p>Press ${state.verb} <em>now</em> on the tab.</p>', { verb: 'Start' })
    expect(domText(host)).toEqual(plainText('<p>Press Start <em>now</em> on the tab.</p>'))
    state.verb = 'Stop'
    await tick()
    expect(domText(host)).toEqual(plainText('<p>Press Stop <em>now</em> on the tab.</p>'))
  })

  it('a literal \\${ under preserved whitespace', () => {
    const { host } = mount('<p>\n  \\${x} and ${state.y}\n</p>', { y: 'Y' })
    expect(domText(host)).toEqual(['\n  ${x} and Y\n'])
  })
})

describe('#15 — structurals: whitespace around a removed element is content', () => {
  it('if true → false → true keeps the spaces on both sides', async () => {
    const { host, state } = mount('<p>Hello <b if="state.show">there</b> world</p>', { show: true })
    expect(domText(host)).toEqual(plainText('<p>Hello <b>there</b> world</p>'))
    state.show = false
    await tick()
    expect(domText(host)).toEqual(plainText('<p>Hello  world</p>'))
    state.show = true
    await tick()
    expect(domText(host)).toEqual(plainText('<p>Hello <b>there</b> world</p>'))
  })

  it('a space before a conditional block survives the false branch', async () => {
    const { host } = mount('<section>Hello <div if="state.aside">Aside</div>world</section>', { aside: false })
    expect(domText(host)).toEqual(plainText('<section>Hello world</section>'))
  })

  it('whitespace between an if and its else-if is syntax; after the chain it is content', () => {
    const { host, state } = mount('<div><p if="state.a">A</p>\n<p else-if="state.b">B</p>\n<i>tail</i></div>', { a: true, b: false })
    void state
    expect(host.firstElementChild!.innerHTML).toBe('<p>A</p><!--if-->\n<i>tail</i>')
  })

  it('repeat: a separator inside the repeated element repeats; outside it appears once', () => {
    const inside = mount('<p><em repeat.for="i of state.items">${i} </em></p>', { items: ['a', 'b'] })
    expect(domText(inside.host)).toEqual(plainText('<p><em>a </em><em>b </em></p>'))
    const outside = mount('<p><em repeat.for="i of state.items">${i}</em> </p>', { items: ['a', 'b'] })
    expect(domText(outside.host)).toEqual(plainText('<p><em>a</em><em>b</em> </p>'))
  })

  it('whitespace directly inside <switch> is syntax (b); a case body is content, multi-root included', async () => {
    const { host, state } = mount(
      '<div>\n  <switch on="state.k">\n    <case if="one">\n      <b>A</b>\n      <i>B</i>\n    </case>\n    <case if="two"><u>C</u></case>\n  </switch>\n</div>',
      { k: 'one' }
    )
    const div = host.firstElementChild!
    expect(domText(div)).toEqual(plainText('<div>\n  \n      <b>A</b>\n      <i>B</i>\n    \n</div>'))
    state.k = 'two'
    await tick()
    expect(div.innerHTML).toBe('\n  <u>C</u><!--switch-->\n')
  })
})

describe('#15 — emitted shape', () => {
  it('static text is a string argument of the parent\'s single append(); no createTextNode', () => {
    const { code } = compiler.compile('<p>Set up and press <em>Start</em> now.</p>')
    expect(code).not.toContain('createTextNode')
    expect(code).toContain("el_p_0.append('Set up and press ', el_em_1, ' now.');")
  })

  it('only interpolated text keeps a named createTextNode, and it is one line', () => {
    const { code } = compiler.compile('<p>\n  Hello ${name},\n  welcome\n</p>')
    const bind = code.split('\n').filter((l) => l.includes("'textContent'"))
    expect(bind).toHaveLength(1)
    expect(bind[0]).toContain('`\\n  Hello ${this.name},\\n  welcome\\n`')
    expect(code).toContain("document.createTextNode('')")
  })

  it('a text-only single root stays a createTextNode', () => {
    const { code } = compiler.compile('Hello')
    expect(code).toContain("const root = document.createTextNode('Hello');")
    expect(code).toContain('return root;')
  })

  it('a multi-root template appends strings and elements into one fragment', () => {
    const { code } = compiler.compile('Hi <b>there</b>!')
    expect(code).toContain("root.append('Hi ', el_b_0, '!');")
  })

  it('a case body that begins with whitespace then a structural needs no <!----> marker; one that begins with the structural keeps it', () => {
    // (The switch sits in a <div>: a template whose root IS a structural gets the
    // component-level marker regardless, §5.4.4.)
    const ws = mount('<div><switch on="state.k"><case if="a">\n  <b if="state.on">x</b>\n</case></switch></div>', { k: 'a', on: true })
    expect(ws.host.firstElementChild!.innerHTML).toBe('\n  <b>x</b><!--if-->\n<!--switch-->')
    const bare = mount('<div><switch on="state.k"><case if="a"><b if="state.on">x</b></case></switch></div>', { k: 'a', on: true })
    expect(bare.host.firstElementChild!.innerHTML).toBe('<!----><b>x</b><!--if--><!--switch-->')
  })
})

describe('#15 — parser', () => {
  const parser = new TemplateParser()

  it('keeps whitespace-only text nodes, NBSP-only ones included', () => {
    const nodes = parser.parse('<div>   </div><td>&nbsp;</td>')
    const children = (nodes[0] as { children: unknown[] }).children
    expect(children).toHaveLength(1)
    expect(isTextInfo(children[0] as never) && (children[0] as { content: string }).content).toBe('   ')
  })

  it('drops a whitespace-only root before the first and after the last root, nothing else', () => {
    const nodes = parser.parse('\n  <p>a</p>\n  <p>b</p>\n')
    expect(nodes.map((n) => (isTextInfo(n) ? JSON.stringify(n.content) : n.tagName))).toEqual(['p', '"\\n  "', 'p'])
  })
})

describe('#15 — the example template', () => {
  it('Tasks.diamond.html round-trips every character', () => {
    const src = readFileSync(resolve(__dirname, '../../../../examples/hello-world/src/Tasks.diamond.html'), 'utf-8')
    const { code } = compiler.compile(src)
    expect(code).not.toMatch(/createTextNode\('[^']/) // every static string rides in an append()
    // Every static text node of the parse is present verbatim in the emitted code.
    const parser = new TemplateParser()
    const texts: string[] = []
    const walk = (nodes: ReturnType<TemplateParser['parse']>): void => {
      for (const n of nodes) {
        if (isTextInfo(n)) {
          if (n.interpolations.length === 0) texts.push(n.content)
        } else {
          walk(n.children)
          for (const c of n.switchInfo?.cases ?? []) walk(c.children)
          if (n.switchInfo?.defaultChildren) walk(n.switchInfo.defaultChildren)
        }
      }
    }
    walk(parser.parse(src))
    expect(texts.length).toBeGreaterThan(10)
    for (const t of texts) expect(code).toContain(JSON.stringify(t).slice(1, -1).replace(/\\"/g, '"'))
  })
})
