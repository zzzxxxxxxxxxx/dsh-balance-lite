/**
 * Outbound-request hygiene tests.
 *
 * The body cap is the one place a well-formed response is still refused, so each of its
 * three arms is driven directly: the declared length, a body-less response, and a stream
 * that overruns.
 *
 * @module dsh-balance-lite/tests/net
 */

import { describe, expect, it } from 'vitest'
import { isLoopbackHost, parseJson, parseSafeOrigin, readCappedBody } from '../src/net.js'

describe('isLoopbackHost', () => {
  it('accepts every spelling URL.hostname produces for a loopback host', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    // URL.hostname keeps the brackets, and that is the spelling the validator sees.
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('example.com')).toBe(false)
    expect(isLoopbackHost('127.0.0.2')).toBe(false)
  })
})

describe('parseSafeOrigin', () => {
  it('accepts an IPv6 loopback endpoint when loopback http is allowed', () => {
    expect(parseSafeOrigin('http://[::1]:8080', { allowLoopbackHttp: true })).toBe('http://[::1]:8080')
    expect(() => parseSafeOrigin('http://[::1]:8080')).toThrow(/must use https/)
  })
})

describe('readCappedBody', () => {
  it('short-circuits on a declared length above the cap', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4)) } })
    const response = new Response(body, { headers: { 'content-length': '64' } })
    await expect(readCappedBody(response, 8)).rejects.toThrow(/declares 64 bytes/)
  })

  it('reads a body within the cap', async () => {
    await expect(readCappedBody(new Response('{"a":1}'), 64)).resolves.toBe('{"a":1}')
  })

  it('refuses a stream that overruns the cap and cancels it', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(16)) },
      cancel() { cancelled = true },
    })
    await expect(readCappedBody(new Response(body), 8)).rejects.toThrow(/exceeded the 8 byte cap/)
    expect(cancelled).toBe(true)
  })

  it('accepts a body-less response', async () => {
    await expect(readCappedBody(new Response(null, { status: 204 }), 8)).resolves.toBe('')
  })
})

describe('parseJson', () => {
  it('reports text that is not JSON as undefined instead of throwing', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('not json')).toBeUndefined()
  })
})
