/**
 * @vitest-environment happy-dom
 *
 * Runtime behavior for the Tasks component (hand-written to mirror the compiled
 * Tasks.diamond.html — exercises DiamondCore.if/else-if + repeat.for in a
 * mounted Component).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiamondCore, Component } from '@diamondjs/runtime'

interface Task {
  title: string
}

class Tasks extends Component {
  private s = DiamondCore.reactive({ draft: '', tasks: [] as Task[] })
  get draft() {
    return this.s.draft
  }
  set draft(v: string) {
    this.s.draft = v
  }
  get tasks() {
    return this.s.tasks
  }
  set tasks(v: Task[]) {
    this.s.tasks = v
  }

  add() {
    const t = this.draft.trim()
    if (t) {
      this.tasks = [...this.tasks, { title: t }]
      this.draft = ''
    }
  }

  createTemplate() {
    const div = document.createElement('div')
    const anchor = document.createComment('if')
    div.appendChild(anchor)
    DiamondCore.if(anchor, [
      {
        when: () => this.tasks.length === 0,
        make: () => {
          const p = document.createElement('p')
          p.textContent = 'No tasks yet'
          return p
        },
      },
      {
        when: () => this.tasks.length > 0,
        make: () => {
          const ul = document.createElement('ul')
          const repeatAnchor = document.createComment('repeat')
          ul.appendChild(repeatAnchor)
          DiamondCore.repeat(repeatAnchor, () => this.tasks, (task) => {
            const li = document.createElement('li')
            li.textContent = task.title
            return li
          })
          return ul
        },
      },
    ])
    return div
  }
}

describe('Tasks component (if/else-if + repeat.for)', () => {
  let host: HTMLElement
  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
  })
  afterEach(() => vi.useRealTimers())

  it('renders the empty state when there are no tasks', () => {
    const t = new Tasks()
    t.mount(host)
    expect(host.querySelector('p')?.textContent).toBe('No tasks yet')
    expect(host.querySelector('ul')).toBeNull()
  })

  it('switches to the list and renders one row per task', async () => {
    const t = new Tasks()
    t.mount(host)
    t.draft = 'Buy milk'
    t.add()
    await vi.runAllTimersAsync()

    expect(host.querySelector('p')).toBeNull()
    const rows = host.querySelectorAll('li')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toBe('Buy milk')
  })

  it('grows the list as tasks are added', async () => {
    const t = new Tasks()
    t.mount(host)
    t.draft = 'A'
    t.add()
    t.draft = 'B'
    t.add()
    await vi.runAllTimersAsync()
    expect(host.querySelectorAll('li')).toHaveLength(2)
    expect(Array.from(host.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'A',
      'B',
    ])
  })
})
