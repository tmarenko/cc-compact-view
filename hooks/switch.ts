import type { EngineInterface } from 'claude-code'

// The mod's on/off switch, saved across sessions, and its safety switch: the first error
// any hook hits turns the mod off for the session and brings back the normal view.

export const NAME = 'cc-compact-view'
export const COMMAND = 'compact-view'

const STORE_KEY = 'enabled'
// How long the error notice stays up, and how much of the error it quotes.
const NOTICE_MS = 20_000
const REASON_CHARS = 200

let enabled = true
let loaded: Promise<void> | undefined

type Store = { store: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> } }

// A resumed session draws its rows before session.start, so drawing waits on this too.
export function load($: Store, again = false) {
  if (again || !loaded) {
    loaded = $.store.get(STORE_KEY).then(
      v => {
        enabled = v !== false
      },
      () => {
        enabled = true
      },
    )
  }
  return loaded
}

export const isEnabled = () => enabled

// Switches and saves; false when the save failed and the switch holds for this session only.
export async function setEnabled($: Store, on: boolean) {
  enabled = on
  try {
    await $.store.set(STORE_KEY, on)
    return true
  } catch {
    return false
  }
}

// Set by the first error any hook hits: from then on every hook draws the stock way,
// so a half-working fold can never hide rows. Cleared by `/compact-view on` or a reload.
let broken: string | undefined

export const brokenReason = () => broken
export const isActive = () => enabled && broken === undefined

export function clearBroken() {
  broken = undefined
}

// Whether the fold draws on this drawing: switched on, no error so far, and the fullscreen terminal
// only. Only there do clicks reach a row and can a row already drawn be drawn again; on the main
// screen a run's first row, printed to scrollback before the run formed, could never become its
// line while the rest of the run hid.
export async function isFolding($: Store, e: { surface: string; viewport?: { isFullscreen?: boolean } }) {
  if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true) return false
  await load($)
  return isActive()
}

// Whether the one-line results draw: switched on and no error so far, on every surface.
export async function isShortening($: Store) {
  await load($)
  return isActive()
}

// Draws every row of the mod again, once the drawing in progress has returned.
export function redrawAll($: EngineInterface) {
  void $.clock
    .sleep(0)
    .then(() => $.ui.invalidate('ui.render'))
    .catch(() => undefined)
}

// Turns the mod off for the session after an error, tells the person once, and
// redraws every row the mod drew, now the normal way.
export function trip($: EngineInterface, where: string, error?: { kind: string; message?: string }) {
  if (broken !== undefined) return
  const why =
    error?.kind === 'timeout'
      ? 'took too long'
      : (error?.message ?? 'unknown error').split('\n')[0]!.slice(0, REASON_CHARS)
  broken = `${where}: ${why}`
  const text = `${NAME} hit an error and turned itself off for this session (${broken}). The normal Claude Code view is back; the mod needs a fix. /${COMMAND} shows the error.`
  try {
    $.ui.toast(text, { timeoutMs: NOTICE_MS })
  } catch {}
  try {
    $.ui.log(text)
  } catch {}
  redrawAll($)
}

// What every hook's `.catch` does: trips the mod off and lets the engine draw or run as if the
// hook weren't there. `next` is replay-safe there, so a call the hook already passed on never runs twice.
export function fallBack<E, R>(
  $: EngineInterface,
  where: string,
  e: E,
  next: { (e: E): R; error: { kind: string; message?: string } },
) {
  trip($, where, next.error)
  return next(e)
}
