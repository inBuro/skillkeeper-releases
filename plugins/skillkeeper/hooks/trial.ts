// The trial, shared with the macOS app: one per machine (docs/shared_trial_spec.md).
// Pure: reading and writing ~/.claude/skillkeeper/trial.json lives in register.tsx.

/** Days counted from install, opened or not (owner, 2026-10-14): the app's MonetizationConfig. */
export const TRIAL_DAYS = 3

/** What the file and the store keep: `start` in Unix seconds, `last` a local `yyyy-MM-dd`. */
export type TrialState = { start: number; days: number; last: string }

export const BUY_URL = 'https://buy.skillkeeper.app'

/** The file's state, or undefined when it is missing a field or isn't JSON: a broken file never resets a trial. */
export function parseTrial(text: string | undefined): TrialState | undefined {
  if (typeof text !== 'string') return undefined
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    const { start, days, last } = d
    if (typeof start !== 'number' || !Number.isFinite(start) || start <= 0) return undefined
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return undefined
    // The app leaves `last` out until it counts a day.
    if (last !== undefined && typeof last !== 'string') return undefined
    return { start: Math.floor(start), days: Math.floor(days), last: last ?? '' }
  } catch {
    return undefined
  }
}

/** Two copies as one: the earliest start, the later last day with its day number. */
export function mergeTrials(a: TrialState | undefined, b: TrialState | undefined): TrialState | undefined {
  if (!a) return b
  if (!b) return a
  const later = a.last >= b.last ? a : b
  return { start: Math.min(a.start, b.start), days: later.days, last: later.last }
}

/** The trial's day number, counted from `start` in 24-hour days: the first 24 hours are day 1. */
export function dayNumber(state: TrialState, nowMs: number): number {
  return Math.floor(Math.max(0, nowMs / 1000 - state.start) / 86_400) + 1
}

/** Today marked once, whichever client opened first; `days` is the trial's day number now. */
export function countDay(state: TrialState, nowMs: number): TrialState {
  const today = localDay(nowMs)
  if (state.last === today) return state
  return { ...state, days: dayNumber(state, nowMs), last: today }
}

/** Open through the 3rd day since install, opened or not; the 4th locks. */
export function isTrialActive(state: TrialState, nowMs: number): boolean {
  return dayNumber(state, nowMs) <= TRIAL_DAYS
}

/** A local calendar day, as the app writes `last`. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The file's text: the state and the client that wrote it. */
export function trialFile(state: TrialState): string {
  return `${JSON.stringify({ start: state.start, days: state.days, last: state.last, by: 'mod' })}\n`
}

/** The buy link, tagged like the site's goToGumroad so a sale ties back. */
export function buyUrl(distinctId: string | undefined): string {
  return `${BUY_URL}?utm_source=mod${distinctId ? `&ph_did=${encodeURIComponent(distinctId)}` : ''}`
}

/** The locked line: `this Mac` on a Mac, `this computer` elsewhere. */
export function lockedLine(isMac: boolean): string {
  return `Trial already used on ${isMac ? 'this Mac' : 'this computer'}. 5h, 24h and Month need a license`
}
