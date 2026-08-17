/**
 * @vitest-environment happy-dom
 *
 * Scaffold sanity: the package builds on the runtime's Guard contract and
 * ships no premature battery stubs (families are gated on the route
 * sketches' guard inventory).
 */
import { describe, it, expect } from 'vitest'
import * as guards from '../src/index'
import { Guard } from '@diamondjs/runtime'

describe('@diamondjs/guards scaffold', () => {
  it('ships no premature battery classes (gated on route sketches)', () => {
    const exported = Object.keys(guards)
    for (const name of ['OAuthGuard', 'WebAuthnGuard', 'CapabilityGuard', 'TenantGuard']) {
      expect(exported).not.toContain(name)
    }
  })

  it('the runtime base contract is reachable (cannot drift)', () => {
    class Probe extends Guard {
      static override check(): boolean {
        return true
      }
    }
    expect(Probe.timeoutMs).toBe(5000)
    expect(Probe.deny({ to: '/x', from: null, params: {}, routeId: 'x' })).toEqual({
      type: 'route-id',
      target: 'not-found',
    })
  })
})
