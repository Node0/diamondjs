/**
 * Security gate tests — the allowlist + gateSink decision table (DDR §3.2–§3.4).
 */
import { describe, it, expect } from 'vitest'
import { gateSink, isInertStaticHref, INERT_URL_SCHEMES, SAFE_SINKS } from '../security'
import { DiamondCompiler } from '../compiler'
import { PROPERTY_NAME_MAP } from '../parser'

describe('gateSink decision table', () => {
  it('passes a safe sink with no raw (clean — no diagnostic)', () => {
    expect(gateSink('textContent', 'set', false, 'title', null)).toBeNull()
    expect(gateSink('value', 'two-way', false, 'name', null)).toBeNull()
    expect(gateSink('className', 'to-view', false, 'cls', null)).toBeNull()
  })

  it('warns on an unsafe sink written WITHOUT raw (stink:warn — hard gate)', () => {
    const d = gateSink('innerHTML', 'to-view', false, 'userHtml', null)
    expect(d?.severity).toBe('warn')
    expect(d?.code).toBe('stink:warn')
    // remediation names the three-segment raw form, not a flattened token
    expect(d?.message).toContain('innerHTML.rawBind.to-view')
  })

  it('baselines an intentional raw write to an unsafe sink (stink:declared — no block)', () => {
    const d = gateSink('innerHTML', 'to-view', true, 'userHtml | sanitizeHtml', null)
    expect(d?.severity).toBe('declared')
    expect(d?.code).toBe('stink:declared')
    expect(d?.expression).toBe('userHtml | sanitizeHtml')
  })

  it('flags redundant raw on a safe sink as info (NOT declared)', () => {
    const d = gateSink('textContent', 'set', true, 'title', null)
    expect(d?.severity).toBe('info')
    expect(d?.code).toBe('raw:redundant')
  })

  it('fails closed on a novel/unknown sink (warn when not raw)', () => {
    const d = gateSink('someNovelProp', 'to-view', false, 'x', null)
    expect(d?.code).toBe('stink:warn')
  })

  it('suggests rawSet for set ops', () => {
    const d = gateSink('outerHTML', 'set', false, 'x', null)
    expect(d?.message).toContain('outerHTML.rawSet')
  })

  it('passes data-*/aria-* through the attribute branch (Amendment A2)', () => {
    expect(gateSink('data-user-id', 'set', false, 'user.id', null)).toBeNull()
    expect(gateSink('aria-label', 'to-view', false, 'label', null)).toBeNull()
  })

  it('passes role through the inert-metadata branch alongside data-*/aria-* (#8)', () => {
    expect(gateSink('role', 'set', false, 'tab', null)).toBeNull()
    expect(gateSink('role', 'to-view', false, 'r', null)).toBeNull()
    // Still not an allowlisted PROPERTY — it rides the attribute branch.
    expect(SAFE_SINKS.has('role')).toBe(false)
  })

  it('still fails closed on other dashed names', () => {
    const d = gateSink('foo-bar', 'set', false, 'x', null)
    expect(d?.code).toBe('stink:warn')
  })
})

describe('SAFE_SINKS / PROPERTY_NAME_MAP invariant', () => {
  it('every multi-case safe sink canonicalizes through PROPERTY_NAME_MAP (normative form, D-15)', () => {
    // map[lowercase(sink)] === sink — value-set membership alone would pass a
    // wrong-key entry (e.g. tabindx → tabIndex) that leaves the sink unreachable.
    for (const sink of SAFE_SINKS) {
      const lc = sink.toLowerCase()
      if (lc !== sink) {
        expect(
          PROPERTY_NAME_MAP[lc],
          `PROPERTY_NAME_MAP['${lc}'] must map to '${sink}' or it arrives non-canonical and fails closed as a false warn`
        ).toBe(sink)
      }
    }
  })

  it('excludes the canonical dangerous sinks (they require raw)', () => {
    for (const s of ['innerHTML', 'outerHTML', 'src', 'href', 'srcdoc']) {
      expect(SAFE_SINKS.has(s)).toBe(false)
    }
  })

  it('fails closed on srcset/action/formAction/cssText (D-20 regression lock)', () => {
    for (const s of ['srcset', 'action', 'formAction', 'cssText']) {
      expect(SAFE_SINKS.has(s), `'${s}' must not be allowlisted`).toBe(false)
      const d = gateSink(s, 'to-view', false, 'x', null)
      expect(d?.code, `'${s}' must gate as stink:warn without raw`).toBe('stink:warn')
    }
  })

  it('includes the canonical safe sinks', () => {
    for (const s of ['textContent', 'value', 'className']) {
      expect(SAFE_SINKS.has(s)).toBe(true)
    }
  })
})

describe('static attribute gating (D-10)', () => {
  it('produces stink:warn for an inline on* handler', () => {
    const compiler = new DiamondCompiler()
    const result = compiler.compile('<div onclick="alert(1)"></div>')
    const diag = result.diagnostics.find(
      (d) => d.code === 'stink:warn' && d.property === 'onclick'
    )
    expect(diag?.severity).toBe('warn')
    // Gate never changes the emitted code — the write still ships (audited).
    expect(result.code).toContain(`setAttribute('onclick', 'alert(1)')`)
  })

  it('produces stink:warn for an off-list static attr (href on a non-link element)', () => {
    const compiler = new DiamondCompiler()
    const result = compiler.compile('<link href="https://example.com/x.css">')
    expect(
      result.diagnostics.some(
        (d) => d.code === 'stink:warn' && d.property === 'href'
      )
    ).toBe(true)
  })

  it('leaves literal allowlisted attrs ungated (class, id, data-*, aria-*, role)', () => {
    const compiler = new DiamondCompiler()
    const result = compiler.compile(
      '<div class="container" id="main" data-x="1" aria-label="ok" title="t" role="tablist"></div>'
    )
    expect(result.diagnostics.filter((d) => d.code === 'stink:warn')).toHaveLength(0)
    expect(result.code).toContain(`setAttribute('role', 'tablist')`)
  })
})

describe('static <a href> literals (#8 — the README nav pattern must pass the gate)', () => {
  const compiler = new DiamondCompiler()
  const stinks = (html: string) =>
    compiler.compile(html).diagnostics.filter((d) => d.code === 'stink:warn')

  it('gates clean for relative / same-origin / fragment / query targets', () => {
    expect(
      stinks(
        '<nav><a href="/source">Source</a><a href="./x">x</a><a href="../y">y</a>' +
          '<a href="#top">top</a><a href="?q=1">q</a><a href="docs/index.html">d</a><a href="">e</a></nav>'
      )
    ).toHaveLength(0)
  })

  it('gates clean for the navigation-only schemes (http, https, mailto, tel)', () => {
    expect(
      stinks(
        '<a href="https://example.com">h</a><a href="http://example.com">h</a>' +
          '<a href="mailto:a@b.c">m</a><a href="tel:+15555551234">t</a><a href="HTTPS://X.Y">u</a>'
      )
    ).toHaveLength(0)
    expect([...INERT_URL_SCHEMES].sort()).toEqual(['http', 'https', 'mailto', 'tel'])
  })

  it('still ships the literal setAttribute unchanged (the gate never edits code)', () => {
    const { code } = compiler.compile('<a href="/source">Source</a>')
    expect(code).toContain(`setAttribute('href', '/source')`)
  })

  it('applies to <area href> too', () => {
    expect(stinks('<map><area href="/region" alt="r"></map>')).toHaveLength(0)
  })

  it('still warns for script-capable and unenumerated schemes (fail closed)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)', // leading space — the URL parser strips it
      'java\nscript:alert(1)', // interior newline — the URL parser strips it
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'blob:https://x/y',
      'ftp://example.com/f',
    ]) {
      const d = stinks(`<a href="${bad.replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')}">x</a>`)
      expect(d, `expected stink:warn for href=${JSON.stringify(bad)}`).toHaveLength(1)
      expect(d[0].property).toBe('href')
    }
  })

  it('is literal-only: a BOUND href still warns (value unknowable at compile time)', () => {
    expect(stinks('<a href.set="link">x</a>')).toHaveLength(1)
    expect(stinks('<a href.to-view="link">x</a>')).toHaveLength(1)
  })

  it('isInertStaticHref is scoped to href on a/area', () => {
    expect(isInertStaticHref('a', 'href', '/x')).toBe(true)
    expect(isInertStaticHref('area', 'href', '/x')).toBe(true)
    expect(isInertStaticHref('link', 'href', '/x')).toBe(false)
    expect(isInertStaticHref('base', 'href', '/x')).toBe(false)
    expect(isInertStaticHref('a', 'src', '/x')).toBe(false)
    expect(isInertStaticHref('a', 'href', 'javascript:1')).toBe(false)
  })
})
