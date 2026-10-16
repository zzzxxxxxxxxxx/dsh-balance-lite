/**
 * Pill presentation tests.
 *
 * The dot and the label are the whole user-visible contract — the README documents what
 * each colour means — and both are pure functions of the snapshot, so they are driven
 * directly instead of through a render tree this project has no DOM to run.
 *
 * @module dsh-balance-lite/tests/pill-view
 */

import { describe, expect, it } from 'vitest'
import { dotState, duration, pillLabel, type Translate } from '../src/client/pill-view.js'
import type { BalanceSnapshot } from '../src/client/balance-source.js'
import type { BalanceState } from '../src/protocol.js'

/** A translate seat that renders key and params, so each case pins which key was chosen. */
const t: Translate = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)

function stateOf(overrides: Partial<BalanceState> = {}): BalanceState {
  return {
    reading: { currency: 'CNY', total: '47.76', granted: '0.00', toppedUp: '47.76', at: 1_000 },
    isAvailable: true,
    stale: false,
    error: null,
    pollIntervalMs: 15_000,
    serverTime: 1_000,
    ...overrides,
  }
}

function snapshotOf(overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return { state: stateOf(), phase: 'ready', skewMs: 0, ...overrides }
}

describe('dotState', () => {
  it('is green for a fresh reading', () => {
    expect(dotState(snapshotOf())).toBe('done')
  })

  it('is amber once the reading is old, the newest poll failed, or the host never answered', () => {
    expect(dotState(snapshotOf({ state: stateOf({ stale: true }) }))).toBe('warning')
    expect(dotState(snapshotOf({ state: stateOf({ error: { code: 'NETWORK' } }) }))).toBe('warning')
    expect(dotState(snapshotOf({ phase: 'offline' }))).toBe('warning')
  })

  it('is red when there is no number and we know why', () => {
    expect(dotState(snapshotOf({ state: stateOf({ reading: null, error: { code: 'UNAUTHORIZED' } }) }))).toBe('error')
    expect(dotState(snapshotOf({ state: null, phase: 'offline' }))).toBe('error')
  })

  it('is grey only while the first reading is outstanding', () => {
    expect(dotState(snapshotOf({ state: null, phase: 'loading' }))).toBe('ongoing')
  })
})

describe('pillLabel', () => {
  it('shows the platform figure verbatim behind the wallet currency glyph', () => {
    expect(pillLabel(snapshotOf(), t)).toBe('¥47.76')
    const usd = stateOf({ reading: { currency: 'USD', total: '3.20', granted: '0.00', toppedUp: '3.20', at: 1_000 } })
    expect(pillLabel(snapshotOf({ state: usd }), t)).toBe('$3.20')
  })

  it('names a credential the user can fix', () => {
    expect(pillLabel(snapshotOf({ state: stateOf({ reading: null, error: { code: 'MISSING_CREDENTIAL' } }) }), t)).toBe('pill.notConfigured')
    expect(pillLabel(snapshotOf({ state: stateOf({ reading: null, error: { code: 'INVALID_CREDENTIAL' } }) }), t)).toBe('pill.notConfigured')
  })

  it('reports an unreadable balance instead of waiting forever', () => {
    expect(pillLabel(snapshotOf({ state: stateOf({ reading: null, error: { code: 'HTTP' } }) }), t)).toBe('pill.offline')
    // The host itself is unreachable, so no error code ever arrives.
    expect(pillLabel(snapshotOf({ state: null, phase: 'offline' }), t)).toBe('pill.offline')
  })

  it('says it is reading only before the first answer', () => {
    expect(pillLabel(snapshotOf({ state: null, phase: 'loading' }), t)).toBe('pill.loading')
  })
})

describe('duration', () => {
  it('rounds to the coarsest useful unit', () => {
    expect(duration(0, t)).toBe('duration.minutes:{"n":0}')
    expect(duration(90_000, t)).toBe('duration.minutes:{"n":2}')
    expect(duration(90 * 60_000, t)).toBe('duration.hours:{"h":1,"m":30}')
    expect(duration(50 * 3_600_000, t)).toBe('duration.days:{"d":2,"h":2}')
  })

  it('never renders a negative age', () => {
    expect(duration(-5_000, t)).toBe('duration.minutes:{"n":0}')
  })
})
