/**
 * The browser half's only data channel.
 *
 * The client cannot call the host over RPC (external bundles cannot contribute a Remote
 * namespace), so it polls `GET /dsh-balance-lite/state` and validates every response
 * through the shared {@link parseBalanceState}. A malformed or failed response **keeps
 * the previous snapshot** rather than clearing the UI: a transient host restart must not
 * make the number vanish.
 *
 * Polling is reference-counted off `subscribe`, so the timer only runs while the pill is
 * actually mounted, and it pauses while the document is hidden.
 *
 * Transport, clock and timers are injected so the unit tests run without a DOM.
 *
 * @module dsh-balance-lite/client/balance-source
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { parseBalanceState, STATE_PATH, type BalanceState } from '../protocol.js'

/** What the pill renders. */
export interface BalanceSnapshot {
  /** The newest validated host snapshot; null until the first success. */
  readonly state: BalanceState | null
  /** `loading` before the first answer, `ready` after a success, `offline` after a failure. */
  readonly phase: 'loading' | 'ready' | 'offline'
  /** Host clock minus local clock, from the last response. */
  readonly skewMs: number
}

/** Injectable environment. */
export interface BalanceSourceOptions {
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  readonly now?: () => number
  readonly isHidden?: () => boolean
  readonly onVisibilityChange?: (listener: () => void) => () => void
  readonly setTimer?: (listener: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
  /** Base URL for the route; defaults to the document origin. */
  readonly baseUrl?: () => string
}

/** A pollable, disposable snapshot source. */
export interface BalanceSource extends HostObservable<BalanceSnapshot> {
  /** Release the timer, the listener set and any in-flight request. */
  dispose(): void
}

/** Retry delay while the host has not answered yet. */
const OFFLINE_RETRY_MS = 10_000

/** Delay used before the host has reported its own poll interval. */
const DEFAULT_POLL_MS = 15_000

/** The {@link BalanceState} in the protocol lives under this shape; re-exported for the component. */
export type { BalanceState }

function initialSnapshot(): BalanceSnapshot {
  return { state: null, phase: 'loading', skewMs: 0 }
}

/**
 * Build the polling source.
 * @param options - injected transport, clock, timers and visibility signal.
 * @returns the source; `subscribe` starts polling and the last unsubscribe stops it.
 */
export function createBalanceSource(options: BalanceSourceOptions = {}): BalanceSource {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const now = options.now ?? (() => Date.now())
  const isHidden = options.isHidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  const setTimer = options.setTimer ?? ((listener, ms) => setTimeout(listener, ms))
  const clearTimer = options.clearTimer ?? (handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) })
  const baseUrl = options.baseUrl ?? (() => (typeof location === 'undefined' ? '' : location.origin))

  const listeners = new Set<() => void>()
  let snapshot = initialSnapshot()
  let timer: unknown
  let controller: AbortController | null = null
  let disposed = false

  const publish = (next: BalanceSnapshot): void => {
    snapshot = next
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        // One throwing subscriber must not skip the others or kill the poll loop.
        console.warn('[dsh-balance-lite] snapshot listener failed', error)
      }
    }
  }

  const stopTimer = (): void => {
    if (timer !== undefined) {
      clearTimer(timer)
      timer = undefined
    }
  }

  /**
   * Whether the source should be doing work at all: alive, and someone is watching.
   *
   * Every entry point checks this rather than `disposed` alone. Unsubscribing the last
   * listener stops the timer but does not dispose the source — the pill unmounts while the
   * plugin stays loaded — so a poll already in flight, or a visibility change arriving
   * after the last unsubscribe, would otherwise restart an unwatched poll loop.
   * @returns true when a poll may run or be scheduled.
   */
  const watching = (): boolean => !disposed && listeners.size > 0

  const schedule = (ms: number): void => {
    if (!watching()) return
    stopTimer()
    timer = setTimer(() => { void tick() }, ms)
  }

  async function tick(): Promise<void> {
    if (!watching()) return
    if (isHidden()) {
      // Keep the cadence without spending a request on a page nobody is looking at.
      schedule(snapshot.state?.pollIntervalMs ?? DEFAULT_POLL_MS)
      return
    }
    if (controller !== null) return
    const active = new AbortController()
    controller = active
    try {
      const response = await fetchImpl(`${baseUrl()}${STATE_PATH}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: active.signal,
      })
      if (!response.ok) throw new Error(`dsh-balance-lite: state answered HTTP ${response.status}`)
      const parsed = parseBalanceState(await response.json())
      if (parsed === null) throw new Error('dsh-balance-lite: state response did not match the expected shape')
      if (!watching()) return
      publish({ state: parsed, phase: 'ready', skewMs: parsed.serverTime - now() })
      schedule(parsed.pollIntervalMs)
    } catch (error) {
      if (!watching() || active.signal.aborted) return
      console.warn('[dsh-balance-lite] state poll failed', error)
      publish({ ...snapshot, phase: 'offline' })
      schedule(Math.min(OFFLINE_RETRY_MS, snapshot.state?.pollIntervalMs ?? OFFLINE_RETRY_MS))
    } finally {
      if (controller === active) controller = null
    }
  }

  const onVisibility = (): void => {
    if (!isHidden()) void tick()
  }
  const offVisibility = options.onVisibilityChange !== undefined
    ? options.onVisibilityChange(onVisibility)
    : (typeof document === 'undefined'
        ? () => undefined
        : (() => {
            const listener = (): void => { onVisibility() }
            document.addEventListener('visibilitychange', listener)
            return (): void => { document.removeEventListener('visibilitychange', listener) }
          })())

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (disposed) return () => undefined
      listeners.add(listener)
      if (listeners.size === 1 && !disposed) void tick()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          stopTimer()
          controller?.abort()
          controller = null
        }
      }
    },
    dispose: () => {
      disposed = true
      stopTimer()
      controller?.abort()
      controller = null
      listeners.clear()
      offVisibility()
    },
  }
}
