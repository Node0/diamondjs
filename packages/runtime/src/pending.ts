/**
 * Pending — the departure-safety semaphore (v2.2 §3.6).
 *
 * A noun for in-flight state: refcounted holds with labels. The router's
 * phase-1 navigation check, the beforeunload warning, and any save-indicator
 * UI all read ONE counter and cannot disagree. `active`/`labels` are reactive
 * (one micro-proxy version signal — the Collection pattern), so
 * `if="!Pending.active"` works in templates.
 *
 * The beforeunload handler is installed only while the count > 0 and removed
 * at zero — a persistent handler disables bfcache, so this conditionality is
 * correctness, not economy. Browsers show generic dialog text; labels are for
 * logs/UI only. Known gap (recorded): SPA Back (popstate) is not intercepted —
 * that is the deferred canLeave problem. Holds are not cancellation; in-flight
 * promises run to completion.
 */

import { reactivityEngine } from './reactivity'
import { Print } from '@diamondjs/primafacie'

export class Pending {
  /** Version signal (Collection pattern): reads touch, mutations bump. */
  private static version = reactivityEngine.createProxy({ n: 0 })
  private static holds = new Map<string, number>()

  private static beforeUnload = (e: BeforeUnloadEvent): void => {
    Print(
      'WARNING',
      `departure with active holds: ${[...Pending.holds.keys()].join(', ')}`
    )
    e.preventDefault()
    e.returnValue = '' // generic browser dialog; labels are for logs/UI only
  }

  /** Acquire a refcounted hold. The returned release is idempotent. */
  static hold(label: string): () => void {
    if (this.total() === 0 && typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.beforeUnload)
    }
    this.holds.set(label, (this.holds.get(label) ?? 0) + 1)
    this.version.n++
    Print('STATE', `Pending hold acquired: ${label}`)
    let released = false
    return () => {
      if (released) return
      released = true
      const n = this.holds.get(label) ?? 0
      if (n <= 1) this.holds.delete(label)
      else this.holds.set(label, n - 1)
      this.version.n++
      Print('STATE', `Pending hold released: ${label}`)
      if (this.total() === 0 && typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', this.beforeUnload)
      }
    }
  }

  /**
   * Hold for the lifetime of `work`. PASSTHROUGH — returns the SAME promise
   * (a decorating function returns what it was given, acting by registry side
   * effect); the hold releases when it settles either way.
   */
  static until<T>(work: Promise<T>, label: string): Promise<T> {
    const release = this.hold(label)
    work.then(release, release)
    return work
  }

  /** Reactive: any holds outstanding? */
  static get active(): boolean {
    void this.version.n
    return this.total() > 0
  }

  /** Reactive: the distinct labels currently held. */
  static labels(): readonly string[] {
    void this.version.n
    return [...this.holds.keys()]
  }

  private static total(): number {
    let t = 0
    for (const n of this.holds.values()) t += n
    return t
  }
}
