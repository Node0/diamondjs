/**
 * DiamondJS v2.1 — Example app
 *
 * Three components:
 *
 *  Tasks (compiled template, Tasks.diamond.html)
 *   - .calls events, two-way binding, ${} interpolation          (v2.0)
 *   - set (static one-shot) + rawSet (audited raw escape hatch)  (v2.0 security)
 *   - if / else-if (empty state) + repeat.for (the list)         (v2.0)
 *   - <switch>/<case>/<default> — exhaustive multi-state         (v2.1)
 *   - ...attrs.bind — runtime-gated attribute spread             (v2.1)
 *
 *  MoneyForm (hand-written — shows the runtime API the compiler targets)
 *   - CurrencyConverter format/parse + ParseResult               (v2.0)
 *   - value.update-on="blur" (the 5th bind() arg)                (v2.0)
 *   - this.debounce (self-registering, leak-safe)                (v2.0)
 *
 *  TaskBoard (hand-written — the v2.1 scale primitives)
 *   - Collection<T> (2.1a): never-proxied items, version signal  (v2.1)
 *   - DiamondCore.delegate (2.1b): ONE listener for every row    (v2.1)
 */

import { DiamondCore, Component, reactive } from '@diamondjs/runtime'
import { CurrencyConverter } from '@diamondjs/converters'
import * as TasksTemplate from './Tasks.diamond.html'

interface Task {
  title: string
}

/**
 * Tasks — uses the compiled template from Tasks.diamond.html.
 * `title` / `bannerHtml` are read once (set / rawSet); `draft` / `tasks` drive the UI.
 */
class Tasks extends Component {
  title = 'DiamondJS v2.1 — Tasks'
  bannerHtml =
    '<strong>v2.1</strong> — this banner is set via <code>innerHTML.rawSet</code> (recorded in stink-baseline.json).'

  // ...attrs.bind source: safe keys land as properties; data-*/aria-* land as
  // attributes; anything off the allowlist is skipped (fails closed, dev warn).
  inputAttrs = { 'aria-label': 'New task title', maxLength: 64 }

  @reactive draft = ''
  @reactive tasks: Task[] = []

  // Drives the <switch on="mood"> block — reads reactive state, so the
  // switch re-dispatches whenever the task count changes.
  get mood(): string {
    if (this.tasks.length === 0) return 'idle'
    return this.tasks.length < 5 ? 'cruising' : 'busy'
  }

  add(): void {
    const t = this.draft.trim()
    if (t) {
      this.tasks = [...this.tasks, { title: t }]
      this.draft = ''
    }
  }

  remove(task: Task): void {
    this.tasks = this.tasks.filter((x) => x !== task)
  }

  // The compiled instance method from the .diamond.html module.
  createTemplate = (
    TasksTemplate as unknown as { createTemplate: (this: Tasks) => HTMLElement }
  ).createTemplate
}

/**
 * MoneyForm — hand-written, but it is exactly what the compiler emits for:
 *   value.two-way="amount | CurrencyConverter('USD')"  value.update-on="blur"
 * plus a debounced side-effect.
 */
class MoneyForm extends Component {
  @reactive amount = 1000
  @reactive lastCommit = '—'

  // Handler timing: self-registering debounce (cancelled automatically on unmount).
  private commit = this.debounce(() => {
    this.lastCommit = `committed ${this.amount}`
  }, 400)

  createTemplate(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'card'

    const h2 = document.createElement('h2')
    h2.textContent = 'Money — converter pipe + update-on + debounce'

    const input = document.createElement('input')
    input.placeholder = 'Enter an amount, then blur'
    // Two-way through CurrencyConverter: format outbound, parse (→ ParseResult)
    // inbound, sampled on 'blur' (update-on). Invalid input keeps the model + raw.
    DiamondCore.bind(
      input,
      'value',
      () => CurrencyConverter.format(this.amount, 'USD'),
      (v) => {
        const r = CurrencyConverter.parse(v as string, 'USD')
        if (r.valid && r.value !== null) {
          this.amount = r.value
          this.commit()
        }
      },
      'blur'
    )

    const out = document.createElement('p')
    out.className = 'count'
    DiamondCore.bind(
      out,
      'textContent',
      () => `Model holds the number ${this.amount} · ${this.lastCommit}`
    )

    div.append(h2, input, out)
    return div
  }
}

/**
 * TaskBoard — hand-written; the v2.1 scale primitives:
 *   Collection<T> (2.1a): plain never-proxied items, one version signal —
 *     10k pushes re-render once (scheduler dedupe)
 *   DiamondCore.delegate (2.1b): ONE container listener serves every row,
 *     resolving the click back to the DATA ITEM via repeat's node→item registry
 */
class TaskBoard extends Component {
  board = DiamondCore.collection<Task>(
    [{ title: 'Design' }, { title: 'Build' }, { title: 'Verify' }],
    { key: (t) => t.title }
  )
  picked = DiamondCore.reactive({ label: 'nothing yet' })

  createTemplate(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'card'

    const h2 = document.createElement('h2')
    h2.textContent = 'Board — Collection + delegate (v2.1)'

    const list = document.createElement('ul')
    const anchor = document.createComment('repeat')
    list.appendChild(anchor)
    DiamondCore.repeat(anchor, () => this.board, (task: Task) => {
      const li = document.createElement('li')
      li.textContent = task.title
      return li
    })
    // One delegated listener — no per-row handlers, no listener thrash at scale
    DiamondCore.delegate<Task>(list, 'click', 'li', (task) => {
      this.picked.label = task.title
    })

    const out = document.createElement('p')
    out.className = 'count'
    DiamondCore.bind(out, 'textContent', () => `Picked: ${this.picked.label}`)

    const add = document.createElement('button')
    add.textContent = 'Add row'
    DiamondCore.on(add, 'click', () =>
      this.board.push({ title: `Task ${this.board.length + 1}` })
    )

    div.append(h2, list, out, add)
    return div
  }
}

const app = document.getElementById('app')!

const tasks = new Tasks()
tasks.mount(app)

const money = new MoneyForm()
money.mount(app)

const board = new TaskBoard()
board.mount(app)

console.log('DiamondJS v2.1 example loaded — Tasks + MoneyForm + TaskBoard', {
  tasks,
  money,
  board,
})
