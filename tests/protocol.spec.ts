/**
 * Wire-validation tests.
 *
 * The browser half keeps its previous snapshot whenever this parser refuses a body, so
 * every rejection arm is user-visible: a body it mis-accepts freezes a stale number, and
 * one it wrongly rejects can blank the pill.
 *
 * @module dsh-balance-lite/tests/protocol
 */

import { describe, expect, it } from 'vitest'
import { parseBalanceState, STATE_PATH, type BalanceState } from '../src/protocol.js'

const VALID: BalanceState = {
  reading: { currency: 'CNY', total: '47.76', granted: '0.00', toppedUp: '47.76', at: 1_000 },
  isAvailable: true,
  stale: false,
  error: null,
  pollIntervalMs: 15_000,
  serverTime: 1_000,
}

/** A complete body; each case below breaks exactly one thing. */
function body(overrides: Record<string, unknown> = {}): unknown {
  return { ...VALID, ...overrides }
}

describe('parseBalanceState', () => {
  it('accepts the host snapshot', () => {
    expect(parseBalanceState(VALID)).toEqual(VALID)
  })

  it('accepts a snapshot that has no reading yet', () => {
    const parsed = parseBalanceState(body({ reading: null, isAvailable: null, error: { code: 'MISSING_CREDENTIAL' } }))
    expect(parsed?.reading).toBeNull()
    expect(parsed?.error?.code).toBe('MISSING_CREDENTIAL')
  })

  it('accepts every code in the vocabulary', () => {
    for (const code of ['MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'UNAUTHORIZED', 'NETWORK', 'TIMEOUT', 'HTTP', 'PROTOCOL', 'NO_WALLET']) {
      expect(parseBalanceState(body({ reading: null, isAvailable: null, error: { code } }))?.error?.code, code).toBe(code)
    }
  })

  it('refuses anything that is not an object', () => {
    for (const value of [null, undefined, [], 'state', 7, true]) {
      expect(parseBalanceState(value), JSON.stringify(value) ?? 'undefined').toBeNull()
    }
  })

  it('refuses a malformed reading', () => {
    for (const reading of [
      { currency: 'EUR', total: '1.00', granted: '0.00', toppedUp: '0.00', at: 1 },
      { currency: 'CNY', total: 1, granted: '0.00', toppedUp: '0.00', at: 1 },
      { currency: 'CNY', total: '1.00', granted: '0.00', toppedUp: '0.00', at: Number.NaN },
      { currency: 'CNY', total: '1.00', granted: '0.00', toppedUp: '0.00' },
      'reading',
    ]) {
      expect(parseBalanceState(body({ reading })), JSON.stringify(reading)).toBeNull()
    }
  })

  it('refuses a body whose remaining fields are malformed', () => {
    expect(parseBalanceState(body({ isAvailable: 'yes' }))).toBeNull()
    expect(parseBalanceState(body({ stale: 'no' }))).toBeNull()
    expect(parseBalanceState(body({ serverTime: 'now' }))).toBeNull()
    expect(parseBalanceState(body({ pollIntervalMs: 0 }))).toBeNull()
    expect(parseBalanceState(body({ pollIntervalMs: Number.POSITIVE_INFINITY }))).toBeNull()
    expect(parseBalanceState(body({ pollIntervalMs: '15000' }))).toBeNull()
  })

  it('refuses an error outside the code vocabulary', () => {
    expect(parseBalanceState(body({ error: { code: 'WAT' } }))).toBeNull()
    expect(parseBalanceState(body({ error: 'offline' }))).toBeNull()
    // The host always sends the field, so an absent one is not this build's body.
    expect(parseBalanceState(body({ error: undefined }))).toBeNull()
  })
})

describe('STATE_PATH', () => {
  it('is namespaced per plugin, so it cannot collide with a sibling balance plugin', () => {
    expect(STATE_PATH).toBe('/dsh-balance-lite/state')
  })
})
