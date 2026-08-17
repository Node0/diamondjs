/**
 * @vitest-environment happy-dom
 *
 * Detached-branch disposal probe (§16 D-1 → A3: detached means disposed).
 *
 * Recreated from the v2.1 recon record (the original probe was untracked and
 * lost); its three failing assertions against the shipped v2.1 runtime are the
 * acceptance criteria for the D-1 fix. The two control tests establish the
 * boundary: repeat and captureScope teardown were always correct — the defect
 * was scoped exactly to the if/switch toggle path, where the branch cache
 * detached nodes without invoking their captured cleanup.
 */
import { describe, it, expect } from 'vitest'
import { DiamondCore } from '../src/core'

// Flush the scheduler's microtask queue (reactive updates are batched).
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('detached-branch disposal', () => {
  function setup() {
    const host = document.createElement('div')
    const anchor = document.createComment('x')
    host.appendChild(anchor)
    return { host, anchor }
  }

  it('switch: does a toggled-off branch still re-run its effects?', async () => {
    const state = DiamondCore.reactive({ mode: 'a', label: 0 })
    const { anchor } = setup()
    let reads = 0

    DiamondCore.switch(anchor, () => state.mode, [
      {
        match: (v) => v === 'a',
        make: () => {
          const s = document.createElement('span')
          DiamondCore.bind(s, 'textContent', () => {
            reads++
            return state.label
          })
          return s
        },
      },
      { match: (v) => v === 'b', make: () => document.createElement('em') },
    ])
    await tick()
    const afterBuild = reads

    state.mode = 'b' // detach the 'a' branch
    await tick()
    const afterDetach = reads

    state.label = 99 // mutate what only the hidden branch reads
    await tick()
    const hiddenReads = reads

    expect(afterDetach).toBe(afterBuild)
    expect(hiddenReads).toBe(afterDetach)
  })

  it('if: does a toggled-off branch still re-run its effects?', async () => {
    const state = DiamondCore.reactive({ show: true, label: 0 })
    const { anchor } = setup()
    let reads = 0

    DiamondCore.if(anchor, [
      {
        when: () => state.show,
        make: () => {
          const s = document.createElement('span')
          DiamondCore.bind(s, 'textContent', () => {
            reads++
            return state.label
          })
          return s
        },
      },
    ])
    await tick()

    state.show = false // detach the branch
    await tick()
    const afterDetach = reads

    state.label = 99 // mutate what only the hidden branch reads
    await tick()
    const hiddenReads = reads

    expect(hiddenReads).toBe(afterDetach)
  })

  it('SEVERITY: does a detached branch keep doing real DOM work?', async () => {
    const list = DiamondCore.collection([{ id: 0 }], { key: (c) => c.id })
    const state = DiamondCore.reactive({ show: true })
    const { anchor } = setup()
    let rowBuilds = 0

    DiamondCore.if(anchor, [
      {
        when: () => state.show,
        make: () => {
          const ul = document.createElement('ul')
          const rAnchor = document.createComment('repeat')
          ul.appendChild(rAnchor)
          DiamondCore.repeat(rAnchor, () => list, () => {
            rowBuilds++
            return document.createElement('li')
          })
          return ul
        },
      },
    ])
    await tick()

    state.show = false // detach the branch containing the repeat
    await tick()
    const afterDetach = rowBuilds

    for (let i = 1; i < 50; i++) {
      list.push({ id: i }) // 49 mutations while hidden
      await tick()
    }
    const hiddenBuilds = rowBuilds

    console.log(
      `[severity] row builds after detach=${afterDetach}, after 49 hidden pushes=${hiddenBuilds}`
    )
    expect(hiddenBuilds).toBe(afterDetach)
  })

  it('repeat: does a removed row still re-run its effects? (control — repeat disposes)', async () => {
    const state = DiamondCore.reactive({
      items: [{ name: 'x' }] as Array<{ name: string }>,
    })
    const host = document.createElement('ul')
    const anchor = document.createComment('repeat')
    host.appendChild(anchor)
    let reads = 0

    DiamondCore.repeat(anchor, () => state.items, (item) => {
      const li = document.createElement('li')
      DiamondCore.bind(li, 'textContent', () => {
        reads++
        return item.name
      })
      return li
    })
    await tick()
    const removedItem = state.items[0]

    state.items = [] // remove the row
    await tick()
    const afterRemove = reads

    removedItem.name = 'mutated' // mutate the removed item's property
    await tick()
    const afterMutation = reads

    console.log(
      `[repeat]   reads after remove=${afterRemove}, after mutation=${afterMutation}`
    )
    expect(afterMutation).toBe(afterRemove)
  })

  it('teardown: does containing-scope cleanup dispose branches? (control — teardown disposes)', async () => {
    const state = DiamondCore.reactive({ show: true, label: 0 })
    const { anchor } = setup()
    let reads = 0

    const { cleanup } = DiamondCore.captureScope(() => {
      DiamondCore.if(anchor, [
        {
          when: () => state.show,
          make: () => {
            const s = document.createElement('span')
            DiamondCore.bind(s, 'textContent', () => {
              reads++
              return state.label
            })
            return s
          },
        },
      ])
    })
    await tick()

    cleanup() // containing-scope teardown (the unmount() path)
    const afterCleanup = reads

    state.label = 99
    await tick()
    const afterMutation = reads

    console.log(
      `[teardown] reads after cleanup=${afterCleanup}, after mutation=${afterMutation}`
    )
    expect(afterMutation).toBe(afterCleanup)
  })
})
