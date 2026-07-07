/**
 * @vitest-environment happy-dom
 *
 * TaskBoard-style integration: Collection (2.1a) rendered by repeat, driven
 * by delegate (2.1b) — the v2.1 scale primitives working together.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCore, Component } from '@diamondjs/runtime'

interface Task {
  title: string
}

class Board extends Component {
  board = DiamondCore.collection<Task>(
    [{ title: 'Design' }, { title: 'Build' }],
    { key: (t) => t.title }
  )
  picked = DiamondCore.reactive({ label: 'nothing yet' })

  createTemplate(): HTMLElement {
    const div = document.createElement('div')
    const list = document.createElement('ul')
    const anchor = document.createComment('repeat')
    list.appendChild(anchor)
    DiamondCore.repeat(anchor, () => this.board, (task: Task) => {
      const li = document.createElement('li')
      li.textContent = task.title
      return li
    })
    DiamondCore.delegate<Task>(list, 'click', 'li', (task) => {
      this.picked.label = task.title
    })
    const out = document.createElement('p')
    DiamondCore.bind(out, 'textContent', () => `Picked: ${this.picked.label}`)
    div.append(list, out)
    return div
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('TaskBoard (Collection + delegate)', () => {
  it('renders Collection rows, resolves delegated clicks to items, reacts to push', async () => {
    const host = document.createElement('div')
    const board = new Board()
    board.mount(host)

    expect(host.querySelectorAll('li')).toHaveLength(2)

    // Delegated click on a row resolves the DATA ITEM (not just the node)
    host.querySelectorAll('li')[1].dispatchEvent(new Event('click', { bubbles: true }))
    await tick()
    expect(host.querySelector('p')!.textContent).toBe('Picked: Build')

    // O(1) append re-renders through the version signal
    board.board.push({ title: 'Verify' })
    await tick()
    expect(host.querySelectorAll('li')).toHaveLength(3)

    // byKey works via the incremental index
    expect(board.board.byKey('Verify')?.title).toBe('Verify')
  })

  it('root cleanup (v2.1): unmount detaches the delegate and bindings', async () => {
    const host = document.createElement('div')
    const board = new Board()
    board.mount(host)
    const list = host.querySelector('ul')!
    const out = host.querySelector('p')!

    board.unmount()
    list.querySelector('li')!.dispatchEvent(new Event('click', { bubbles: true }))
    await tick()
    expect(out.textContent).toBe('Picked: nothing yet')
  })
})
