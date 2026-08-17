/**
 * @vitest-environment happy-dom
 *
 * v2.2.1 §4.6 — editor-level assertions: the Destination template-literal
 * unions must reject arm/target disagreement AT COMPILE TIME (the editor
 * squiggles before route-check ever runs). Verified by `npm run typecheck`
 * (tsc over packages/runtime/tsconfig.typetest.json); the runtime test
 * below is a trivial anchor so the file also rides the normal suite.
 */
import { describe, it, expect } from 'vitest'
import type { Destination } from '../src/router'

// ── valid forms (must compile) ─────────────────────────────────────────────

const validRouteId: Destination = { type: 'route-id', target: 'corpus-list' }
const validRoutePath: Destination = { type: 'route-path', target: '/corpora/:corpusId' }
const validSitePath: Destination = { type: 'site-path', target: '/support/wiki' }
const validExternal: Destination = {
  type: 'external-url',
  target: 'https://archive.example.org/x',
}
const validQueryRide: Destination = {
  type: 'route-id',
  target: 'login',
  query: { returnTo: '/locked' },
}

// ── invalid forms (must NOT compile) ───────────────────────────────────────

// @ts-expect-error — external-url requires https:// (http: rejected)
const badHttp: Destination = { type: 'external-url', target: 'http://insecure.example.com' }

// @ts-expect-error — external-url requires https:// (protocol-relative rejected)
const badProtocolRelative: Destination = { type: 'external-url', target: '//cdn.example.com/x' }

// @ts-expect-error — external-url requires https:// (javascript: rejected)
const badScheme: Destination = { type: 'external-url', target: 'javascript:alert(1)' }

// @ts-expect-error — route-path targets must start with '/'
const badRelativePath: Destination = { type: 'route-path', target: 'corpora/abc' }

// @ts-expect-error — site-path targets must start with '/'
const badSitePath: Destination = { type: 'site-path', target: 'support/wiki' }

// @ts-expect-error — query exists only on the route-* arms
const badQueryOnSite: Destination = { type: 'site-path', target: '/x', query: { a: '1' } }

// @ts-expect-error — the arm tag is required; there is no untagged shorthand
const badBareString: Destination = '/corpora'

describe('Destination type-level contract', () => {
  it('valid forms are constructible (runtime anchor for the compile-time file)', () => {
    for (const d of [validRouteId, validRoutePath, validSitePath, validExternal, validQueryRide]) {
      expect(typeof d.type).toBe('string')
    }
    // The @ts-expect-error consts above are intentionally unused at runtime.
    void badHttp
    void badProtocolRelative
    void badScheme
    void badRelativePath
    void badSitePath
    void badQueryOnSite
    void badBareString
  })
})
