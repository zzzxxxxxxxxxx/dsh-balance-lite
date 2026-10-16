/**
 * dsh-balance-lite host half.
 *
 * Owns the API credential and polls `/user/balance`, then serves the newest reading to
 * the browser half over one exact route. The client never sees the credential and never
 * reaches the network; it only renders the snapshot.
 *
 * This plugin deliberately stops there — no token accounting, no projection, no
 * peak/off-peak pricing, no calibration, no persistence. The number on the pill is the
 * platform's own, so it reports the platform's state instead of an estimate of it,
 * including the platform's 1–5 minute settlement lag, which no plugin can remove.
 *
 * @module dsh-balance-lite
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'

import { BalanceRequestError, assertUsableApiKey, fetchBalance, selectWallet } from './balance-api.js'
import { parseSafeOrigin, parseSafeUrl } from './net.js'
import { STATE_PATH, type BalanceErrorCode, type BalanceReading, type BalanceState, type Currency } from './protocol.js'

/** Plugin name; also the Loader row id. */
export const name = 'dsh-balance-lite'

/**
 * Required services.
 *
 * `connection` is the browser trust surface, and it is required rather than optional on
 * purpose. It is mounted by `@deepseek-ai/dsh-web-app` — the same bundle, at the same
 * level, as `webserver`, and the only bundle that provides one — so there is no harness
 * composition with a web server and no browser connection seam. Declaring it means the
 * route fence can never silently fail open: without the service this plugin does not
 * load at all, rather than serving account data unfenced.
 */
export const inject = ['webServer', 'connection']

/** Plugin configuration, mirrored field-for-field by the {@link Config} schema below. */
export interface Config {
  /** Credential reference holding the DeepSeek API key. */
  apiKeyEnv: string
  /** Balance endpoint origin; must be https unless it is loopback. */
  apiOrigin: string
  /** Balance endpoint path. */
  balancePath: string
  /** How often the platform is polled. */
  refreshIntervalMs: number
  /** Per-request timeout. */
  requestTimeoutMs: number
  /** Which wallet to display when the account reports more than one. */
  preferredCurrency: 'auto' | Currency
  /** Age at which the newest reading is reported as stale. */
  staleAfterMs: number
  /** How often the browser reads the snapshot. */
  clientPollIntervalMs: number
  /** Whether a loopback `http://` endpoint is acceptable (local development). */
  allowLoopbackHttp: boolean
}

/** Configuration schema; the defaults are the documented ones. */
export const Config: Schema<Config> = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref').default('DEEPSEEK_API_KEY'),
  apiOrigin: Schema.string().default('https://api.deepseek.com'),
  balancePath: Schema.string().default('/user/balance'),
  // Faster than a calibrating plugin would poll, because there is no window to protect —
  // the platform's own settlement lag still dominates what a shorter interval can show.
  refreshIntervalMs: Schema.number().step(1).min(5_000).max(3_600_000).default(30_000),
  requestTimeoutMs: Schema.number().step(1).min(1_000).max(60_000).default(10_000),
  preferredCurrency: Schema.union(['auto', 'CNY', 'USD']).default('auto'),
  staleAfterMs: Schema.number().step(1).min(10_000).max(86_400_000).default(180_000),
  clientPollIntervalMs: Schema.number().step(1).min(5_000).max(600_000).default(15_000),
  allowLoopbackHttp: Schema.boolean().default(false),
})

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface BrowserAuthConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * Read the composition's browser trust surface.
 *
 * The read goes through `ctx.get`, which cannot throw: a bare `ctx.connection` trips
 * Cordis's undeclared-service guard and throws inside the route handler, which the web
 * server answers as a bare 400 — the fence breaking the very route it protects. The
 * injection above guarantees the service exists, but `get` keeps this correct regardless
 * (and the package is browser-side, so it is absent from the host type map anyway).
 *
 * @param ctx - the plugin context.
 * @returns the trust surface, or undefined while it is not currently provided, which the
 *   caller treats as a refusal rather than a reason to skip the fence.
 */
function connectionOf(ctx: Context): BrowserAuthConnection | undefined {
  const candidate = ctx.get('connection') as BrowserAuthConnection | undefined
  return typeof candidate?.requestRejection === 'function' ? candidate : undefined
}

/** The credential-reference grammar, mirroring the credentials seam. */
const CREDENTIAL_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Brand a configured name as a credential reference.
 * @param value - the configured environment-variable name.
 * @returns the branded reference.
 * @throws when the name is not a POSIX shell identifier.
 */
function toCredentialRef(value: string): CredentialRef {
  if (!CREDENTIAL_REF_RE.test(value)) {
    throw new Error(`dsh-balance-lite: apiKeyEnv must be an environment-variable name, got ${JSON.stringify(value)}`)
  }
  return value as CredentialRef
}

/**
 * Register the poll loop and the snapshot route.
 * @param ctx - the host Cordis context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const ref = toCredentialRef(config.apiKeyEnv)
  const apiOrigin = parseSafeOrigin(config.apiOrigin, { allowLoopbackHttp: config.allowLoopbackHttp })
  if (!config.balancePath.startsWith('/')) {
    throw new Error(`dsh-balance-lite: balancePath must start with "/", got ${JSON.stringify(config.balancePath)}`)
  }
  // Validate the composed endpoint once, at load: a path this build cannot accept must
  // fail here rather than resurface as a poll error code on every cycle.
  parseSafeUrl(`${apiOrigin}${config.balancePath}`, { allowLoopbackHttp: config.allowLoopbackHttp })

  const warn = (message: string, error?: unknown): void => {
    ctx.logger.warn(message)
    if (error !== undefined) ctx.logger.warn(error)
  }

  const lifetime = new AbortController()

  // ---- polling ------------------------------------------------------------

  /** The newest successful reading, or null before the first one. */
  let reading: BalanceReading | null = null
  /** The platform's own availability verdict, from the newest success. */
  let isAvailable: boolean | null = null
  /** The newest failure code, cleared by the next success. */
  let lastError: BalanceErrorCode | null = null
  let pollTimer: NodeJS.Timeout | undefined
  let polling = false

  /**
   * Resolve the credential for this poll.
   *
   * Resolved per request rather than cached, so a rotated key reaches the very next poll.
   * @returns the trimmed key.
   * @throws {BalanceRequestError} with `MISSING_CREDENTIAL` when nothing is configured.
   */
  async function resolveKey(): Promise<string> {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit === undefined) {
        throw new BalanceRequestError('MISSING_CREDENTIAL', `dsh-balance-lite: ${ref} is not configured`)
      }
      return assertUsableApiKey(hit.value, ref)
    }
    const ambient = process.env[ref]
    if (ambient === undefined || ambient.trim() === '') {
      throw new BalanceRequestError('MISSING_CREDENTIAL', `dsh-balance-lite: ${ref} is not set in the launching environment`)
    }
    return assertUsableApiKey(ambient, ref)
  }

  /** One poll. A failure keeps the previous reading; it never becomes a zero balance. */
  async function pollOnce(): Promise<void> {
    if (polling || lifetime.signal.aborted) return
    polling = true
    try {
      const key = await resolveKey()
      const response = await fetchBalance(
        { fetchImpl: fetch, signal: lifetime.signal },
        {
          origin: apiOrigin,
          path: config.balancePath,
          timeoutMs: config.requestTimeoutMs,
          allowLoopbackHttp: config.allowLoopbackHttp,
        },
        key,
      )
      const wallet = selectWallet(response.wallets, config.preferredCurrency)
      reading = {
        currency: wallet.currency,
        total: wallet.total,
        granted: wallet.granted,
        toppedUp: wallet.toppedUp,
        at: Date.now(),
      }
      isAvailable = response.isAvailable
      lastError = null
    } catch (error) {
      // Teardown aborts the in-flight request; that is not a balance failure and must not
      // overwrite the newest reading with an error code or log itself as one.
      if (lifetime.signal.aborted) return
      lastError = error instanceof BalanceRequestError ? error.code : 'PROTOCOL'
      if (lastError === 'MISSING_CREDENTIAL') {
        // Expected on a fresh profile, and the pill says so; not worth a warning.
        ctx.logger.info('dsh-balance-lite: %s', (error as Error).message)
      } else {
        warn('dsh-balance-lite: balance poll failed', error)
      }
    } finally {
      polling = false
    }
  }

  /** Queue the next poll; the timer never keeps the process alive on its own. */
  function schedulePoll(): void {
    if (lifetime.signal.aborted) return
    pollTimer = setTimeout(() => {
      void pollOnce()
        .catch((error: unknown) => { warn('dsh-balance-lite: poll cycle failed', error) })
        .finally(() => { schedulePoll() })
    }, config.refreshIntervalMs)
    pollTimer.unref?.()
  }

  // ---- snapshot -----------------------------------------------------------

  /** Assemble the wire snapshot the browser half renders. */
  const buildState = (): BalanceState => {
    const now = Date.now()
    return {
      reading,
      isAvailable,
      // Only a reading can be stale: before the first one there is nothing to age.
      stale: reading !== null && now - reading.at > config.staleAfterMs,
      error: lastError === null ? null : { code: lastError },
      pollIntervalMs: config.clientPollIntervalMs,
      serverTime: now,
    }
  }

  // ---- routes -------------------------------------------------------------

  /**
   * Answer an unauthenticated or off-host request; true when it was rejected.
   *
   * A custom host route is **not** behind the browser gate automatically, so a route that
   * reports account data has to ask for the verdict itself. The trust check applies the
   * Host/Origin fence (which is what stops a page on another origin from rebinding DNS to
   * this loopback port) and then the signed session cookie minted by the `dsh web` token
   * exchange. A browser that reached the UI the normal way holds that cookie, and a
   * same-origin `fetch` sends it, so enforcing this costs the pill nothing.
   */
  const rejectUntrusted = (request: IncomingMessage, response: ServerResponse): boolean => {
    const connection = connectionOf(ctx)
    if (connection === undefined) {
      // `connection` is a required injection, so this only happens while its providing
      // fiber is momentarily inactive. Refuse instead of falling through: skipping the
      // verdict would serve account data unfenced, which is the one outcome the fence
      // exists to prevent. Refusing costs a momentary 503 in the pill; serving costs the
      // invariant.
      warn('dsh-balance-lite: the browser trust surface is unavailable; refusing to serve the snapshot')
      response.writeHead(503, { 'cache-control': 'no-store' })
      response.end()
      return true
    }
    const rejection = connection.requestRejection(request)
    if (rejection === undefined) return false
    response.writeHead(rejection, { 'cache-control': 'no-store' })
    response.end()
    return true
  }

  const respondJson = (response: ServerResponse, status: number, body: unknown): void => {
    const text = JSON.stringify(body)
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    })
    response.end(text)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATE_PATH,
    handler: (request, response) => {
      if (rejectUntrusted(request, response)) return
      if (request.method === 'HEAD') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end()
        return
      }
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        respondJson(response, 200, buildState())
      } catch (error) {
        warn('dsh-balance-lite: could not serialize the snapshot', error)
        respondJson(response, 500, { error: 'internal' })
      }
    },
  }), 'dsh-balance-lite: state route')

  // ---- lifetime -----------------------------------------------------------

  ctx.effect(() => {
    void pollOnce()
      .catch((error: unknown) => { warn('dsh-balance-lite: initial poll failed', error) })
      .finally(() => { schedulePoll() })
    return () => {
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      lifetime.abort()
    }
  }, 'dsh-balance-lite: lifetime')

  ctx.logger.info('dsh-balance-lite: serving %s', STATE_PATH)
}
