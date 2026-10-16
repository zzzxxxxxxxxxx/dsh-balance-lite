/**
 * Locale dictionaries for the balance pill.
 *
 * Chinese is the source of truth: `zh` is the key table and `en` is checked against it,
 * so adding a key without an English value fails the build rather than falling back
 * silently at runtime.
 *
 * The namespace is `balance-lite`, not `balance`: registering the same namespace and
 * locale twice throws, so a sibling balance plugin must stay distinguishable.
 *
 * @module dsh-balance-lite/client/locales
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Locale namespace the pill registers its dictionaries under. */
export const NS = 'balance-lite'

/** Chinese dictionary; the key table for {@link en}. */
export const zh = {
  'pill.loading': '余额读取中',
  'pill.notConfigured': '未配置密钥',
  'pill.offline': '读不到余额',
  'pill.title': '当前余额 {value}，读取于 {ago} 前',
  'pill.titlePending': '尚未成功读取余额',
  'duration.minutes': '{n} 分钟',
  'duration.hours': '{h} 小时 {m} 分',
  'duration.days': '{d} 天 {h} 小时',
} as const

/** Every key the namespace defines. */
export type BalanceKey = keyof typeof zh

/** English dictionary, complete against {@link zh}. */
export const en: Record<BalanceKey, string> = {
  'pill.loading': 'Reading balance',
  'pill.notConfigured': 'No API key',
  'pill.offline': 'Balance unavailable',
  'pill.title': 'Current balance {value}, read {ago} ago',
  'pill.titlePending': 'No successful balance read yet',
  'duration.minutes': '{n} min',
  'duration.hours': '{h} h {m} min',
  'duration.days': '{d} d {h} h',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'balance-lite': BalanceKey
  }
}
