/**
 * Decimal-validation tests.
 *
 * Lite does no money arithmetic, so the only contract here is which platform strings
 * count as a usable amount — the account grammar permits forms such as `0E-16` that a
 * naive `parseFloat` check would wave through with a different meaning.
 *
 * @module dsh-balance-lite/tests/money
 */

import { describe, expect, it } from 'vitest'
import { parseMoneyUnits } from '../src/money.js'

describe('parseMoneyUnits', () => {
  it('accepts the decimal forms the platform sends', () => {
    expect(parseMoneyUnits('47.76')).toBe(47_760_000)
    expect(parseMoneyUnits('0.00')).toBe(0)
    expect(parseMoneyUnits('110')).toBe(110_000_000)
    expect(parseMoneyUnits('5.0000000000000000')).toBe(5_000_000)
    // The account grammar allows an omitted integer or fraction part and an exponent.
    expect(parseMoneyUnits('0E-16')).toBe(0)
    expect(parseMoneyUnits('.5')).toBe(500_000)
    expect(parseMoneyUnits('-1.25')).toBe(-1_250_000)
    expect(parseMoneyUnits('  3.5  ')).toBe(3_500_000)
  })

  it('keeps the magnitude bound and reports the precision edge honestly', () => {
    expect(parseMoneyUnits('1e12')).toBe(1e18)
    expect(parseMoneyUnits('1000000000000.5')).toBeNull()
    // Above Number.MAX_SAFE_INTEGER / MONEY_SCALE the units stop being exact integers.
    // They stay a validity and sign probe, which is all any caller uses them for.
    expect(Number.isSafeInteger(parseMoneyUnits('999999999999.99'))).toBe(false)
  })

  it('rejects anything that is not a finite decimal', () => {
    for (const value of ['', 'abc', '1,5', 'NaN', 'Infinity', '1e999', null, 47.76, undefined, {}, []]) {
      expect(parseMoneyUnits(value), JSON.stringify(value)).toBeNull()
    }
  })
})
