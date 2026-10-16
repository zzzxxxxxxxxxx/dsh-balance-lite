/**
 * Balance-endpoint tests.
 *
 * The two properties worth guarding are that a failure is never reported as a zero
 * balance, and that the credential only ever appears as an authorization header.
 *
 * @module dsh-balance-lite/tests/balance-api
 */

import { describe, expect, it, vi } from 'vitest'
import {
  BalanceRequestError,
  assertUsableApiKey,
  fetchBalance,
  parseBalancePayload,
  selectWallet,
  type WalletEntry,
} from '../src/balance-api.js'
import { parseSafeOrigin, parseSafeUrl } from '../src/net.js'

const CANARY = 'sk-canary-must-not-leak-0123456789'

function payload(overrides: Record<string, unknown> = {}): unknown {
  return {
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '47.76', granted_balance: '0.00', topped_up_balance: '47.76' },
    ],
    ...overrides,
  }
}

/** Capture the error code a call rejects with. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return error instanceof BalanceRequestError ? error.code : `not-a-coded-error:${String(error)}`
  }
  return 'resolved'
}

const DEPS = { fetchImpl: async () => new Response('{}', { status: 200 }), signal: new AbortController().signal }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('parseBalancePayload', () => {
  it('accepts the platform shape', () => {
    const parsed = parseBalancePayload(payload())
    expect(parsed.isAvailable).toBe(true)
    expect(parsed.wallets).toEqual([
      { currency: 'CNY', total: '47.76', granted: '0.00', toppedUp: '47.76' },
    ])
  })

  it('defaults optional balances the platform omits', () => {
    const parsed = parseBalancePayload({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '3.20' }],
    })
    expect(parsed.wallets[0]).toEqual({ currency: 'USD', total: '3.20', granted: '0.00', toppedUp: '0.00' })
  })

  it('rejects every shape it does not understand', async () => {
    expect(await codeOf(async () => parseBalancePayload(null))).toBe('PROTOCOL')
    expect(await codeOf(async () => parseBalancePayload([]))).toBe('PROTOCOL')
    expect(await codeOf(async () => parseBalancePayload({ balance_infos: [] }))).toBe('PROTOCOL')
    expect(await codeOf(async () => parseBalancePayload(payload({ is_available: 'yes' })))).toBe('PROTOCOL')
    expect(await codeOf(async () => parseBalancePayload(payload({ balance_infos: {} })))).toBe('PROTOCOL')
    expect(await codeOf(async () => parseBalancePayload({ is_available: true, balance_infos: ['x'] }))).toBe('PROTOCOL')
    expect(await codeOf(async () => parseBalancePayload({
      is_available: true,
      balance_infos: [{ currency: 'EUR', total_balance: '1.00' }],
    }))).toBe('PROTOCOL')
    expect(await codeOf(async () => parseBalancePayload({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: 'lots' }],
    }))).toBe('PROTOCOL')
  })

  it('reports an empty wallet list rather than a zero balance', async () => {
    expect(await codeOf(async () => parseBalancePayload({ is_available: true, balance_infos: [] }))).toBe('NO_WALLET')
  })
})

describe('assertUsableApiKey', () => {
  it('trims a usable key', () => {
    expect(assertUsableApiKey(`  ${CANARY}  `, 'DEEPSEEK_API_KEY')).toBe(CANARY)
  })

  it('refuses a blank or header-unsafe value without echoing it', () => {
    for (const value of ['', '   ', 'sk-\u00e9', 'sk-a\nb']) {
      try {
        assertUsableApiKey(value, 'DEEPSEEK_API_KEY')
        throw new Error('expected a rejection')
      } catch (error) {
        expect(error).toBeInstanceOf(BalanceRequestError)
        expect((error as BalanceRequestError).code).toBe('INVALID_CREDENTIAL')
        expect((error as Error).message).toContain('DEEPSEEK_API_KEY')
        // Only a non-blank value could be echoed at all; for those it must not be.
        if (value.trim() !== '') expect((error as Error).message).not.toContain(value.trim())
      }
    }
  })
})

describe('fetchBalance', () => {
  it('sends the credential as a header and never as part of the URL', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(payload()))
    const result = await fetchBalance(
      { fetchImpl, signal: new AbortController().signal },
      { origin: 'https://api.deepseek.com', path: '/user/balance', timeoutMs: 1_000 },
      CANARY,
    )
    expect(result.isAvailable).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/user/balance')
    expect(url).not.toContain(CANARY)
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${CANARY}`)
    expect(init.redirect).toBe('error')
  })

  it('maps every transport failure to a stable code', async () => {
    const origin = 'https://api.deepseek.com'
    const path = '/user/balance'
    const timeoutMs = 1_000
    const signal = new AbortController().signal

    expect(await codeOf(() => fetchBalance(
      { fetchImpl: async () => new Response('nope', { status: 401 }), signal }, { origin, path, timeoutMs }, 'k',
    ))).toBe('UNAUTHORIZED')
    expect(await codeOf(() => fetchBalance(
      { fetchImpl: async () => new Response('nope', { status: 403 }), signal }, { origin, path, timeoutMs }, 'k',
    ))).toBe('UNAUTHORIZED')
    expect(await codeOf(() => fetchBalance(
      { fetchImpl: async () => new Response('nope', { status: 500 }), signal }, { origin, path, timeoutMs }, 'k',
    ))).toBe('HTTP')
    expect(await codeOf(() => fetchBalance(
      { fetchImpl: async () => { throw new TypeError('fetch failed') }, signal }, { origin, path, timeoutMs }, 'k',
    ))).toBe('NETWORK')
    expect(await codeOf(() => fetchBalance(
      { fetchImpl: async () => jsonResponse('not json at all', 200), signal }, { origin, path, timeoutMs }, 'k',
    ))).toBe('PROTOCOL')
    // A body that is not JSON at all, distinct from JSON that is simply not an object.
    expect(await codeOf(() => fetchBalance(
      { fetchImpl: async () => new Response('not json at all', { status: 200 }), signal }, { origin, path, timeoutMs }, 'k',
    ))).toBe('PROTOCOL')
  })

  it('reports a timeout when the response never arrives', async () => {
    const code = await codeOf(() => fetchBalance(
      {
        fetchImpl: (_input, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        }),
        signal: new AbortController().signal,
      },
      { origin: 'https://api.deepseek.com', path: '/user/balance', timeoutMs: 20 },
      'k',
    ))
    expect(code).toBe('TIMEOUT')
  })

  it('refuses a well-formed body past the cap, and accepts the same bytes under it', async () => {
    // A well-formed body, so the cap is the only thing that can refuse it: without the cap
    // check the first call below would resolve and the assertion would fail.
    const body = JSON.stringify({
      is_available: true,
      balance_infos: [{
        currency: 'CNY', total_balance: '47.76', granted_balance: '0.00', topped_up_balance: '47.76',
        padding: 'x'.repeat(200),
      }],
    })
    const deps = {
      fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
      signal: new AbortController().signal,
    }
    const config = { origin: 'https://api.deepseek.com', path: '/user/balance', timeoutMs: 1_000 }
    expect(await codeOf(() => fetchBalance(deps, { ...config, maxBytes: 64 }, 'k'))).toBe('PROTOCOL')
    expect((await fetchBalance(deps, { ...config, maxBytes: 64 * 1024 }, 'k')).wallets[0]?.total).toBe('47.76')
  })

  it('maps an endpoint this build cannot accept to a coded failure', async () => {
    // The path arrives from configuration, so the failure must still be one of this
    // module's codes rather than a bare Error the caller cannot classify.
    expect(await codeOf(() => fetchBalance(
      DEPS, { origin: 'https://api.deepseek.com', path: '/user/balance?a=1', timeoutMs: 1_000 }, 'k',
    ))).toBe('PROTOCOL')
  })
})

describe('URL policy', () => {
  it('accepts https, and loopback http only when allowed', () => {
    expect(parseSafeOrigin('https://api.deepseek.com')).toBe('https://api.deepseek.com')
    expect(() => parseSafeOrigin('http://api.deepseek.com')).toThrow(/must use https/)
    expect(() => parseSafeOrigin('http://127.0.0.1:8080')).toThrow(/must use https/)
    expect(parseSafeOrigin('http://127.0.0.1:8080', { allowLoopbackHttp: true })).toBe('http://127.0.0.1:8080')
  })

  it('refuses credentials, paths and query strings in an origin', () => {
    expect(() => parseSafeOrigin('https://user:pass@api.deepseek.com')).toThrow(/must not carry credentials/)
    expect(() => parseSafeOrigin('https://api.deepseek.com/v1')).toThrow(/must not carry a path/)
    expect(() => parseSafeUrl('https://api.deepseek.com/?a=1')).toThrow(/query string/)
  })
})

describe('selectWallet', () => {
  const wallet = (currency: 'CNY' | 'USD', total: string): WalletEntry =>
    ({ currency, total, granted: '0.00', toppedUp: total })
  /** The platform lists USD first, which is the order that used to defeat the CNY rule. */
  const usdFirst: readonly [WalletEntry, ...WalletEntry[]] = [wallet('USD', '3.20'), wallet('CNY', '9.99')]

  it('honours an explicit preference', () => {
    expect(selectWallet(usdFirst, 'CNY').currency).toBe('CNY')
    expect(selectWallet(usdFirst, 'USD').currency).toBe('USD')
  })

  it('prefers a funded CNY wallet under auto, whatever order the platform reports', () => {
    expect(selectWallet(usdFirst, 'auto').currency).toBe('CNY')
    expect(selectWallet([wallet('CNY', '0.00'), wallet('USD', '3.20')], 'auto').currency).toBe('USD')
  })

  it('never silently switches currency on a balance of zero', () => {
    const empty: readonly [WalletEntry, ...WalletEntry[]] = [wallet('CNY', '0.00'), wallet('USD', '0.00')]
    expect(selectWallet(empty, 'auto').currency).toBe('CNY')
    expect(selectWallet(empty, 'auto').total).toBe('0.00')
  })

  it('falls back rather than blanking the pill when the account lacks the preferred currency', () => {
    expect(selectWallet([wallet('USD', '3.20')], 'CNY').currency).toBe('USD')
    expect(selectWallet([wallet('USD', '0.00')], 'CNY').currency).toBe('USD')
  })
})
