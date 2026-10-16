/**
 * The balance pill.
 *
 * One composer-dock entry: a status dot and the platform's own balance figure. There is
 * no panel, no click target and no derived number — the value shown is what the platform
 * reported, so the only thing this plugin decides is how to present freshness.
 *
 * The age in the tooltip is derived from the reading's own host timestamp plus the clock
 * skew measured on the last successful poll, so a drifting browser clock cannot make a
 * fresh reading look old.
 *
 * The pill is a `span`, not a `button`: it does nothing when clicked, and a button would
 * advertise an affordance that does not exist. The bubble is the shared `Tooltip`
 * primitive rather than a `title` attribute, which would draw the browser's own unstyled
 * bubble next to it; `portal` keeps the bubble out of the composer's clipping and
 * stacking contexts.
 *
 * @module dsh-balance-lite/client/BalancePill
 */

import type { ReactNode } from 'react'
import { StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BalanceSource } from './balance-source.js'
import { NS } from './locales.js'
import { dotState, duration, pillLabel } from './pill-view.js'

/** The entry's injected face: one observable, nothing else. */
export interface BalanceInjected {
  hooks: { balance: BalanceSource }
}

/**
 * Dock entry id, used both as the registration id and as the `data-composer-stat`
 * attribute the slot's contract puts on every pill. Kept as one constant so the two
 * cannot drift.
 */
export const STAT_ID = 'balance-lite'

/** Composed props of the composer-dock entry. */
export type BalancePillProps = PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<typeof NS>
  & InjectFace<BalanceInjected>

/**
 * The composer-dock entry.
 * @param props - composed slot props with the injected balance source.
 * @returns the pill.
 */
export function BalancePill(props: BalancePillProps): ReactNode {
  const { t, useBalance } = props
  const snapshot = useBalance(current => current)
  const reading = snapshot.state?.reading ?? null
  const label = pillLabel(snapshot, t)
  const ageMs = reading === null ? 0 : Math.max(0, Date.now() + snapshot.skewMs - reading.at)
  const title = reading === null
    ? t('pill.titlePending')
    : t('pill.title', { value: label, ago: duration(ageMs, t) })

  return (
    <span data-dsh-balance-lite-anchor="" data-composer-stat={STAT_ID}>
      <Tooltip label={title} side="top" delayMs={200} portal>
        <span data-dsh-balance-lite-pill="" role="status" aria-label={title}>
          <StateDot state={dotState(snapshot)} />
          <span data-dsh-balance-lite-label="">{label}</span>
        </span>
      </Tooltip>
    </span>
  )
}
