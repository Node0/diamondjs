/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiamondCore } from '../src/core'
import { reactive } from '../src/decorators'

describe('reactive decorator', () => {
  it('should be a function', () => {
    expect(typeof reactive).toBe('function')
  })
})

describe('reactive legacy decorator (experimentalDecorators path)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should define reactive getter/setter on prototype', () => {
    const proto = {} as Record<string, unknown>
    // Simulate legacy decorator call: reactive(target, propertyKey)
    ;(reactive as (target: object, key: string) => void)(proto, 'count')

    const descriptor = Object.getOwnPropertyDescriptor(proto, 'count')
    expect(descriptor).toBeDefined()
    expect(typeof descriptor!.get).toBe('function')
    expect(typeof descriptor!.set).toBe('function')
  })

  it('should store and retrieve initial values', () => {
    const proto = {} as Record<string, unknown>
    ;(reactive as (target: object, key: string) => void)(proto, 'count')

    // Create an instance that inherits from proto
    const instance = Object.create(proto)
    instance.count = 42
    expect(instance.count).toBe(42)
  })

  it('should return undefined before first assignment', () => {
    const proto = {} as Record<string, unknown>
    ;(reactive as (target: object, key: string) => void)(proto, 'name')

    const instance = Object.create(proto)
    expect(instance.name).toBeUndefined()
  })

  it('should trigger effects when property changes', async () => {
    const proto = {} as Record<string, unknown>
    ;(reactive as (target: object, key: string) => void)(proto, 'count')

    const instance = Object.create(proto)
    instance.count = 0

    const effectFn = vi.fn(() => instance.count)
    DiamondCore.effect(effectFn)
    expect(effectFn).toHaveBeenCalledTimes(1)

    instance.count = 5
    await vi.runAllTimersAsync()
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should support multiple reactive properties on same prototype', () => {
    const proto = {} as Record<string, unknown>
    ;(reactive as (target: object, key: string) => void)(proto, 'name')
    ;(reactive as (target: object, key: string) => void)(proto, 'age')

    const instance = Object.create(proto)
    instance.name = 'Alice'
    instance.age = 30

    expect(instance.name).toBe('Alice')
    expect(instance.age).toBe(30)
  })

  it('should isolate reactivity between instances', () => {
    const proto = {} as Record<string, unknown>
    ;(reactive as (target: object, key: string) => void)(proto, 'count')

    const a = Object.create(proto)
    const b = Object.create(proto)

    a.count = 1
    b.count = 2

    expect(a.count).toBe(1)
    expect(b.count).toBe(2)
  })
})

describe('DiamondCore.makeReactive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should wrap object values in reactive proxy', () => {
    const target = { profile: { name: 'Alice' } } as Record<string, unknown>
    DiamondCore.makeReactive(target, 'profile')

    // The profile should now be reactive — effects should track it
    const effect = vi.fn(() => (target.profile as Record<string, unknown>).name)
    DiamondCore.effect(effect)
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('should be a no-op for primitive values', () => {
    const target = { count: 42 } as Record<string, unknown>
    DiamondCore.makeReactive(target, 'count')

    // Value should remain unchanged
    expect(target.count).toBe(42)
  })

  it('should be a no-op for null values', () => {
    const target = { data: null } as Record<string, unknown>
    DiamondCore.makeReactive(target, 'data')

    expect(target.data).toBeNull()
  })

  it('should make object properties trackable by effects', async () => {
    const target = { state: { count: 0 } } as Record<string, unknown>
    DiamondCore.makeReactive(target, 'state')

    const state = target.state as Record<string, number>
    const effect = vi.fn(() => state.count)

    DiamondCore.effect(effect)
    expect(effect).toHaveBeenCalledTimes(1)

    state.count = 5
    await vi.runAllTimersAsync()

    expect(effect).toHaveBeenCalledTimes(2)
  })
})
