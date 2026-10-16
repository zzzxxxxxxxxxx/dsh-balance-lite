<div align="center">

<img src="assets/icon.svg" alt="dsh-balance-lite" width="84" height="84">

# dsh-balance-lite

**A bare balance readout for the DeepSeek Harness — one API call, the platform's own number.**

[![npm](https://img.shields.io/npm/v/@zzxxxxxx/dsh-balance-lite.svg)](https://www.npmjs.com/package/@zzxxxxxx/dsh-balance-lite)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-%E2%89%A5%200.2.0--rc.1-6E56CF)](https://github.com/deepseek-ai/deepseek-harness)

**English** | [中文](README.md)

</div>

## Overview

- **One number, read**: the pill shows the platform's own `total_balance`, verbatim at its two decimals, with no conversion of any kind.
- **No estimation**: no token accounting, no spend projection, no peak/off-peak pricing, no correction factor, no ETA. That is deliberate — estimation has to contend with settlement lag, the peak/off-peak schedule and cache-hit ratios, and the error lands on the plugin. This one hands that judgement back to you.
- **The lag belongs to the platform, not the plugin**: a balance only moves once the platform settles, and no polling interval can change that 1–5 minutes. So 30 seconds is already enough; anything denser just spends requests.
- **A failure is never a zero balance**: an unreadable balance keeps the last successful reading and turns the dot amber; before the first reading the pill says it is reading; a broken credential says so. **No failure can produce "balance 0".**
- **Nothing on disk**: no directory is created under `$DSH_HOME`. The cost is that after a restart the pill says it is reading for about a second.
- **A pill under the composer**, beside the built-in token statistics. Hovering raises the current balance and read time, but the pill itself **does not grey**: the host reserves the hover background for the button form that opens a panel, and keeps the static reading at its resting tone (see the comment in `StatsPills.module.css`), which is the form this plugin follows. Clicking does nothing either, which is why it is a `span`, not a `button`.

The host half owns the credential and every outbound request, and hands one snapshot to the browser half over a **single** route: the credential never reaches the browser, and the route takes part in the host's Host/Origin and cookie trust fence. Nothing is written on a timer and no history accumulates.

## Install

Requirements: DeepSeek Harness ≥ `0.2.0-rc.1` and < `0.3.0`, Node `^22.19.0 || >=24.0.0`.

**From npm** (recommended):

```sh
dsh plugin --profile <profile> add @zzxxxxxx/dsh-balance-lite
```

**From source / local development**:

```sh
git clone https://github.com/zzzxxxxxxxxxx/dsh-balance-lite && cd dsh-balance-lite
npm install        # build dependencies; needs network the first time
npm run build      # produces lib/, the plugin entry point (not committed)

dsh plugin --profile <profile> add "$PWD"
```

**From a packed tarball** (`npm pack` output already carries `lib/`, so nothing is built):

```sh
dsh plugin --profile <profile> add ./zzxxxxxx-dsh-balance-lite-0.1.2.tgz
```

**Restart** `dsh` afterwards (a profile is composed at startup).

- The API key comes from the credential reference `DEEPSEEK_API_KEY`, the same one the built-in `deepseek-official` provider uses — if your models work, it is already configured. It can also be set in **Settings → Models**, in `$DSH_HOME/.credentials.yaml`, or by exporting the variable.
- Update: from source, `git pull && npm install && npm run build`; from a tarball, `add` it again. Restart either way.
- Remove: `dsh plugin --profile <p> remove @zzxxxxxx/dsh-balance-lite`, then restart.
- ⚠️ The **unscoped** `dsh-balance-lite` on npm is a *different* package — install this one by its scope.
- Installing it alongside `@zzxxxxxx/dsh-balance` shows two balance pills in a row, each polling the same endpoint (their namespaces are isolated, so nothing breaks). They are two answers to one question; keep one.
- Development: `npm run typecheck`, `npm test` (71 cases, no network), `npm run build`. `locale/*.json` carries only the plugin manager's display name and description (`meta`) — it is **not** the client dictionary, which lives in `src/client/locales.ts`.

## Usage

- **Pill**: shows `¥36.35`. The dot means: green = just read, amber = what you see is old (older than `staleAfterMs`, or the newest poll failed), red = no number available (credential or network), grey = still waiting for the first reading.
- **Hover**: raises "Current balance ¥36.35, read 3 min ago" without changing the pill's appearance (see above). The age is derived from the reading's own host timestamp plus the clock skew measured on the last successful poll, so a drifting browser clock cannot make a fresh reading look old.
- **Exactly one route**: `GET /dsh-balance-lite/state`. There is no refresh button and no slash command — to refresh now, reload the page or the host.
- The pill is **session-scoped** (a property of `conversation.composer.dock`), so it is absent on the new-session hero and outside a conversation.

## Configuration

Every field lives in the plugin row's `config:` (this plugin has **no** settings page), and a change needs a restart. These are the complete defaults:

```yaml
- insert:
    - id: dsh-balance-lite
      name: '@zzxxxxxx/dsh-balance-lite'
      config:
        apiKeyEnv: DEEPSEEK_API_KEY
        apiOrigin: https://api.deepseek.com
        balancePath: /user/balance
        refreshIntervalMs: 30000          # how often the platform is polled
        requestTimeoutMs: 10000
        preferredCurrency: auto           # auto | CNY | USD
        staleAfterMs: 180000              # age at which the pill marks its number old
        clientPollIntervalMs: 15000       # how often the browser reads the snapshot
        allowLoopbackHttp: false          # local development only
```

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference (an environment-variable name) holding the key |
| `apiOrigin` | `https://api.deepseek.com` | Balance endpoint origin; must be https (loopback excepted) |
| `balancePath` | `/user/balance` | Balance endpoint path |
| `refreshIntervalMs` | `30000` | How often the platform is polled; denser does not update the number, only spends requests |
| `requestTimeoutMs` | `10000` | Per-request timeout |
| `preferredCurrency` | `auto` | Which wallet to show when there are several: `auto` prefers a funded one, else the first |
| `staleAfterMs` | `180000` | Age past which the reading counts as old (the dot turns amber) |
| `clientPollIntervalMs` | `15000` | How often the browser reads the snapshot |
| `allowLoopbackHttp` | `false` | Whether loopback `http` endpoints are accepted (local development) |

A few semantics:

- **The platform settles 1–5 minutes late**: that is a property of the balance endpoint, not a defect here. The pill shows the platform's last settled figure; money you have just spent appears once the next settlement lands.
- **The dot matters more than the number**: an amount is only meaningful when the credential is configured and the network is up, so "is this fresh?" is carried by the dot and the hover's read time rather than guessed from the figure.
- **`preferredCurrency` only matters on a multi-wallet account**: `auto` takes a funded CNY wallet, then a funded USD one, then the first entry — it never silently switches currency on a zero balance. A currency the account does not hold at all falls back the same way instead of blanking the pill.
- **`allowLoopbackHttp` is for local development only**: it is what permits an `http://127.0.0.1`-style endpoint; a real endpoint must be https.
- **The credential stays in the host half**: the snapshot the browser receives carries no key material, and the route must pass the host trust check (no cookie means 401).
- This plugin is young and may still have bugs. Please report problems in [Issues](https://github.com/zzzxxxxxxxxxx/dsh-balance-lite/issues) and attach the pill's text and dot colour — those two distinguish "no credential", "network down" and "platform refused" on their own.
