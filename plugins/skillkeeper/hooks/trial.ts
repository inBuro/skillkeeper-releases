// The trial, shared with the macOS app: one per machine (docs/shared_trial_spec.md).
// Pure: reading and writing ~/.claude/skillkeeper/trial.json lives in register.tsx.

/** Hours counted from install by the clock, opened or not (owner, 2026-11-04: 5): the app's MonetizationConfig. */
export const TRIAL_HOURS = 5

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

/** Open for the first TRIAL_HOURS since install, opened or not; then locked. */
export function isTrialActive(state: TrialState, nowMs: number): boolean {
  return Math.max(0, nowMs / 1000 - state.start) < TRIAL_HOURS * 3600
}

/** Whole minutes left in the trial, 0 once it is over. */
export function trialMinutesLeft(state: TrialState, nowMs: number): number {
  return Math.max(0, Math.ceil((TRIAL_HOURS * 3600 - Math.max(0, nowMs / 1000 - state.start)) / 60))
}

/** `4h 20m`, `45m`: the time left, as the settings line shows it. */
export function formatLeft(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
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
