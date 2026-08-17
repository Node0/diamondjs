/**
 * Security gate tests — the allowlist + gateSink decision table (DDR §3.2–§3.4).
 */
import { describe, it, expect } from 'vitest'
import { gateSink, SAFE_SINKS } from '../security'
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

  it('produces stink:warn for an off-list static attr (href)', () => {
    const compiler = new DiamondCompiler()
    const result = compiler.compile('<a href="https://example.com">x</a>')
    expect(
      result.diagnostics.some(
        (d) => d.code === 'stink:warn' && d.property === 'href'
      )
    ).toBe(true)
  })

  it('leaves literal allowlisted attrs ungated (class, id, data-*, aria-*)', () => {
    const compiler = new DiamondCompiler()
    const result = compiler.compile(
      '<div class="container" id="main" data-x="1" aria-label="ok" title="t"></div>'
    )
    expect(result.diagnostics.filter((d) => d.code === 'stink:warn')).toHaveLength(0)
  })
})
