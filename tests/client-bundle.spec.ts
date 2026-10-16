/**
 * Client-artifact contract tests.
 *
 * Two facts the browser module loader assumes and no build step checks: the handoff id
 * equals the package name, and every bare specifier the factory may `require` is one the
 * shell seeds. Both fail silently in the browser — a pill that never renders — so they are
 * pinned against the built artifact.
 *
 * Needs `lib/client.js`, so it runs after `npm run build`; a checkout without a build
 * skips it.
 *
 * @module dsh-balance-lite/tests/client-bundle
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const BUNDLE = new URL('../lib/client.js', import.meta.url)

/**
 * The shell's frozen module table, mirrored from the harness
 * (`packages/client/web/src/platform.ts`, PLATFORM_MODULES at 0.2.1-alpha.5). A specifier
 * missing here, or one this bundle adds, is a load-time failure in the browser.
 */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** The loader handoff the bundle performs when the browser executes it. */
interface Handoff {
  readonly id?: unknown
  readonly factory?: unknown
}

/** Run the bundle the way the browser does: a classic script whose only act is the handoff. */
function handoffOf(code: string): Handoff {
  let captured: Handoff | undefined
  const scope = { __ModuleLoader__: { load: (registration: Handoff) => { captured = registration } } }
  new Function('window', code)(scope)
  if (captured === undefined) throw new Error('the bundle did not call window.__ModuleLoader__.load')
  return captured
}

describe.skipIf(!existsSync(BUNDLE))('client bundle artifact', () => {
  it('registers under the package name', () => {
    expect(handoffOf(readFileSync(BUNDLE, 'utf8')).id).toBe('@zzxxxxxx/dsh-balance-lite')
  })

  it('requires only specifiers the shell seeds', () => {
    const factory = handoffOf(readFileSync(BUNDLE, 'utf8')).factory as (require: (id: string) => unknown) => unknown
    const required: string[] = []
    const stub = new Proxy({}, { get: () => () => null })
    factory((id) => { required.push(id); return stub })
    expect(required.length).toBeGreaterThan(0)
    for (const id of required) expect(PLATFORM_MODULES.has(id), id).toBe(true)
  })
})
