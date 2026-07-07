/**
 * Security gate tests — the allowlist + gateSink decision table (DDR §3.2–§3.4).
 */
import { describe, it, expect } from 'vitest'
import { gateSink, SAFE_SINKS } from '../security'
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
  it('every safe sink is reachable (lowercase-identical or canonicalized by the map)', () => {
    const mapped = new Set(Object.values(PROPERTY_NAME_MAP))
    for (const sink of SAFE_SINKS) {
      const lcIdentical = sink === sink.toLowerCase()
      expect(
        lcIdentical || mapped.has(sink),
        `SAFE_SINK '${sink}' must be lowercase-identical or present in PROPERTY_NAME_MAP`
      ).toBe(true)
    }
  })

  it('excludes the canonical dangerous sinks (they require raw)', () => {
    for (const s of ['innerHTML', 'outerHTML', 'src', 'href', 'srcdoc']) {
      expect(SAFE_SINKS.has(s)).toBe(false)
    }
  })

  it('includes the canonical safe sinks', () => {
    for (const s of ['textContent', 'value', 'className']) {
      expect(SAFE_SINKS.has(s)).toBe(true)
    }
  })
})
