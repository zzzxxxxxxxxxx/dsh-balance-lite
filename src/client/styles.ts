/**
 * The pill's stylesheet, injected as a `<style data-plugin="dsh-balance-lite">` element
 * from the plugin body.
 *
 * A hand-written sheet rather than CSS modules keeps the browser bundle a single script
 * with no build-time CSS pipeline. The declarations follow the shipped composer-dock pill
 * (`StatsPills.module.css`, the static `PlainPill` form) in its own order, so the two can
 * be compared line by line rather than by eye; the selectors are this plugin's own `data-*`
 * attributes instead of the host's hashed class names. `border: none` is a no-op on a
 * `span` and is kept because the host rule carries it.
 *
 * There is no hover treatment, matching the shipped rule for this pill form: in ui-chat's
 * StatsPills.module.css the hover background is scoped to `button.pill`, because "only the
 * button form (a pill with dialog rows to open) invites interaction; the static span form
 * keeps the resting tertiary reading". This is the static form, so it keeps the resting
 * tone even though it does have a hover surface (the tooltip) — the host's own `PlainPill`
 * behaves identically, pointer cursor and hover background alike. There is no
 * `[aria-expanded]` variant to mirror either, because nothing opens.
 *
 * @module dsh-balance-lite/client/styles
 */

/** `data-plugin` value identifying this plugin's injected stylesheet. */
export const STYLE_ID = 'dsh-balance-lite'

/** The complete stylesheet. */
export const STYLES = `
[data-dsh-balance-lite-anchor] {
  display: inline-flex;
  min-width: 0;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}

[data-dsh-balance-lite-pill] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  max-width: 100%;
  padding: 1px 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  line-height: inherit;
  white-space: nowrap;
}

[data-dsh-balance-lite-pill] svg {
  width: 14px;
  height: 14px;
  flex: none;
}

[data-dsh-balance-lite-pill] [data-dsh-balance-lite-label] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
`
