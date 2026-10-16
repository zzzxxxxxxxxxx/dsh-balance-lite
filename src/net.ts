/**
 * Outbound-request hygiene for the one fixed, operator-configured origin this plugin
 * talks to: the DeepSeek balance endpoint.
 *
 * The URL does not come from model output, so the web-fetch SSRF policy (which exists
 * because its URLs are model-chosen) does not apply. What does apply is the house rule
 * for credential-bearing requests: validate the configured URL once, never follow
 * redirects, and cap the response body.
 *
 * @module dsh-balance-lite/net
 */

/** Options for {@link parseSafeUrl}. */
export interface SafeUrlOptions {
  /** Whether a loopback `http://` URL is acceptable (local endpoints only). */
  readonly allowLoopbackHttp?: boolean
  /** Whether a query string or fragment is acceptable. */
  readonly allowQuery?: boolean
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/** Whether a URL's host is a loopback address literal; `URL.hostname` keeps IPv6 brackets. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.replace(/^\[|\]$/g, ''))
}

/**
 * Validate one configured URL.
 *
 * @param raw - the configured URL.
 * @param options - acceptance policy.
 * @returns the parsed URL.
 * @throws when it carries credentials, is not `https` (loopback `http` aside), or
 *   carries a query/fragment the caller did not allow.
 */
export function parseSafeUrl(raw: string, options: SafeUrlOptions = {}): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`dsh-balance-lite: not a valid URL: ${JSON.stringify(raw)}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('dsh-balance-lite: the configured URL must not carry credentials')
  }
  const https = url.protocol === 'https:'
  const loopbackHttp = url.protocol === 'http:' && options.allowLoopbackHttp === true && isLoopbackHost(url.hostname)
  if (!https && !loopbackHttp) {
    throw new Error(`dsh-balance-lite: the configured URL must use https, got ${JSON.stringify(url.protocol)}`)
  }
  if (options.allowQuery !== true && (url.search !== '' || url.hash !== '')) {
    throw new Error('dsh-balance-lite: the configured URL must not carry a query string or fragment')
  }
  return url
}

/**
 * Validate a configured **origin**, rejecting any path/query/fragment.
 * @param raw - the configured origin, e.g. `https://api.deepseek.com`.
 * @param options - acceptance policy.
 * @returns the parsed origin.
 * @throws when the URL carries anything beyond a scheme, host and port.
 */
export function parseSafeOrigin(raw: string, options: SafeUrlOptions = {}): string {
  const url = parseSafeUrl(raw, options)
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('dsh-balance-lite: the configured origin must not carry a path')
  }
  return url.origin
}

/**
 * Read a response body, refusing to buffer more than `maxBytes`.
 *
 * Reads the stream incrementally so an oversized or endless body is abandoned rather
 * than accumulated; a declared `content-length` above the cap short-circuits before any
 * body is read.
 *
 * @param response - the response.
 * @param maxBytes - the accepted size.
 * @returns the body text.
 * @throws when the body exceeds the cap or the stream cannot be read.
 */
export async function readCappedBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`dsh-balance-lite: response declares ${declared} bytes, above the ${maxBytes} byte cap`)
  }
  const body = response.body
  if (body === null) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw new Error(`dsh-balance-lite: response is above the ${maxBytes} byte cap`)
    return text
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let out = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > maxBytes) {
        // Cancel before throwing: releasing the lock alone would leave the rest of the
        // body to be drained by the request timeout rather than now.
        await reader.cancel()
        throw new Error(`dsh-balance-lite: response exceeded the ${maxBytes} byte cap`)
      }
      out += decoder.decode(value, { stream: true })
    }
    out += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return out
}

/**
 * Parse a JSON body without letting a syntax error escape as an opaque failure.
 * @param text - the raw body.
 * @returns the parsed value, or undefined when it is not JSON.
 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
