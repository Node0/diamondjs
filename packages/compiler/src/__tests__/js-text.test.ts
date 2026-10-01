/**
 * @vitest-environment happy-dom
 *
 * Issue #19 — author text written into emitted JS must survive the trip.
 *
 * Interpolated text used to escape only the backtick and `${`, so the
 * author's backslashes were read as JS escapes: `C:\temp` rendered a tab,
 * `C:\users` did not parse. Every place the generator writes author text into
 * JS now goes through one encoder per syntactic position (js-text.ts).
 *
 * The round-trip tests compile a template, evaluate the generated method on a
 * real Component, mount it and read the DOM back.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCompiler } from '../compiler'
import { jsString, jsTemplatePart, jsCommentText } from '../js-text'
import { Component, DiamondCore } from '@diamondjs/runtime'

const compiler = new DiamondCompiler()

/** Compile → evaluate (throws SyntaxError if the emitted code does not parse) → mount. */
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

/** HTML source whose parsed character data is exactly `text` (a raw CR would be normalized to LF). */
const asHtmlText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r/g, '&#13;')
const asHtmlAttr = (text: string): string => asHtmlText(text).replace(/"/g, '&quot;')

/**
 * Every entry starts and ends with a non-whitespace character: static text is
 * still trimmed at its edges (#15), which is not what this suite measures.
 * None contains a complete `${…}` — in template text that is an interpolation.
 */
const CORPUS: Array<[label: string, text: string]> = [
  ['backslash', 'back\\slash'],
  ['\\t and \\n sequences', 'C:\\temp\\notes'],
  ['\\u and \\x sequences', 'C:\\users\\x41'],
  ['\\0 and \\\\ sequences', 'nul\\0 and \\\\ doubled'],
  ['trailing backslash', 'ends with \\'],
  ['backtick', 'tick ` tock'],
  ['escaped-looking backtick', 'tick \\` tock'],
  ['single quote', "it's"],
  ['double quote', 'say "hi"'],
  ['$ { } apart', 'cost $5 {each} }{ $'],
  ['CR', 'a\rb'],
  ['LF', 'a\nb'],
  ['CRLF', 'a\r\nb'],
  ['TAB', 'a\tb'],
  ['U+2028', 'a\u2028b'],
  ['U+2029', 'a\u2029b'],
  ['NBSP', 'a\u00a0b'],
  ['everything', '\\t`\'"$ { }\r\n\t\u2028\u2029\u00a0\\u\\x\\0\\\\!'],
]

describe('encoders: the emitted source evaluates back to the text', () => {
  const evaluate = (source: string): unknown => new Function(`return ${source}`)()

  it.each(CORPUS)('jsString — %s', (_label, text) => {
    expect(evaluate(jsString(text))).toBe(text)
  })

  it.each(CORPUS)('jsTemplatePart — %s', (_label, text) => {
    expect(evaluate('`' + jsTemplatePart(text) + '`')).toBe(text)
  })

  it('jsString keeps the single-quoted house style', () => {
    expect(jsString('Hello World')).toBe("'Hello World'")
    expect(jsString('say "hi"')).toBe(`'say "hi"'`)
    expect(jsString("it's")).toBe("'it\\'s'")
  })

  it('jsCommentText leaves no line terminator, and single-line text untouched', () => {
    expect(jsCommentText('a &&\n      b')).toBe('a && b')
    expect(jsCommentText('a\r\nb\u2028c\u2029d')).toBe('a b c d')
    expect(jsCommentText('items  |  Sort')).toBe('items  |  Sort')
  })
})

describe('round trip: compiled text renders exactly what the template says', () => {
  it.each(CORPUS)('static text — %s', (_label, text) => {
    const host = mount(`<p>${asHtmlText(text)}</p>`)
    expect(host.querySelector('p')!.textContent).toBe(text)
  })

  it.each(CORPUS)('interpolated text — %s', (_label, text) => {
    const host = mount(`<p>${asHtmlText(text)} \${x}</p>`, { x: '' })
    expect(host.querySelector('p')!.textContent).toBe(text + ' ')
  })

  it.each(CORPUS)('static attribute value — %s', (_label, text) => {
    const host = mount(`<p title="${asHtmlAttr(text)}" class="${asHtmlAttr(text)}">x</p>`)
    const p = host.querySelector('p')!
    expect(p.getAttribute('title')).toBe(text)
    expect(p.className).toBe(text)
  })

  it('the three reported shapes', () => {
    expect(mount('<p>C:\\temp\\notes ${name}</p>', { name: 'N' }).textContent).toBe(
      'C:\\temp\\notes N'
    )
    expect(mount('<p>C:\\users\\x ${name}</p>', { name: 'N' }).textContent).toBe(
      'C:\\users\\x N'
    )
    expect(mount('<p>C:\\temp\\notes</p>').textContent).toBe('C:\\temp\\notes')
  })

  it('a backslash directly before an interpolation does not escape it', () => {
    expect(mount('<p>a\\${x}</p>', { x: 'X' }).textContent).toBe('a\\X')
  })
})

describe('hint comments: author text cannot end the comment line', () => {
  it('a multi-line expression in a structural hint', () => {
    const host = mount('<div><p if="a &&\n      b">shown</p></div>', { a: true, b: true })
    expect(host.textContent).toBe('shown')
  })

  it('a multi-line expression in a binding hint and an event hint', () => {
    const host = mount(
      '<button title.to-view="first +\n  last" click.calls="go(\n  first)">go</button>',
      { first: 'a', last: 'b', go: () => {} }
    )
    expect(host.querySelector('button')!.title).toBe('ab')
  })

  it('U+2028 inside an expression string literal', () => {
    const host = mount(`<p title.to-view="'a\u2028b'">x</p>`)
    expect(host.querySelector('p')!.title).toBe('a\u2028b')
  })

  it('a multi-line repeat.for and switch on=', () => {
    const host = mount(
      '<ul><li repeat.for="u of\n  users">${u}</li></ul><switch on="mode\n"><case if="a"><i>A</i></case></switch>',
      { users: ['x', 'y'], mode: 'a' }
    )
    expect(host.textContent).toBe('xyA')
  })
})
