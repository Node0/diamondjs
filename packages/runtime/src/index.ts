/**
 * @diamondjs/runtime
 *
 * DiamondJS Runtime - The core reactive framework
 * Designed for LLM-assisted development with radically transparent code
 *
 * @example
 * import { DiamondCore, Component, reactive } from '@diamondjs/runtime'
 *
 * class Counter extends Component {
 *   @reactive count = 0
 *
 *   increment() { this.count++ }
 *
 *   createTemplate() {
 *     const div = document.createElement('div')
 *     DiamondCore.bind(div, 'textContent', () => `Count: ${this.count}`)
 *     return div
 *   }
 * }
 */

// Core API
export { DiamondCore } from './core'
export { Component } from './component'

// Collection-at-scale (v2.1, DDR §7.2 / 2.1a)
export { Collection, type CollectionOptions } from './collection'

// Decorator
export { reactive } from './decorators'

// Validation (DDR §5.7) — the from-view / parse contract
export { ParseResult } from './parse-result'

// Security data (DDR §3.2 / §7.1) — canonical home of the single auditable
// allowlist; the compiler re-exports these
export {
  SAFE_SINKS,
  PROPERTY_NAME_MAP,
  canonicalizeSinkKey,
  isDataOrAriaKey,
} from './security'

// Default export
export { DiamondCore as default } from './core'
