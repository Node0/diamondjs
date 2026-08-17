/**
 * @diamondjs/guards — the tier-2 policy batteries (v2.2 Phase 6).
 *
 * DDR sentence: converters are the DATA batteries; guards are the POLICY
 * batteries. This package holds abstract mid-classes between the runtime's
 * base `Guard` contract (imported from @diamondjs/runtime — the contract
 * cannot drift) and app-tier concrete subclasses configured via static
 * fields:
 *
 *   class CorpusSSO extends OAuthGuard {
 *     static issuer = 'https://idp.example.com'
 *     static clientId = 'corpus-web'
 *   }
 *
 * SCAFFOLD STATUS (v2.2.0): ships with ZERO battery mid-classes. The
 * project route sketches were withdrawn in favor of ideation fixtures
 * (v2.2 Router Spec §13), so no family has a confirmed real-world guard
 * inventory yet — and no stubs ship before that confirmation (the D-16
 * lesson: unshipped machinery described as shipped is a defect). First
 * batteries land in a 2.2.x once the first consuming application's guard
 * inventory exists. Recorded candidates:
 *
 *   - OAuthGuard     — static issuer/clientId; external-redirect deny
 *   - WebAuthnGuard  — static maxSessionAge; challenge-as-redirect idiom
 *   - CapabilityGuard
 *   - TenantGuard
 *
 * Per-route parameterization ({ use, state }) is deferred (recorded).
 * Budget: 400 LOC.
 */

// Re-exported so a battery author sees the exact contract they extend;
// apps should keep importing Guard from @diamondjs/runtime.
export type { GuardContext, Destination } from '@diamondjs/runtime'
