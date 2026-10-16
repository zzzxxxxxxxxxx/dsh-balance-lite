/**
 * The DeepSeek balance endpoint.
 *
 * One `GET /user/balance` per poll, with the credential resolved per request (so a
 * rotated key reaches the very next poll) and every failure mapped to a stable code the
 * UI can localize. Two rules matter most:
 *
 * - **A failure is never a zero balance.** The caller keeps the previous reading and
 *   marks it stale; fabricating `0` would make a transient network error look like an
 *   empty wallet.
 * - **The credential never leaves this module except as a request header**, and is never
 *   included in a message, log line, or thrown error.
 *
 * @module dsh-balance-lite/balance-api
 */

import type { BalanceErrorCode, Currency } from './protocol.js'
import { parseJson, parseSafeUrl, readCappedBody } from './net.js'
import { parseMoneyUnits } from './money.js'

/** One wallet as reported by the platform. */
export interface WalletEntry {
  readonly currency: Currency
  readonly total: string
  readonly granted: string
  readonly toppedUp: string
}

/** A successful, fully validated balance response. */
export interface BalanceResponse {
  readonly isAvailable: boolean
  /** Non-empty: an empty list is reported as {@link BalanceErrorCode} `NO_WALLET`. */
  readonly wallets: readonly [WalletEntry, ...WalletEntry[]]
}

/** A balance failure carrying its machine code. */
export class BalanceRequestError extends Error {
  constructor(readonly code: BalanceErrorCode, message: string) {
    super(message)
    this.name = 'BalanceRequestError'
  }
}

/** Endpoint and limits for one poll. */
export interface BalanceApiConfig {
  /** Validated origin, e.g. `https://api.deepseek.com`. */
  readonly origin: string
  /** Endpoint path, e.g. `/user/balance`. */
  readonly path: string
  readonly timeoutMs: number
  /** Whether a loopback `http://` origin is acceptable; mirrors the plugin config. */
  readonly allowLoopbackHttp?: boolean
  /** Response size cap; defaults to 64 KiB. */
  readonly maxBytes?: number
}

/** Injectable transport and lifetime signal. */
export interface BalanceFetchDeps {
  readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
  readonly signal: AbortSignal
}

const DEFAULT_MAX_BYTES = 64 * 1024

/**
 * Validate a resolved credential value for use as a header.
 *
 * @param raw - the resolved value.
 * @param ref - the credential reference name, used in the message only.
 * @returns the trimmed key.
 * @throws {BalanceRequestError} with `INVALID_CREDENTIAL` for a blank or header-unsafe
 *   value. The message names the reference, never the value.
 */
export function assertUsableApiKey(raw: string, ref: string): string {
  const key = raw.trim()
  if (key === '') {
    throw new BalanceRequestError('INVALID_CREDENTIAL', `dsh-balance-lite: ${ref} is empty`)
  }
  // Header values are latin-1; anything outside printable ASCII would be corrupted in
  // transit rather than rejected by the server, so refuse it up front.
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new BalanceRequestError(
      'INVALID_CREDENTIAL',
      `dsh-balance-lite: ${ref} contains characters that cannot be sent as a header value`,
    )
  }
  return key
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a balance payload.
 * @param payload - the parsed body.
 * @returns the validated wallets and availability.
 * @throws {BalanceRequestError} with `PROTOCOL` when a required field is missing or
 *   malformed, or `NO_WALLET` when the list is empty.
 */
export function parseBalancePayload(payload: unknown): BalanceResponse {
  if (!isRecord(payload)) {
    throw new BalanceRequestError('PROTOCOL', 'dsh-balance-lite: balance response is not an object')
  }
  if (typeof payload.is_available !== 'boolean') {
    throw new BalanceRequestError('PROTOCOL', 'dsh-balance-lite: balance response has no boolean is_available')
  }
  const infos = payload.balance_infos
  if (!Array.isArray(infos)) {
    throw new BalanceRequestError('PROTOCOL', 'dsh-balance-lite: balance response has no balance_infos array')
  }
  const wallets: WalletEntry[] = []
  for (const [index, entry] of infos.entries()) {
    if (!isRecord(entry)) {
      throw new BalanceRequestError('PROTOCOL', `dsh-balance-lite: balance_infos[${index}] is not an object`)
    }
    const currency = entry.currency
    if (currency !== 'CNY' && currency !== 'USD') {
      throw new BalanceRequestError('PROTOCOL', `dsh-balance-lite: balance_infos[${index}] has an unknown currency`)
    }
    const total = entry.total_balance
    if (parseMoneyUnits(total) === null) {
      throw new BalanceRequestError('PROTOCOL', `dsh-balance-lite: balance_infos[${index}] has no usable total_balance`)
    }
    const granted = parseMoneyUnits(entry.granted_balance) === null ? '0.00' : (entry.granted_balance as string)
    const toppedUp = parseMoneyUnits(entry.topped_up_balance) === null ? '0.00' : (entry.topped_up_balance as string)
    wallets.push({ currency, total: total as string, granted, toppedUp })
  }
  const [first, ...rest] = wallets
  if (first === undefined) {
    throw new BalanceRequestError('NO_WALLET', 'dsh-balance-lite: the platform reported no wallet entries')
  }
  return { isAvailable: payload.is_available, wallets: [first, ...rest] }
}

/**
 * Fetch and validate the current balance.
 *
 * @param deps - transport and lifetime signal.
 * @param config - endpoint and limits.
 * @param apiKey - the resolved credential, sent only as an authorization header.
 * @returns the validated response.
 * @throws {BalanceRequestError} for every failure mode, with a stable code.
 */
export async function fetchBalance(
  deps: BalanceFetchDeps,
  config: BalanceApiConfig,
  apiKey: string,
): Promise<BalanceResponse> {
  let url: URL
  try {
    url = parseSafeUrl(`${config.origin.replace(/\/$/, '')}${config.path}`, {
      allowLoopbackHttp: config.allowLoopbackHttp === true,
    })
  } catch (error) {
    // Every failure in this function is a coded one, and a rejected URL is a protocol
    // mismatch between the configured endpoint and what this build accepts.
    throw new BalanceRequestError('PROTOCOL', (error as Error).message)
  }
  const timeout = AbortSignal.timeout(config.timeoutMs)
  let response: Response
  try {
    response = await deps.fetchImpl(url.href, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      // A credential-bearing request must never be replayed against a redirect target.
      redirect: 'error',
      signal: AbortSignal.any([deps.signal, timeout]),
    })
  } catch (error) {
    if (timeout.aborted) {
      throw new BalanceRequestError('TIMEOUT', `dsh-balance-lite: balance request timed out after ${config.timeoutMs}ms`)
    }
    throw new BalanceRequestError('NETWORK', `dsh-balance-lite: balance request produced no response: ${(error as Error).name}`)
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new BalanceRequestError('UNAUTHORIZED', `dsh-balance-lite: the platform rejected the credential (HTTP ${response.status})`)
    }
    throw new BalanceRequestError('HTTP', `dsh-balance-lite: balance request answered HTTP ${response.status}`)
  }
  let text: string
  try {
    text = await readCappedBody(response, config.maxBytes ?? DEFAULT_MAX_BYTES)
  } catch (error) {
    throw new BalanceRequestError('PROTOCOL', `dsh-balance-lite: could not read the balance response: ${(error as Error).message}`)
  }
  const payload = parseJson(text)
  if (payload === undefined) {
    throw new BalanceRequestError('PROTOCOL', 'dsh-balance-lite: balance response is not JSON')
  }
  return parseBalancePayload(payload)
}

/**
 * Select the wallet to display under the configured preference.
 *
 * `auto` prefers a funded CNY wallet, then a funded USD one, then the first entry, which
 * keeps the common single-currency case obvious and never silently switches currency on a
 * zero balance. A preference the account does not hold at all falls back the same way
 * rather than blanking the pill.
 *
 * @param wallets - validated wallets, in platform order.
 * @param preference - configured preference.
 * @returns the selected wallet.
 */
export function selectWallet(
  wallets: readonly [WalletEntry, ...WalletEntry[]],
  preference: 'auto' | Currency,
): WalletEntry {
  const hasFunds = (wallet: WalletEntry): boolean => (parseMoneyUnits(wallet.total) ?? 0) > 0
  if (preference === 'auto') {
    return wallets.find(wallet => wallet.currency === 'CNY' && hasFunds(wallet))
      ?? wallets.find(wallet => wallet.currency === 'USD' && hasFunds(wallet))
      ?? wallets[0]
  }
  return wallets.find(wallet => wallet.currency === preference)
    ?? wallets.find(hasFunds)
    ?? wallets[0]
}
