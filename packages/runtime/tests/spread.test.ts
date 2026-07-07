/**
 * @vitest-environment happy-dom
 *
 * DiamondCore.spread (v2.1, DDR §7.1) — gate FIRST, branch SECOND, reconcile.
 */
import { describe, it, expect, vi } from 'vitest'
import { DiamondCore } from '../src/core'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('DiamondCore.spread', () => {
  it('applies safe keys via the property branch', () => {
    const input = document.createElement('input')
    DiamondCore.spread(input, () => ({ value: 'hi', placeholder: 'Name' }))
    expect(input.value).toBe('hi')
    expect(input.placeholder).toBe('Name')
  })

  it('applies data-*/aria-* via the attribute branch', () => {
    const div = document.createElement('div')
    DiamondCore.spread(div, () => ({ 'data-user-id': 42, 'aria-label': 'row' }))
    expect(div.getAttribute('data-user-id')).toBe('42')
    expect(div.getAttribute('aria-label')).toBe('row')
  })

  it('canonicalizes lowercase-authored safe keys (tabindex → tabIndex)', () => {
    const div = document.createElement('div')
    DiamondCore.spread(div, () => ({ tabindex: 3 }))
    expect(div.tabIndex).toBe(3)
  })

  it('gate FIRST: skips unsafe keys with a warn-once, fails closed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const div = document.createElement('div')
    const state = DiamondCore.reactive({ n: 0 })
    DiamondCore.spread(div, () => {
      void state.n // make the effect re-runnable
      return { innerHTML: '<img src=x onerror=alert(1)>', onclick: 'evil()' }
    })
    expect(div.innerHTML).toBe('')
    expect(div.getAttribute('onclick')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2) // one per key

    warn.mockClear()
    state.n = 1 // re-run the effect
    return tick().then(() => {
      expect(warn).not.toHaveBeenCalled() // warn-once per key
      warn.mockRestore()
    })
  })

  it('rawBind bypasses the gate (developer-owned)', () => {
    const div = document.createElement('div')
    DiamondCore.spread(div, () => ({ innerHTML: '<b>owned</b>' }), true)
    expect(div.innerHTML).toBe('<b>owned</b>')
  })

  it('reacts to value changes on a reactive source', async () => {
    const input = document.createElement('input')
    const state = DiamondCore.reactive({ attrs: { placeholder: 'a' } })
    DiamondCore.spread(input, () => state.attrs)
    expect(input.placeholder).toBe('a')

    state.attrs.placeholder = 'b'
    await tick()
    expect(input.placeholder).toBe('b')
  })

  it('reacts to key ADDITION on a reactive source (ownKeys tracking)', async () => {
    const div = document.createElement('div')
    const state = DiamondCore.reactive({
      attrs: { 'data-a': '1' } as Record<string, unknown>,
    })
    DiamondCore.spread(div, () => state.attrs)
    expect(div.getAttribute('data-a')).toBe('1')

    state.attrs['data-b'] = '2'
    await tick()
    expect(div.getAttribute('data-b')).toBe('2')
  })

  it('reconciles key REMOVAL: attributes removed, properties restored', async () => {
    const input = document.createElement('input')
    input.placeholder = 'original'
    const state = DiamondCore.reactive({
      attrs: { placeholder: 'spread', 'data-x': 'y' } as Record<string, unknown>,
    })
    DiamondCore.spread(input, () => state.attrs)
    expect(input.placeholder).toBe('spread')
    expect(input.getAttribute('data-x')).toBe('y')

    delete state.attrs.placeholder
    delete state.attrs['data-x']
    await tick()
    expect(input.placeholder).toBe('original') // prior property value restored
    expect(input.getAttribute('data-x')).toBeNull() // attribute removed
  })

  it('cleanup stops reactivity', async () => {
    const input = document.createElement('input')
    const state = DiamondCore.reactive({ attrs: { placeholder: 'a' } })
    const cleanup = DiamondCore.spread(input, () => state.attrs)
    cleanup()

    state.attrs.placeholder = 'b'
    await tick()
    expect(input.placeholder).toBe('a')
  })
})
