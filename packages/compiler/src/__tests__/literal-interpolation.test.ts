/**
 * @vitest-environment happy-dom
 *
 * Issue #29 — two spellings for a literal `${`.
 *
 *  1. An encoded character is never syntax: interpolation is recognized only
 *     where the RAW source contains `$` followed by `{`.
 *  2. `\${` is a literal `${`. A run of backslashes directly before `${` reads
 *     by the JS rule (pairs collapse, an odd one escapes); a backslash
 *     anywhere else is text (#19 stands).
 *
 * Sources below are ordinary single-quoted JS strings, so `\\` is ONE
 * backslash in the template and `${` is never a JS substitution.
 */
import { describe, it, expect } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { DiamondCompiler } from '../compiler'
import { TemplateParser } from '../parser'
import { scanInterpolations, interpolationParts } from '../pipe'
import { rawTextSpan, rawAttributeValue, decodeText, decodeAttributeValue } from '../raw-source'
import { isElementInfo, isTextInfo, type NodeInfo } from '../types'
import { Component, DiamondCore } from '@diamondjs/runtime'

type P5Element = DefaultTreeAdapterMap['element']
type P5Text = DefaultTreeAdapterMap['textNode']
type P5Node = DefaultTreeAdapterMap['node']

const compiler = new DiamondCompiler()

/** Compile → evaluate (a SyntaxError here means the emitted code does not parse) → mount. */
function mount(template: string, fields: Record<string, unknown> = {}): HTMLElement {
  const { code, diagnostics } = compiler.compile(template)
  expect(diagnostics?.filter((d) => d.severity === 'error')).toEqual([])
  const factory = new Function(
    'Component',
    'DiamondCore',
    `return class Compiled extends Component {\n${code}\n}`
  ) as (C: typeof Component, D: typeof DiamondCore) => new () => Component
  const instance = new (factory(Component, DiamondCore))()
  Object.assign(instance, fields)
  const host = document.createElement('div')
  instance.mount(host)
  return host
}

const diagnosticsOf = (template: string) => compiler.compile(template).diagnostics ?? []
const codesOf = (template: string): string[] => diagnosticsOf(template).map((d) => d.code)

/** [template source, what it renders with name = 'Joe'] — the decision table, plus the encoded backslash. */
const ROWS: Array<[source: string, rendered: string]> = [
  ['${name}', 'Joe'],
  ['\\${name}', '${name}'],
  ['\\\\${name}', '\\Joe'],
  ['\\\\\\${name}', '\\${name}'],
  ['C:\\temp\\notes', 'C:\\temp\\notes'],
  ['a\\\\b', 'a\\\\b'],
  ['&#36;{name}', '${name}'],
  ['&#92;${name}', '\\Joe'], // an encoded backslash is never an escape
]

const ENTITY_SPELLINGS = [
  '&#36;{name}',
  '&#x24;{name}',
  '&dollar;{name}',
  '$&#123;name}',
  '$&lbrace;name}',
]

describe('the decision table', () => {
  it.each(ROWS)('text: %s', (source, rendered) => {
    expect(mount(`<p>${source}</p>`, { name: 'Joe' }).textContent).toBe(rendered)
  })

  it.each(ROWS)('attribute: %s', (source, rendered) => {
    const template = `<p title="${source}">x</p>`
    if (rendered.includes('Joe')) {
      // A real `${` in an attribute is still the D-3 error.
      expect(codesOf(template)).toContain('attr-interpolation-unsupported')
    } else {
      expect(mount(template).querySelector('p')!.getAttribute('title')).toBe(rendered)
    }
  })

  it.each(ENTITY_SPELLINGS)('entity spelling in text: %s', (source) => {
    expect(mount(`<p>${source}</p>`, { name: 'Joe' }).textContent).toBe('${name}')
    expect(codesOf(`<p>${source}</p>`)).toEqual([])
  })

  it.each(ENTITY_SPELLINGS)('entity spelling in an attribute: %s', (source) => {
    const template = `<input placeholder="e.g. ${source}">`
    expect(mount(template).querySelector('input')!.getAttribute('placeholder')).toBe(
      'e.g. ${name}'
    )
    expect(codesOf(template)).toEqual([])
  })

  it('mixed: an escaped ${ and a real one in the same text', () => {
    expect(mount('<p>\\${a} ${b}</p>', { a: 'A', b: 'B' }).textContent).toBe('${a} B')
  })

  it('context-free: the escape works against any neighbour', () => {
    expect(mount('<p>`\\${x}` "\\${x}" (\\${x})\\${x}</p>').textContent).toBe(
      '`${x}` "${x}" (${x})${x}'
    )
  })

  it('a Windows path before an interpolation: \\${ is literal, \\\\${ is the path', () => {
    expect(mount('<p>C:\\Users\\${user}</p>', { user: 'joe' }).textContent).toBe(
      'C:\\Users${user}'
    )
    expect(mount('<p>C:\\Users\\\\${user}</p>', { user: 'joe' }).textContent).toBe(
      'C:\\Users\\joe'
    )
  })
})

describe('structural bodies', () => {
  it('inside an if / else-if chain', () => {
    const template =
      '<div><p if="on">\\${x} ${name}</p> <p else-if="alt">alt \\${y}</p></div>'
    expect(mount(template, { on: true, alt: false, name: 'Joe' }).textContent).toBe('${x} Joe')
    expect(mount(template, { on: false, alt: true, name: 'Joe' }).textContent).toBe('alt ${y}')
  })

  it('inside a repeat.for body', () => {
    const host = mount('<ul><li repeat.for="u of users">\\${u} is ${u};</li></ul>', {
      users: ['a', 'b'],
    })
    expect(host.textContent).toBe('${u} is a;${u} is b;')
  })
})

describe('only raw syntax is syntax; pieces are then decoded', () => {
  const textParts = (template: string) => {
    const parser = new TemplateParser()
    const node = (parser.parse(template)[0] as { children: NodeInfo[] }).children[0]
    return { parts: isTextInfo(node) ? node.parts : undefined, diagnostics: parser.diagnostics }
  }

  it('an expression body is entity-decoded', () => {
    expect(mount('<p>${a &lt; b}</p>', { a: 1, b: 2 }).textContent).toBe('true')
    expect(textParts('<p>${a &lt; b}</p>').parts).toEqual([
      { kind: 'expression', expression: 'a < b' },
    ])
  })

  it('an encoded } never closes an interpolation', () => {
    expect(textParts('<p>${a &#125; b} tail</p>').parts).toEqual([
      { kind: 'expression', expression: 'a } b' },
      { kind: 'text', value: ' tail' },
    ])
    const open = textParts('<p>${a &#125; tail</p>')
    expect(open.diagnostics.map((d) => d.code)).toEqual(['unterminated-interpolation'])
  })

  it('static pieces around interpolations are decoded in place', () => {
    expect(textParts('<p>a &amp; \\${b} &lt; ${c} &copy d</p>').parts).toEqual([
      { kind: 'text', value: 'a & ${b} < ' },
      { kind: 'expression', expression: 'c' },
      { kind: 'text', value: ' \u00a9 d' },
    ])
  })

  it('byte level: \\${x} is the text ${x}, and the emitted JS parses', () => {
    const { code } = compiler.compile('<p>\\${x}</p>')
    expect(code).toContain("document.createTextNode('${x}')")
    expect(mount('<p>\\${x}</p>').textContent).toBe('${x}')

    const mixed = compiler.compile('<p>\\${x} ${y}</p>').code
    expect(mixed).toContain('`\\${x} ${this.y}`') // jsTemplatePart re-escapes the literal
    expect(mount('<p>\\${x} ${y}</p>', { y: 'Y' }).textContent).toBe('${x} Y')
  })
})

describe('attributes (D-3 stands for a real ${)', () => {
  it('an unescaped ${ is still an error, with a concat suggestion', () => {
    const [d] = diagnosticsOf('<p title="Hello ${name}!">x</p>')
    expect(d.code).toBe('attr-interpolation-unsupported')
    expect(d.message).toContain(`title.to-view="'Hello ' + name + '!'"`)
  })

  it('the suggestion keeps an escaped ${ as literal text', () => {
    const [d] = diagnosticsOf('<p title="\\${a} ${b}">x</p>')
    expect(d.code).toBe('attr-interpolation-unsupported')
    expect(d.message).toContain(`title.to-view="'\${a} ' + b"`)
  })

  it('an escaped ${ is accepted and noted', () => {
    const template = '<input placeholder="e.g. \\${HOME}">'
    expect(mount(template).querySelector('input')!.getAttribute('placeholder')).toBe(
      'e.g. ${HOME}'
    )
    expect(codesOf(template)).toEqual(['escaped-interpolation'])
  })

  it('single-quoted and unquoted values read the same way', () => {
    expect(
      mount("<p title='say \"\\${x}\"'>x</p>").querySelector('p')!.getAttribute('title')
    ).toBe('say "${x}"')
    expect(mount('<p title=\\${x}>x</p>').querySelector('p')!.getAttribute('title')).toBe('${x}')
  })

  it('attribute-mode decoding: &copy=2 stays literal next to an escape', () => {
    expect(
      mount('<p title="?a&copy=2&amp;b \\${x}">x</p>').querySelector('p')!.getAttribute('title')
    ).toBe('?a&copy=2&b ${x}')
  })

  it('binding expressions are code and are not scanned', () => {
    expect(codesOf('<p title.to-view="`Hi ${name}`" if="`\\${x}` !== name">x</p>')).toEqual([])
  })
})

describe('the escaped-interpolation notice', () => {
  it('is an info diagnostic at the backslash, one per occurrence', () => {
    const found = diagnosticsOf('<h1>t</h1>\n<p>ab \\${x} and \\${y}</p>')
    expect(found.map((d) => [d.severity, d.code])).toEqual([
      ['info', 'escaped-interpolation'],
      ['info', 'escaped-interpolation'],
    ])
    expect(found[0].location).toEqual({ line: 2, column: 7, offset: 17 })
    expect(found[1].location).toEqual({ line: 2, column: 17, offset: 27 })
  })

  it('suggests \\\\${ for the Windows-path case', () => {
    const [d] = diagnosticsOf('<p>C:\\Users\\${user}</p>')
    expect(d.message).toContain("write '\\\\${'")
    expect(d.message).toContain('C:\\Users\\${user}')
  })

  it('is not raised by \\\\${, by entities, or by backslashes elsewhere', () => {
    expect(codesOf('<p>C:\\Users\\\\${user}</p>')).toEqual([])
    expect(codesOf('<p>&#36;{name} C:\\temp a\\\\b</p>')).toEqual([])
  })

  it('never fails a build: info is not an error', () => {
    expect(() => compiler.compile('<p>\\${x}</p>')).not.toThrow()
  })
})

describe('locations are raw-source positions, unmoved by a removed backslash', () => {
  it('nodes after an escape keep their line and column', () => {
    const parser = new TemplateParser()
    const nodes = parser.parse('<p>\\${a} ${b}</p>\n<span title="\\${c}">${d}</span>')
    const [p, , span] = [nodes[0], nodes[1], nodes[nodes.length - 1]]
    expect(isElementInfo(p) && p.children[0].location).toMatchObject({ line: 1, column: 4 })
    expect(isElementInfo(span) && span.location).toMatchObject({ line: 2, column: 1 })
    expect(isElementInfo(span) && span.children[0].location).toMatchObject({
      line: 2,
      column: 21,
    })
  })

  it('the source map still maps the bind line to the text node', () => {
    const plain = compiler.compile('<p>x ${b}</p>', { sourceMap: true, filePath: 'a.html' })
    const escaped = compiler.compile('<p>\\${a} ${b}</p>', { sourceMap: true, filePath: 'a.html' })
    expect(escaped.map).toBeDefined()
    // Same shape of output, same source positions: only the literal text differs.
    expect(JSON.parse(escaped.map!).mappings).toBe(JSON.parse(plain.map!).mappings)
  })
})

describe('scanner', () => {
  it('resolves backslash runs before ${ and leaves other backslashes alone', () => {
    expect(scanInterpolations('a\\b \\${x} \\\\${y} \\\\\\${z}')).toEqual({
      spans: [{ expression: 'y', start: 12, end: 16 }],
      statics: ['a\\b ${x} \\', ' \\${z}'],
      escapes: [4, 19],
    })
  })

  it('an escaped ${ leaves its would-be body as plain text', () => {
    const scan = scanInterpolations('\\${a} } ${b}')
    expect(interpolationParts(scan)).toEqual([
      { kind: 'text', value: '${a} } ' },
      { kind: 'expression', expression: 'b' },
    ])
  })
})

// ── zero-diff property ──────────────────────────────────────────────────────
//
// The raw path must reproduce the HTML parser exactly: reading a node's raw
// span and decoding it gives the value parse5 produced, and decoding the
// pieces around interpolations one by one gives the same text as decoding
// the whole.

function walk(html: string, visit: (node: P5Node) => void): void {
  const descend = (nodes: P5Node[]): void => {
    for (const node of nodes) {
      visit(node)
      if ('childNodes' in node) descend(node.childNodes)
    }
  }
  descend(parseFragment(html, { sourceCodeLocationInfo: true }).childNodes)
}

function expectRawPathMatchesParser(html: string): void {
  walk(html, (node) => {
    if (node.nodeName === '#text') {
      const text = node as P5Text
      const span = rawTextSpan(html, text)!
      expect(decodeText(span.text, text.parentNode), `text in ${JSON.stringify(html)}`).toBe(
        text.value
      )
      // Split at interpolations, decode each piece, join: same text. (A
      // backslash run before `${` is rewritten by design, so those are skipped.)
      const scan = scanInterpolations(span.text)
      if (!span.text.includes('\\${')) {
        const decode = (piece: string) => decodeText(piece, text.parentNode)
        let joined = decode(scan.statics[0])
        scan.spans.forEach((found, k) => {
          joined += '${' + decode(found.expression) + (found.unterminated ? '' : '}')
          joined += decode(scan.statics[k + 1])
        })
        expect(joined, `pieces of ${JSON.stringify(html)}`).toBe(text.value)
      }
    } else if ('tagName' in node) {
      const element = node as P5Element
      for (const attr of element.attrs) {
        const raw = rawAttributeValue(html, element, attr.name)!
        expect(decodeAttributeValue(raw), `${attr.name} in ${JSON.stringify(html)}`).toBe(
          attr.value
        )
      }
    }
  })
}

const HAND_CORPUS = [
  '<p>plain text</p>',
  '<p>a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;</p>',
  '<p>legacy &amp b &copy c &not d &notin; e &ampx &copyright</p>',
  '<p>&#36;{name} &#x24;{name} &dollar;{name} $&#123;x} $&lbrace;y}</p>',
  '<p>numeric &#65;&#x42;&#0;&#128; &#xD800; &unknown; &; & alone</p>',
  '<p>line one\r\nline two\rline three\nline four</p>',
  '<p>a < b <3 <= c</p>',
  '<p>a</x>b &amp; c</p>',
  '<p>before<!-- comment -->&amp; after</p>',
  '&copy; root text <b>x</b> &amp; more',
  '<textarea>\r\n&lt;b&gt; <b> &amp; \r\n text</textarea>',
  '<textarea>\n&amp;first</textarea><textarea>&lt;</textarea><textarea>\n\nx</textarea>',
  '<pre>\r\n&amp;x\r\n  y</pre><pre>\n&lt;</pre><pre>&gt; z</pre>',
  '<title>a &amp; <b> &copy t</title>',
  '<style>a &amp; b { c: d }</style>',
  '<table><tr><td>cell &amp; &lt;</td></tr></table>',
  '<svg><title>svg &amp; t</title><text>&lt;t</text></svg>',
  '<select><option>one &amp; two</option></select>',
  '<a title="a &amp; b &copy=2 &copy; &amp=1 &ampx &lt" href="?a=1&amp;b=2&c=3">t</a>',
  `<a data-x='q "z" &quot; &#36;{y} &dollar;' alt=un&amp;q&copy data-e="" hidden>t</a>`,
  '<a title="line one\r\nline two\rthree" data-n = "spaced" data-u = bare&amp;>t</a>',
  // with interpolations: pieces must decode like the whole
  '<p>&amp; ${a} &copy ${ b &lt; c } &lt;</p>',
  '<p>${a}&amp${b}&copy;${c}</p>',
  '<p>x\r\n${a}\r\n&amp; y</p>',
  '<textarea>\n&lt;${a}&gt; <b></textarea>',
  '<pre>\r\n&amp;${a}\r\n</pre>',
  '<title>${t} &amp; <b></title>',
  '<p>open ${a &amp; b</p>',
]

/** Deterministic generator: random sequences of the pieces that stress decoding. */
function generatedCorpus(count: number): string[] {
  let seed = 0x2f6e2b1
  const next = (n: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    return seed % n
  }
  const TEXT_PIECES = [
    'a', ' ', 'b1', '&amp;', '&amp', '&copy', '&copy;', '&not', '&notin;', '&nope;', '&',
    '&#36;', '&#x24;', '&dollar;', '&#123;', '&lbrace;', '&#125;', '&#92;', '&#65', '&#x;',
    '\r\n', '\r', '\n', '\t', '< ', '<3', '=', ';', '{', '}', '$', '\\',
    '${v}', '${ a &lt; b }', "${f('}')}",
  ]
  const WRAPPERS: Array<(body: string) => string> = [
    (body) => `<p>${body}</p>`,
    (body) => `<div><b>x</b>${body}<i>y</i></div>`,
    (body) => `<textarea>${body}</textarea>`,
    (body) => `<textarea>\n${body}</textarea>`,
    (body) => `<pre>\r\n${body}</pre>`,
    (body) => `<title>${body}</title>`,
    (body) => `<a title="${body.replace(/"/g, '')}">t</a>`,
    (body) => `<a title='${body.replace(/'/g, '')}'>t</a>`,
  ]
  const out: string[] = []
  for (let n = 0; n < count; n++) {
    let body = ''
    for (let k = 1 + next(8); k > 0; k--) body += TEXT_PIECES[next(TEXT_PIECES.length)]
    out.push(WRAPPERS[next(WRAPPERS.length)](body))
  }
  return out
}

describe('zero-diff: the raw path reproduces the HTML parser', () => {
  it.each(HAND_CORPUS)('%s', (html) => {
    expectRawPathMatchesParser(html)
  })

  it('a generated corpus of entities, legacy entities, newlines and interpolations', () => {
    for (const html of generatedCorpus(1500)) expectRawPathMatchesParser(html)
  })

  it('templates with no raw ${ parse to exactly the HTML parser values', () => {
    const noSyntax = [...HAND_CORPUS, ...generatedCorpus(1500)].filter(
      (html) => !html.includes('${')
    )
    expect(noSyntax.length).toBeGreaterThan(100)
    for (const html of noSyntax) {
      const expectedText: string[] = []
      const expectedAttrs: string[] = []
      walk(html, (node) => {
        if (node.nodeName === '#text' && (node as P5Text).value.trim()) {
          expectedText.push((node as P5Text).value)
        } else if ('tagName' in node) {
          for (const attr of (node as P5Element).attrs) expectedAttrs.push(attr.value)
        }
      })
      const text: string[] = []
      const attrs: string[] = []
      const collect = (nodes: NodeInfo[]): void => {
        for (const node of nodes) {
          if (isTextInfo(node)) {
            text.push((node.parts ?? []).map((p) => (p.kind === 'text' ? p.value : '?')).join(''))
          } else {
            attrs.push(...node.staticAttrs.values())
            collect(node.children)
          }
        }
      }
      const parser = new TemplateParser()
      collect(parser.parse(html))
      expect(text, html).toEqual(expectedText)
      expect(attrs, html).toEqual(expectedAttrs)
      expect(parser.diagnostics, html).toEqual([])
    }
  })
})
