/**
 * DiamondJS v2.0 — Example app
 *
 * Brings all five phases together in two components:
 *
 *  Tasks (compiled template, Tasks.diamond.html)
 *   - .calls events, two-way binding, ${} interpolation         (P1)
 *   - set (static one-shot) + rawSet (audited raw escape hatch)  (P1 security)
 *   - if / else-if (empty state) + repeat.for (the list)         (P2)
 *
 *  MoneyForm (hand-written — shows the runtime API the compiler targets)
 *   - CurrencyConverter format/parse + ParseResult               (P3)
 *   - value.update-on="blur" (the 5th bind() arg)                (P4)
 *   - this.debounce (self-registering, leak-safe)                (P4)
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
  title = 'DiamondJS v2.0 — Tasks'
  bannerHtml =
    '<strong>v2.0</strong> — this banner is set via <code>innerHTML.rawSet</code> (recorded in stink-baseline.json).'

  @reactive draft = ''
  @reactive tasks: Task[] = []

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

const app = document.getElementById('app')!

const tasks = new Tasks()
tasks.mount(app)

const money = new MoneyForm()
money.mount(app)

console.log('DiamondJS v2.0 example loaded — Tasks + MoneyForm', { tasks, money })
