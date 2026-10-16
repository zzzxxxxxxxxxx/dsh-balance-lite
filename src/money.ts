/**
 * Decimal-amount validation.
 *
 * Lite performs **no money arithmetic**: the pill shows the platform's own decimal
 * string verbatim, so there is no sum to keep drift-free. This module exists only to
 * decide whether a reported amount is a usable decimal before it is trusted — the
 * account grammar permits exponent forms such as `"0E-16"`, and a wallet whose total
 * does not parse means the response is not the shape this build understands.
 *
 * @module dsh-balance-lite/money
 */

/** Micro-units per currency unit: enough for any decimal the platform reports. */
const MONEY_SCALE = 1_000_000

const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
const MAX_ABS_AMOUNT = 1e12

/**
 * Parse a decimal amount into scaled integer units.
 *
 * The units answer "is this a usable decimal, and is it positive?" — the pill renders the
 * platform's own string — so above `Number.MAX_SAFE_INTEGER / MONEY_SCALE` (about 9e9)
 * integer precision is lost without changing either answer.
 *
 * @param value - the decimal string, as reported by the platform.
 * @returns the amount in scaled units, or null when it is not a finite decimal within
 *   the supported magnitude.
 */
export function parseMoneyUnits(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || !DECIMAL_RE.test(text)) return null
  const amount = Number(text)
  if (!Number.isFinite(amount) || Math.abs(amount) > MAX_ABS_AMOUNT) return null
  return Math.round(amount * MONEY_SCALE)
}
