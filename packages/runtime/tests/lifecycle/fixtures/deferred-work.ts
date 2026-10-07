import { Component, DiamondCore, reactive } from '@diamondjs/runtime'

export class Ticker extends Component {
  @reactive seconds = 0

  // Self-registering: cancelled at unmount(), kept for a remount, released by dispose().
  private bump = this.debounce(() => this.seconds++, 1000)

  override mounted() {
    // A callback the inventory cannot cancel is bound to this mount's generation:
    // after unmount() it declines and records `stale` instead of running.
    requestAnimationFrame(this.whileMounted(() => this.getElement()?.scrollIntoView()))
  }

  createTemplate(): HTMLElement {
    const button = document.createElement('button')
    DiamondCore.on(button, 'click', () => this.bump())
    return button
  }
}
