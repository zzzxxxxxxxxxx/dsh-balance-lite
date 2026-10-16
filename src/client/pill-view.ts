/**
 * The pill's presentation decisions, kept apart from its markup.
 *
 * Label and dot are pure functions of one snapshot, and they are the whole user-visible
 * contract the README documents (what each colour means), so they live here where tests
 * can drive them directly without a DOM.
 *
 * @module dsh-balance-lite/client/pill-view
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BalanceErrorCode, Currency } from '../protocol.js'
import type { BalanceSnapshot } from './balance-source.js'
import { NS } from './locales.js'

/** Translate seat of this namespace. */
export type Translate = PropsLocale<typeof NS>['t']

/** Dot states, matching `StateDot`'s vocabulary without importing its type. */
export type DotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

const MINUTE_MS = 60_000

/** Errors the user can fix by configuring a credential, rather than by waiting. */
const CREDENTIAL_CODES: ReadonlySet<BalanceErrorCode> = new Set<BalanceErrorCode>([
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
])

/** Currency glyph for the wallet's own currency. */
function symbolOf(currency: Currency): string {
  return currency === 'CNY' ? '¥' : '$'
}

/** Render a duration at the coarsest useful granularity. */
export function duration(ms: number, t: Translate): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS))
  if (minutes < 60) return t('duration.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return t('duration.hours', { h: hours, m: minutes % 60 })
  return t('duration.days', { d: Math.floor(hours / 24), h: hours % 24 })
}

/** The pill's text. */
export function pillLabel(snapshot: BalanceSnapshot, t: Translate): string {
  const reading = snapshot.state?.reading ?? null
  if (reading !== null) return `${symbolOf(reading.currency)}${reading.total}`
  const code = snapshot.state?.error?.code
  if (code !== undefined && CREDENTIAL_CODES.has(code)) return t('pill.notConfigured')
  if (code !== undefined || snapshot.phase === 'offline') return t('pill.offline')
  return t('pill.loading')
}

/**
 * Which dot state the pill shows.
 * @param snapshot - the newest snapshot.
 * @returns `error` when there is no number and we know why, `ongoing` while waiting for
 *   the first reading, `warning` when a number is shown but may be old, else `done`.
 *   A transport failure the host never answered counts in both places: no number means
 *   `error`, a stale number means `warning`.
 */
export function dotState(snapshot: BalanceSnapshot): DotState {
  const state = snapshot.state
  const reading = state?.reading ?? null
  if (reading === null) return state?.error != null || snapshot.phase === 'offline' ? 'error' : 'ongoing'
  if (state?.stale === true || state?.error != null) return 'warning'
  return snapshot.phase === 'offline' ? 'warning' : 'done'
}
