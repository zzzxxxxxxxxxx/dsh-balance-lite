/**
 * dsh-balance-lite browser half.
 *
 * Contributes exactly one composer-dock entry: a readout of the platform's balance. It is
 * a fresh `id` under a fresh locale namespace, so it can sit beside a sibling balance
 * plugin without colliding — both must be distinct, because a duplicate dock id and a
 * duplicate (namespace, locale) dictionary registration each throw.
 *
 * The entry is session-scoped because the composer is: the pill is therefore absent on
 * the new-session hero and outside a conversation.
 *
 * @module dsh-balance-lite/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

import { BalancePill, STAT_ID, type BalanceInjected } from './BalancePill.js'
import { createBalanceSource } from './balance-source.js'
import { en, NS, zh } from './locales.js'
import { STYLES, STYLE_ID } from './styles.js'

/** Services this entry needs: the slot registry and the dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Register the dictionaries, the stylesheet, the polling source and the dock entry.
 * @param ctx - the browser Cordis context.
 */
export function apply(ctx: Context): void {
  const balance = createBalanceSource()

  ctx.effect(() => () => { balance.dispose() }, 'dsh-balance-lite: snapshot source')

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => undefined
    // The shipped preset would inline a CSS module; a hand-written sheet keeps the
    // browser bundle a single script with no build-time CSS pipeline to reproduce.
    const existing = document.head.querySelector(`style[data-plugin="${STYLE_ID}"]`)
    if (existing !== null) return () => undefined
    const style = document.createElement('style')
    style.dataset.plugin = STYLE_ID
    style.textContent = STYLES
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-balance-lite: styles')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-balance-lite: dictionaries')

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: STAT_ID,
    // After the shipped activity (0) and usage (1) pills.
    order: 2,
    locale: NS,
    inject: (): BalanceInjected => ({ hooks: { balance } }),
  }, BalancePill))
}
