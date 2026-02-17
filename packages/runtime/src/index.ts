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

// Decorator
export { reactive } from './decorators'

// Default export
export { DiamondCore as default } from './core'
