/**
 * Browser polling-source tests.
 *
 * Transport, clock, timers and visibility are injected, so these run without a DOM and
 * without a host. The behaviour under test is what the user sees when the host restarts:
 * the last good snapshot must survive a failed poll.
 *
 * @module dsh-balance-lite/tests/balance-source
 */

import { describe, expect, it, vi } from 'vitest'
import { createBalanceSource } from '../src/client/balance-source.js'
import type { BalanceSourceOptions } from '../src/client/balance-source.js'
import type { BalanceState } from '../src/protocol.js'

const STATE: BalanceState = {
  reading: { currency: 'CNY', total: '47.76', granted: '0.00', toppedUp: '47.76', at: 1_000 },
  isAvailable: true,
  stale: false,
  error: null,
  pollIntervalMs: 15_000,
  serverTime: 1_000,
}

/** A source wired to a manual timer queue and a controllable clock. */
function harness(handler: (input: string) => Promise<Response>, overrides: Partial<BalanceSourceOptions> = {}) {
  const timers = new Map<number, { run: () => void; ms: number }>()
  const visibility = new Set<() => void>()
  let nextId = 1
  let hidden = false
  let clock = 1_000_000

  const calls: string[] = []
  const source = createBalanceSource({
    fetchImpl: (input) => {
      calls.push(String(input))
      return handler(String(input))
    },
    now: () => clock,
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      visibility.add(listener)
      return () => { visibility.delete(listener) }
    },
    setTimer: (listener, ms) => {
      const id = nextId++
      timers.set(id, { run: listener, ms })
      return id
    },
    clearTimer: (handle) => { timers.delete(Number(handle)) },
    baseUrl: () => 'http://host.test',
    ...overrides,
  })

  return {
    source,
    calls,
    timers,
    /** Run every pending timer once. */
    async runTimers(): Promise<void> {
      const pending = [...timers.values()]
      timers.clear()
      for (const timer of pending) timer.run()
      await flush()
    },
    setHidden(value: boolean) { hidden = value },
    notifyVisibility(): void {
      for (const listener of [...visibility]) listener()
    },
    setClock(value: number) { clock = value },
  }
}

/** Yield enough microtask turns for the poll's awaits to settle. */
async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createBalanceSource', () => {
  it('polls on the first subscriber and publishes a validated snapshot', async () => {
    const test = harness(async () => jsonResponse(STATE))
    const unsubscribe = test.source.subscribe(() => undefined)
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('ready') })
    const snapshot = test.source.getSnapshot()
    expect(test.calls[0]).toBe('http://host.test/dsh-balance-lite/state')
    expect(snapshot.state?.reading?.total).toBe('47.76')
    expect(snapshot.skewMs).toBe(1_000 - 1_000_000)
    unsubscribe()
    expect(test.timers.size).toBe(0)
    test.source.dispose()
  })

  it('keeps the last good snapshot when the response is malformed', async () => {
    let body: unknown = STATE
    const test = harness(async () => jsonResponse(body))
    const unsubscribe = test.source.subscribe(() => undefined)
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('ready') })
    body = { nonsense: true }
    await test.runTimers()
    const snapshot = test.source.getSnapshot()
    expect(snapshot.phase).toBe('offline')
    // The valuable part: the number stays on screen instead of blanking out.
    expect(snapshot.state?.reading?.total).toBe('47.76')
    unsubscribe()
    test.source.dispose()
  })

  it('marks the source offline on an error status', async () => {
    const test = harness(async () => new Response('nope', { status: 500 }))
    const unsubscribe = test.source.subscribe(() => undefined)
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('offline') })
    expect(test.source.getSnapshot().state).toBeNull()
    unsubscribe()
    test.source.dispose()
  })

  it('does not spend a request while the document is hidden', async () => {
    const test = harness(async () => jsonResponse(STATE))
    test.setHidden(true)
    const unsubscribe = test.source.subscribe(() => undefined)
    await flush()
    expect(test.calls).toHaveLength(0)
    expect(test.timers.size).toBe(1)
    unsubscribe()
    test.source.dispose()
  })

  it('polls immediately when the page becomes visible again', async () => {
    const test = harness(async () => jsonResponse(STATE))
    test.setHidden(true)
    const unsubscribe = test.source.subscribe(() => undefined)
    await flush()
    expect(test.calls).toHaveLength(0)
    test.setHidden(false)
    test.notifyVisibility()
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('ready') })
    expect(test.calls).toHaveLength(1)
    unsubscribe()
    test.source.dispose()
  })

  it('follows the cadence the host reports', async () => {
    const test = harness(async () => jsonResponse({ ...STATE, pollIntervalMs: 42_000 }))
    const unsubscribe = test.source.subscribe(() => undefined)
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('ready') })
    expect([...test.timers.values()][0]?.ms).toBe(42_000)
    unsubscribe()
    test.source.dispose()
  })

  it('stops polling after the last unsubscribe', async () => {
    const test = harness(async () => jsonResponse(STATE))
    const first = test.source.subscribe(() => undefined)
    const second = test.source.subscribe(() => undefined)
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('ready') })
    first()
    await test.runTimers()
    const afterFirst = test.calls.length
    expect(afterFirst).toBeGreaterThanOrEqual(2)
    second()
    await test.runTimers()
    expect(test.calls.length).toBe(afterFirst)
    test.source.dispose()
  })

  it('does not restart polling when the page becomes visible after the last unsubscribe', async () => {
    const test = harness(async () => jsonResponse(STATE))
    const unsubscribe = test.source.subscribe(() => undefined)
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('ready') })
    unsubscribe()
    await flush()
    const afterUnsubscribe = test.calls.length
    // The pill unmounts while the plugin stays loaded, so the visibility listener is still
    // attached and used to start an unwatched poll loop here.
    test.notifyVisibility()
    await flush()
    expect(test.calls.length).toBe(afterUnsubscribe)
    expect(test.timers.size).toBe(0)
    test.source.dispose()
  })

  it('does not reschedule when the last subscriber leaves while a snapshot is publishing', async () => {
    const test = harness(async () => jsonResponse(STATE))
    let unsubscribe: () => void = () => undefined
    unsubscribe = test.source.subscribe(() => { unsubscribe() })
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('ready') })
    await flush()
    expect(test.timers.size).toBe(0)
    test.source.dispose()
  })

  it('stays inert when a subscriber arrives after dispose', async () => {
    const test = harness(async () => jsonResponse(STATE))
    test.source.dispose()
    // A smoke test of the public behaviour, not a pin on any single guard: a disposed
    // source has no timer and no controller to restart, so several guards agree here.
    const unsubscribe = test.source.subscribe(() => undefined)
    await flush()
    expect(test.calls).toHaveLength(0)
    expect(test.timers.size).toBe(0)
    expect(() => unsubscribe()).not.toThrow()
  })

  it('contains a throwing subscriber', async () => {
    const test = harness(async () => jsonResponse(STATE))
    const unsubscribeBad = test.source.subscribe(() => { throw new Error('boom') })
    let notified = 0
    const unsubscribeGood = test.source.subscribe(() => { notified += 1 })
    await vi.waitFor(() => { expect(test.source.getSnapshot().phase).toBe('ready') })
    expect(notified).toBeGreaterThan(0)
    unsubscribeBad()
    unsubscribeGood()
    test.source.dispose()
  })
})
