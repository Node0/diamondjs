/**
 * DiamondJS Hello World Example (v1.5.1)
 *
 * This example demonstrates the DiamondJS runtime and component system.
 * Templates are compiled at build time by the Parcel transformer.
 *
 * Key v1.5.1 patterns:
 * - Instance createTemplate() method (not static factory)
 * - 'this' references everywhere (no 'vm' parameter)
 * - @reactive decorator for explicit reactivity
 * - [Diamond] hint comments in compiled output
 */

import { DiamondCore, Component, reactive } from '@diamondjs/runtime'

// Import compiled template - demonstrates the Parcel transformer
import * as CounterTemplateModule from './Counter.diamond.html'

/**
 * Counter Component
 *
 * This version uses a template compiled by the Parcel transformer.
 */
class Counter extends Component {
  @reactive count = 0

  increment(): void {
    this.count++
  }

  decrement(): void {
    this.count--
  }

  // Use the compiled template from the .diamond.html file
  // In v1.5.1, this is an instance method assigned from the compiled module
  createTemplate = CounterTemplateModule.createTemplate
}

/**
 * Greeting Component
 *
 * Demonstrates:
 * - Two-way input binding using 'this'
 * - Text interpolation
 * - @reactive property decorator
 *
 * In production, this would also use a compiled template.
 */
class Greeting extends Component {
  @reactive name = 'World'

  // [Diamond] Compiler-generated instance template method
  createTemplate() {
    const div = document.createElement('div')
    div.className = 'greeting'

    const input = document.createElement('input')
    input.placeholder = 'Enter your name'
    // [Diamond] Two-way binding: value ↔ this.name
    DiamondCore.bind(
      input,
      'value',
      () => this.name,
      (v) => (this.name = v as string)
    )

    const p = document.createElement('p')
    // [Diamond] One-way binding: textContent ← this.name
    DiamondCore.bind(p, 'textContent', () => `Hello, ${this.name}!`)

    div.appendChild(input)
    div.appendChild(p)

    return div
  }
}

// Mount the components
const app = document.getElementById('app')!

const counterTitle = document.createElement('h2')
counterTitle.textContent = 'Counter (Compiled Template)'
app.appendChild(counterTitle)

const counter = new Counter()
counter.mount(app)

const greetingTitle = document.createElement('h2')
greetingTitle.textContent = 'Greeting'
app.appendChild(greetingTitle)

const greeting = new Greeting()
greeting.mount(app)

// Log to console for debugging
console.log('DiamondJS Hello World loaded! (v1.5.1)')
console.log('Counter component (compiled template):', counter)
console.log('Greeting component:', greeting)
