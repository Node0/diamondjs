/**
 * Security data invariants — runtime-side mirror of the compiler's check.
 * The allowlist's canonical home is the runtime (v2.1); both gates consult it.
 */
import { describe, it, expect } from 'vitest'
import {
  SAFE_SINKS,
  PROPERTY_NAME_MAP,
  canonicalizeSinkKey,
  isDataOrAriaKey,
} from '../src/security'

describe('security data (canonical home)', () => {
  it('every multi-case safe sink canonicalizes through PROPERTY_NAME_MAP', () => {
    for (const sink of SAFE_SINKS) {
      const lc = sink.toLowerCase()
      if (lc !== sink) {
        // A missing entry would make the sink arrive non-canonical and fail
        // closed as a false stink:warn / spread skip.
        expect(PROPERTY_NAME_MAP[lc]).toBe(sink)
      }
    }
  })

  it('canonicalizeSinkKey maps attribute-cased keys to camelCase', () => {
    expect(canonicalizeSinkKey('tabindex')).toBe('tabIndex')
    expect(canonicalizeSinkKey('TABINDEX')).toBe('tabIndex')
    expect(canonicalizeSinkKey('value')).toBe('value')
    expect(canonicalizeSinkKey('unknownkey')).toBe('unknownkey')
  })

  it('never lists a markup/script/URL-capable sink as safe', () => {
    for (const dangerous of ['innerHTML', 'outerHTML', 'srcdoc', 'href', 'src', 'style']) {
      expect(SAFE_SINKS.has(dangerous)).toBe(false)
    }
  })

  it('fails closed on srcset/action/formAction/cssText (D-20 regression lock)', () => {
    // URL-capable (srcset), navigation-capable (action/formAction) and
    // style-capable (cssText) sinks must stay off the allowlist by construction.
    for (const s of ['srcset', 'action', 'formAction', 'cssText']) {
      expect(SAFE_SINKS.has(s), `'${s}' must not be allowlisted`).toBe(false)
      expect(SAFE_SINKS.has(canonicalizeSinkKey(s.toLowerCase()))).toBe(false)
    }
  })

  it('isDataOrAriaKey allows only the two inert prefixes', () => {
    expect(isDataOrAriaKey('data-user-id')).toBe(true)
    expect(isDataOrAriaKey('aria-label')).toBe(true)
    expect(isDataOrAriaKey('innerHTML')).toBe(false)
    expect(isDataOrAriaKey('database')).toBe(false) // no dash — not data-*
  })
})
