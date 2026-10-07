import { Component, DiamondCore, reactive } from '@diamondjs/runtime'

export class MyComponent extends Component {
  @reactive name = ''                 // reactive → drives the UI
  @reactive count = 0
  private saved = 0                   // bare → inert bookkeeping

  constructor() { super() }           // the object exists; acquire nothing here

  override constructed() {            // @reactive is live under any toolchain; no element yet
    this.count = 1
  }
  override mounting() {               // about to appear: generation assigned, no template yet
    this.saved = Date.now()
  }
  override mounted() {                // in the document: measure, focus, observe
    this.getElement()?.querySelector('input')?.focus()
  }
  override unmounting() {             // still in the document; the generation is already invalid
    this.saved = 0
  }
  override unmounted() {              // detached, state preserved; may be mounted again
    this.count++
  }

  handleClick() { this.name = 'Updated' }   // `this` is always the component

  // Compiler-generated from my-component.html; written out so the fixture mounts.
  createTemplate(): HTMLElement {
    const div = document.createElement('div')
    const input = document.createElement('input')
    DiamondCore.bind(input, 'value', () => this.name, (v) => (this.name = v as string))
    div.appendChild(input)
    return div
  }
}
