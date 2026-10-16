/**
 * The wire contract between the two halves.
 *
 * One small snapshot travels in one direction: the host owns the credential, the polling
 * and every decision about freshness, and the browser half only renders what it is given.
 * `stale` and `isAvailable` are therefore computed host-side rather than re-derived from
 * timestamps in the page, so there is a single source of truth.
 *
 * The route path is namespaced per plugin: registering the same `(kind, path)` twice is a
 * composition error, so this must not collide with a sibling balance plugin's route.
 *
 * @module dsh-balance-lite/protocol
 */

/** Exact route the browser reads the snapshot from. */
export const STATE_PATH = '/dsh-balance-lite/state'

/** Wallet currencies the platform reports. */
export type Currency = 'CNY' | 'USD'

/**
 * Stable failure codes.
 *
 * Every failure mode maps to one of these so the pill can localize a message without
 * parsing an error string, and so "we could not read the balance" is never confused with
 * "the balance is zero".
 */
export type BalanceErrorCode =
  /** No credential resolved for the configured reference. */
  | 'MISSING_CREDENTIAL'
  /** The resolved value cannot be sent as a header value. */
  | 'INVALID_CREDENTIAL'
  /** The platform rejected the credential (HTTP 401/403). */
  | 'UNAUTHORIZED'
  /** The request produced no response at all. */
  | 'NETWORK'
  /** The request exceeded `requestTimeoutMs`. */
  | 'TIMEOUT'
  /** The platform answered a non-success status other than 401/403. */
  | 'HTTP'
  /** The response was not the shape this build understands. */
  | 'PROTOCOL'
  /** The response carried no wallet entries. */
  | 'NO_WALLET'

/** One successfully read balance. */
export interface BalanceReading {
  /** Currency of the selected wallet. */
  readonly currency: Currency
  /** Total balance, exactly as the platform wrote it (a two-decimal string). */
  readonly total: string
  /** Granted (promotional) balance as reported. */
  readonly granted: string
  /** Topped-up balance as reported. */
  readonly toppedUp: string
  /** Host clock at the moment the reading was taken. */
  readonly at: number
}

/** The host's whole view, as the browser receives it. */
export interface BalanceState {
  /** The newest successful reading, or null before the first one. */
  readonly reading: BalanceReading | null
  /** The platform's own `is_available`; null until a reading arrives. */
  readonly isAvailable: boolean | null
  /** Whether the newest reading is older than the configured freshness bound. */
  readonly stale: boolean
  /** The newest failure, cleared by the next success. */
  readonly error: { readonly code: BalanceErrorCode } | null
  /** Host polling cadence, so the page follows it instead of hard-coding one. */
  readonly pollIntervalMs: number
  /** Host clock at serialization, for turning `reading.at` into an age. */
  readonly serverTime: number
}

const ERROR_CODES: ReadonlySet<string> = new Set(Object.keys({
  MISSING_CREDENTIAL: true,
  INVALID_CREDENTIAL: true,
  UNAUTHORIZED: true,
  NETWORK: true,
  TIMEOUT: true,
  HTTP: true,
  PROTOCOL: true,
  NO_WALLET: true,
} satisfies Record<BalanceErrorCode, true>))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asReading(value: unknown): BalanceReading | null {
  if (!isRecord(value)) return null
  const { currency, total, granted, toppedUp, at } = value
  if (currency !== 'CNY' && currency !== 'USD') return null
  if (typeof total !== 'string' || typeof granted !== 'string' || typeof toppedUp !== 'string') return null
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  return { currency, total, granted, toppedUp, at }
}

/**
 * Validate a snapshot received from the host.
 *
 * The browser half cannot trust the transport, and a snapshot it cannot understand must
 * leave the previous one on screen rather than blanking the pill, so an unrecognized body
 * is reported as null.
 *
 * @param value - the parsed JSON body.
 * @returns the validated snapshot, or null when the shape is not this build's.
 */
export function parseBalanceState(value: unknown): BalanceState | null {
  if (!isRecord(value)) return null
  const reading = value.reading === null ? null : asReading(value.reading)
  if (value.reading !== null && reading === null) return null
  if (typeof value.isAvailable !== 'boolean' && value.isAvailable !== null) return null
  if (typeof value.stale !== 'boolean') return null
  const rawError = value.error
  let error: { code: BalanceErrorCode } | null = null
  if (rawError !== null) {
    if (!isRecord(rawError) || typeof rawError.code !== 'string' || !ERROR_CODES.has(rawError.code)) return null
    error = { code: rawError.code as BalanceErrorCode }
  }
  if (typeof value.pollIntervalMs !== 'number' || !Number.isFinite(value.pollIntervalMs) || value.pollIntervalMs <= 0) return null
  if (typeof value.serverTime !== 'number' || !Number.isFinite(value.serverTime)) return null
  return {
    reading,
    isAvailable: value.isAvailable as boolean | null,
    stale: value.stale,
    error,
    pollIntervalMs: value.pollIntervalMs,
    serverTime: value.serverTime,
  }
}
