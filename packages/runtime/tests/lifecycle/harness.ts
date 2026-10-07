/**
 * Lifecycle test harness (Lifecycle Contract §10.1).
 *
 * - Listener counter: EventTarget.prototype.add/removeEventListener are
 *   wrapped once; `listenerCount()` is the running total (adds − removes),
 *   `listenerCount(target)` the per-target count. Tests take deltas.
 * - Live-effect counter: `__DIAMOND_DEV__` is set for every test so the
 *   engine counts effects; `liveEffects()` reads it.
 * - Instance tracker: every component that reaches ensureConstructed() is
 *   recorded; `afterEach` runs L-35 (domPing consistent for every live
 *   instance), then clears the document.
 * - `records()` captures Print output for L-38.
 */
import { beforeEach, afterEach, expect } from 'vitest'
import { Component } from '../../src/component'
import { DiamondCore } from '../../src/core'
import { addSink, configure, type LogRecord } from '@diamondjs/primafacie'

configure({ console: false })

// ── listener counter ───────────────────────────────────────────────────────
// happy-dom's elements, document and window each own addEventListener on
// their own prototype (not Node's global EventTarget), so every owner is
// wrapped once.
const perTarget = new WeakMap<EventTarget, number>()
let totalListeners = 0
const wrapped = new Set<object>()
function wrapOwner(sample: object): void {
  let proto: object | null = sample
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto)
  if (!proto || wrapped.has(proto)) return
  wrapped.add(proto)
  const target = proto as EventTarget
  const origAdd = target.addEventListener
  const origRemove = target.removeEventListener
  target.addEventListener = function (this: EventTarget, ...args: Parameters<typeof origAdd>) {
    perTarget.set(this, (perTarget.get(this) ?? 0) + 1)
    totalListeners++
    return origAdd.apply(this, args)
  }
  target.removeEventListener = function (this: EventTarget, ...args: Parameters<typeof origRemove>) {
    perTarget.set(this, (perTarget.get(this) ?? 0) - 1)
    totalListeners--
    return origRemove.apply(this, args)
  }
}
for (const sample of [document.createElement('div'), document, window]) wrapOwner(sample)

export function listenerCount(target?: EventTarget): number {
  return target ? (perTarget.get(target) ?? 0) : totalListeners
}

export function liveEffects(): number {
  return DiamondCore.__liveEffects()
}

// ── instance tracker ───────────────────────────────────────────────────────
const tracked = new Set<Component>()
const origEnsure = Component.prototype.ensureConstructed
Component.prototype.ensureConstructed = function (this: Component) {
  tracked.add(this)
  origEnsure.call(this)
}

export function liveInstances(): Component[] {
  return [...tracked]
}

// ── Print capture ──────────────────────────────────────────────────────────
let captured: LogRecord[] = []
let detachSink: (() => void) | null = null

/** Every Print record emitted since the test began. */
export function records(): LogRecord[] {
  return captured
}

// ── per-test setup ─────────────────────────────────────────────────────────
export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** A host that is in the document (mounted() needs a connected root). */
export function connectedHost(tag = 'div'): HTMLElement {
  return document.body.appendChild(document.createElement(tag))
}

/** A host that is NOT in the document. */
export function detachedHost(tag = 'div'): HTMLElement {
  return document.createElement(tag)
}

beforeEach(() => {
  ;(globalThis as { __DIAMOND_DEV__?: unknown }).__DIAMOND_DEV__ = true
  captured = []
  detachSink = addSink((r) => captured.push(r))
})

afterEach(() => {
  // L-35: the snapshot agrees with the DOM for every live instance.
  for (const c of tracked) {
    const ping = c.domPing()
    expect(ping, `${c.constructor.name} ${ping.phase}`).toMatchObject({ consistent: true })
  }
  tracked.clear()
  detachSink?.()
  detachSink = null
  document.body.innerHTML = ''
  delete (globalThis as { __DIAMOND_DEV__?: unknown }).__DIAMOND_DEV__
})
