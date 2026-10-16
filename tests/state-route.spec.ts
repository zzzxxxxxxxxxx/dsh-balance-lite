/**
 * Host route tests.
 *
 * Drives the real `apply` against a fake Cordis context and a stubbed `fetch`, then
 * exercises the registered handler directly. Three properties matter most and are
 * asserted explicitly: the snapshot is the wire shape the browser half expects, **the API
 * key never appears in it** while still being sent as a request header, and the route
 * cannot be read without passing the host trust fence.
 *
 * @module dsh-balance-lite/tests/state-route
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config, inject } from '../src/index.js'
import type { Config as BalanceConfig } from '../src/index.js'
import { STATE_PATH } from '../src/protocol.js'

const CANARY = 'sk-canary-must-not-leak-0123456789'

/** The subset of the wire body these tests read. */
interface WireState {
  readonly reading: Record<string, unknown> | null
  readonly isAvailable: boolean | null
  readonly stale: boolean
  readonly error: { readonly code: string } | null
  readonly pollIntervalMs: number
  readonly serverTime: number
}

/** A captured route registration. */
interface Route {
  readonly kind: string
  readonly path: string
  readonly handler: (request: unknown, response: unknown) => void
}

/**
 * A minimal Cordis context recording registrations instead of performing them.
 * @param services - values returned by `ctx.get(name)`.
 * @param undeclared - service names that must throw on direct property access, mirroring
 *   Cordis's undeclared-service guard: `ctx.foo` throws while `ctx.get('foo')` still reads
 *   the store. Without this the harness would accept an accessor Cordis rejects — which is
 *   how a bare 400 shipped once.
 */
function fakeContext(services: Record<string, unknown> = {}, undeclared: readonly string[] = []) {
  const routes = new Map<string, Route>()
  const disposers: (() => void)[] = []
  const logger = { info: vi.fn(), warn: vi.fn() }
  const ctx: Record<string, unknown> = {
    logger,
    effect: (callback: () => unknown) => {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return () => undefined
    },
    on: () => () => undefined,
    get: (name: string) => services[name],
    webServer: {
      register: (route: Route) => {
        routes.set(route.path, route)
        return () => undefined
      },
    },
  }
  for (const name of undeclared) {
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() {
        throw new Error(`Service "${name}" is not available`)
      },
    })
  }
  return { ctx, routes, logger, disposers }
}

/** A fake `ServerResponse` capturing status, headers and body. */
function fakeResponse() {
  const captured = { status: 0, headers: {} as Record<string, unknown>, body: '' }
  const response = {
    writeHead(status: number, headers?: Record<string, unknown>) {
      captured.status = status
      Object.assign(captured.headers, headers ?? {})
    },
    end(body?: string) {
      captured.body = body ?? ''
    },
  }
  return { response, captured }
}

/** Read the snapshot through the registered handler. */
function readState(routes: Map<string, Route>): { state: WireState; raw: string; status: number } {
  const { response, captured } = fakeResponse()
  routes.get(STATE_PATH)?.handler({ method: 'GET', headers: {} }, response)
  return { state: JSON.parse(captured.body) as WireState, raw: captured.body, status: captured.status }
}

/** A valid balance payload as the platform sends it. */
function balancePayload(): unknown {
  return {
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '47.76', granted_balance: '0.00', topped_up_balance: '47.76' },
    ],
  }
}

/**
 * Build a complete config from the schema, so tests state only what they change while
 * every default still comes from the one place that defines them.
 */
function testConfig(overrides: Partial<BalanceConfig>): BalanceConfig {
  return Config(overrides as unknown as BalanceConfig)
}

const open: { disposers: (() => void)[] } = { disposers: [] }

afterEach(() => {
  for (const dispose of open.disposers.splice(0)) dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Mount the plugin against fakes and wait for the first reading unless told not to. */
async function mount(
  services: Record<string, unknown> = {},
  undeclared: readonly string[] = [],
  options: { awaitFetch?: boolean; awaitReading?: boolean } = {},
) {
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify(balancePayload()), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  // The connection seam comes from the same bundle as the web server, so it is always
  // present in production; default it permissive and let fence tests override it.
  const fake = fakeContext({ connection: { requestRejection: () => undefined }, ...services }, undeclared)
  // A cadence that is not the schema default, so the assertion on the served interval
  // cannot pass by echoing the default back.
  const config = testConfig({ refreshIntervalMs: 5_000, staleAfterMs: 10_000, clientPollIntervalMs: 7_000 })
  apply(fake.ctx as never, config as never)
  open.disposers.push(...fake.disposers)
  if (options.awaitFetch !== false) await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalled() })
  if (options.awaitReading === true) {
    // Only the tests that read the served snapshot ask for this: waiting for the landing
    // reading rather than for the call keeps them off an interval margin. A fence test is
    // served a refusal instead of a body, and must not be driven through the route at all.
    await vi.waitFor(() => { expect(readState(fake.routes).state.reading).not.toBeNull() })
  }
  return { ...fake, fetchMock }
}

describe('state route', () => {
  it('serves the platform balance and never leaks the credential', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', CANARY)
    const { routes, fetchMock } = await mount({}, [], { awaitReading: true })
    const { state, raw, status } = readState(routes)

    expect(status).toBe(200)
    expect(state.reading).toEqual({
      currency: 'CNY',
      total: '47.76',
      granted: '0.00',
      toppedUp: '47.76',
      at: expect.any(Number),
    })
    expect(state.isAvailable).toBe(true)
    expect(state.stale).toBe(false)
    expect(state.error).toBeNull()
    expect(state.pollIntervalMs).toBe(7_000)
    expect(typeof state.serverTime).toBe('number')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${CANARY}`)
    expect(raw).not.toContain(CANARY)
    expect(raw).not.toContain('canary')
  })

  it('answers HEAD without a body and rejects other methods', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', CANARY)
    const { routes } = await mount()

    const head = fakeResponse()
    routes.get(STATE_PATH)?.handler({ method: 'HEAD', headers: {} }, head.response)
    expect(head.captured.status).toBe(200)
    expect(head.captured.body).toBe('')
    expect(head.captured.headers['cache-control']).toBe('no-store')

    const post = fakeResponse()
    routes.get(STATE_PATH)?.handler({ method: 'POST', headers: {} }, post.response)
    expect(post.captured.status).toBe(405)
    expect(post.captured.headers.allow).toBe('GET, HEAD')
  })

  it('reports a reading as stale once it ages past the bound', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', CANARY)
    const { routes } = await mount({}, [], { awaitReading: true })
    expect(readState(routes).state.stale).toBe(false)

    const clock = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(clock + 20_000)
    expect(readState(routes).state.stale).toBe(true)
  })
})

describe('host trust fence', () => {
  it('requires the browser connection seam rather than treating it as optional', () => {
    // `connection` comes from the same bundle as `webserver`, so requiring it costs
    // nothing — while leaving it optional would let the fence silently fail open.
    expect(inject).toContain('webServer')
    expect(inject).toContain('connection')
  })

  it('reads the trust surface through ctx.get, never a direct property', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', CANARY)
    const { routes } = await mount({ connection: { requestRejection: () => 401 } }, ['connection'])
    const { response, captured } = fakeResponse()
    routes.get(STATE_PATH)?.handler({ method: 'GET', headers: {} }, response)
    expect(captured.status).toBe(401)
    expect(captured.body).toBe('')
  })

  it('refuses rather than serves when the trust surface is unavailable', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', CANARY)
    const { routes } = await mount({ connection: undefined })
    const { response, captured } = fakeResponse()
    routes.get(STATE_PATH)?.handler({ method: 'GET', headers: {} }, response)
    expect(captured.status).toBe(503)
    expect(captured.body).toBe('')
  })

  it('passes the request headers to the trust check and relays a 403', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', CANARY)
    const seen: unknown[] = []
    const { routes } = await mount({
      connection: {
        requestRejection: (request: { headers: unknown }) => {
          seen.push(request.headers)
          return 403
        },
      },
    })
    const { response, captured } = fakeResponse()
    routes.get(STATE_PATH)?.handler({ method: 'GET', headers: { host: 'evil.example' } }, response)
    expect(captured.status).toBe(403)
    expect(seen).toEqual([{ host: 'evil.example' }])
  })
})

describe('credential resolution', () => {
  it('takes the key from the credentials service, not the environment', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-from-the-environment')
    const resolve = vi.fn(async () => ({ value: CANARY }))
    const { fetchMock } = await mount({ credentials: { resolve } })

    expect(resolve).toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${CANARY}`)
  })

  it('reports MISSING_CREDENTIAL when the reference resolves to nothing', async () => {
    const { routes } = await mount({ credentials: { resolve: async () => undefined } }, [], { awaitFetch: false })
    await vi.waitFor(() => { expect(readState(routes).state.error?.code).toBe('MISSING_CREDENTIAL') })
  })

  it('reports INVALID_CREDENTIAL for a value that cannot be a header', async () => {
    const { routes } = await mount({ credentials: { resolve: async () => ({ value: 'sk-\u00e9' }) } }, [], { awaitFetch: false })
    await vi.waitFor(() => { expect(readState(routes).state.error?.code).toBe('INVALID_CREDENTIAL') })
  })
})

describe('teardown', () => {
  it('does not log a failure when the lifetime abort ends an in-flight poll', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', CANARY)
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const fake = fakeContext({ connection: { requestRejection: () => undefined } })
    apply(fake.ctx as never, testConfig({ refreshIntervalMs: 5_000 }) as never)
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalled() })

    for (const dispose of fake.disposers) dispose()
    // A macrotask boundary: the abort rejects and the poll's catch settles in microtasks.
    await new Promise(resolve => { setImmediate(resolve) })

    // A normal shutdown must not leave behind a log line that reads like a balance failure.
    expect(fake.logger.warn).not.toHaveBeenCalled()
  })
})

describe('configuration validation', () => {
  it('rejects an endpoint this build cannot accept before registering anything', () => {
    const fake = fakeContext({ connection: { requestRejection: () => undefined } })
    expect(() => apply(fake.ctx as never, testConfig({ balancePath: '/user/balance?a=1' }) as never))
      .toThrow(/query string/)
    expect(fake.routes.size).toBe(0)
  })
})

describe('missing credential', () => {
  it('reports MISSING_CREDENTIAL without sending a request', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const fake = fakeContext({ connection: { requestRejection: () => undefined } })
    apply(fake.ctx as never, testConfig({ refreshIntervalMs: 5_000 }) as never)
    open.disposers.push(...fake.disposers)

    await vi.waitFor(() => {
      expect(readState(fake.routes).state.error?.code).toBe('MISSING_CREDENTIAL')
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
