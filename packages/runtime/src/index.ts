/**
 * @diamondjs/runtime
 * 
 * DiamondJS Runtime - The core reactive framework
 * Designed for LLM-assisted development with radically transparent code
 * 
 * @example
 * import { DiamondCore, Component } from '@diamondjs/runtime'
 * 
 * const state = DiamondCore.reactive({ count: 0 })
 * 
 * DiamondCore.effect(() => {
 *   console.log('Count:', state.count)
 * })
 * 
 * state.count++ // Logs: "Count: 1"
 */

// Core API
export { DiamondCore } from './core'
export { Component } from './component'

// Convenience re-exports from DiamondCore
export { DiamondCore as default } from './core'
