/**
 * @vitest-environment happy-dom
 *
 * Runtime behavior for the MoneyForm component: CurrencyConverter format/parse
 * (ParseResult), value.update-on="blur" sampling, and a self-registering debounce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiamondCore, Component } from '@diamondjs/runtime'
import { CurrencyConverter } from '@diamondjs/converters'

class MoneyForm extends Component {
  private s = DiamondCore.reactive({ amount: 1000, lastCommit: '—' })
  get amount() {
    return this.s.amount
  }
  set amount(v: number) {
    this.s.amount = v
  }
  private commit = this.debounce(() => {
    this.s.lastCommit = `committed ${this.amount}`
  }, 400)

  createTemplate() {
    const div = document.createElement('div')
    const input = document.createElement('input')
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
    DiamondCore.bind(
      out,
      'textContent',
      () => `${this.amount} ${this.s.lastCommit}`
    )
    div.append(input, out)
    return div
  }
}

describe('MoneyForm component (converter pipe + update-on + debounce)', () => {
  let host: HTMLElement
  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
  })
  afterEach(() => vi.useRealTimers())

  it('formats the numeric model as a currency string in the input', async () => {
    const m = new MoneyForm()
    m.mount(host)
    await vi.runAllTimersAsync()
    expect(host.querySelector('input')!.value).toBe('$1,000.00')
  })

  it('samples inbound input on blur (not input) and parses to a number', async () => {
    const m = new MoneyForm()
    m.mount(host)
    await vi.runAllTimersAsync()
    const input = host.querySelector('input')!

    input.value = '$2,500.00'
    input.dispatchEvent(new Event('input'))
    expect(m.amount).toBe(1000) // update-on='blur' → 'input' does not sample

    input.dispatchEvent(new Event('blur'))
    expect(m.amount).toBeCloseTo(2500) // 'blur' samples → parsed
  })

  it('rejects invalid input (model keeps its last good value)', async () => {
    const m = new MoneyForm()
    m.mount(host)
    await vi.runAllTimersAsync()
    const input = host.querySelector('input')!

    input.value = 'not a number'
    input.dispatchEvent(new Event('blur'))
    expect(m.amount).toBe(1000) // ParseResult.fail → no write
  })

  it('debounces the commit side-effect', async () => {
    const m = new MoneyForm()
    m.mount(host)
    await vi.runAllTimersAsync()
    const input = host.querySelector('input')!

    input.value = '$50.00'
    input.dispatchEvent(new Event('blur'))
    await vi.runAllTimersAsync() // advance past the 400ms debounce

    expect(host.querySelector('p')!.textContent).toContain('committed 50')
  })
})
