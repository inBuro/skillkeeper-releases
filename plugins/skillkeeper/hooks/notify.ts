/**
 * The app's notification layer, ported to the mod (owner, 2026-10-04): the kinds
 * that make sense inside Claude Code – this session's compact, the limit forecasts,
 * skill problems, outdated agent models. Cross-app ones (another session waiting,
 * open in an editor) stay in the macOS app. Copy is the app's, infostyle pass
 * (Notion «Уведомления – сводная таблица»). Pure functions: the module feeds them.
 */
import type { Context, Limit, LimitSample, Skill } from '../types'
import { parsePhrases } from './parse'
import { DESCRIPTION_LIMIT, contextLevel, modelName } from './stats'

export type NoticeGroup = 'now' | 'today' | 'anytime'
export type NoticeKind = 'compact' | 'fiveHour' | 'weekly' | 'agentSpike' | 'sharedTrigger' | 'overLimit' | 'outdatedModel'

/** Each kind's short name, as the app's: the card's "Stop showing …" and the Settings list. */
export const KIND_PLURAL: Record<NoticeKind, string> = {
  compact: 'compact hints',
  fiveHour: '5h forecasts',
  weekly: 'weekly forecasts',
  agentSpike: 'agent records',
  sharedTrigger: 'shared triggers',
  overLimit: 'long descriptions',
  outdatedModel: 'model updates',
}

/** The kinds Settings lists, in the app's order. */
export const NOTICE_KINDS: readonly NoticeKind[] = ['compact', 'fiveHour', 'weekly', 'agentSpike', 'sharedTrigger', 'overLimit', 'outdatedModel']

export type Notice = {
  /** Stable per occurrence: a dismissed one stays dismissed, the next comes back. */
  id: string
  kind: NoticeKind
  group: NoticeGroup
  /** The marker's colour, as the app's square. */
  color: string
  /** Line one: the name, then its kind in grey ("writing skill"). */
  subject?: string
  subjectType?: string
  /** Line two: what to do or what happened. */
  title: string
  body?: string
  /** A 0…1 bar after the name, and a tick where the suggestion starts. */
  bar?: number
  mark?: number
  /** The primary button: /compact in this session, or the agent's row. */
  action?: 'compact' | 'showAgent'
  /** What "Mute until tomorrow" mutes: one agent. */
  muteKey?: string
}

/** One subagent run, for the record check: its tokens and when it started and ended. */
export type RunTokens = { tokens: number; started: number; ended: number }

/**
 * The agent's record run, as the app's: ended in the last hour, bigger than every one of
 * its runs in the past 30 days (at least 10 of them) and over 200K tokens.
 */
export function spikeNotices(runs: Readonly<Record<string, readonly RunTokens[]>>, now: number): Notice[] {
  const out: Notice[] = []
  for (const [agent, all] of Object.entries(runs)) {
    const sorted = all.filter(r => r.ended > now - 30 * 86_400_000 && r.tokens > 0).sort((a, b) => a.ended - b.ended)
    const last = sorted[sorted.length - 1]
    if (!last || now - last.ended >= 3_600_000) continue
    const past = sorted.slice(0, -1).map(r => r.tokens)
    const record = Math.max(0, ...past)
    if (past.length < 10 || last.tokens <= record || last.tokens <= 200_000) continue
    const minutes = Math.max(1, Math.floor((last.ended - last.started) / 60_000))
    out.push({
      id: `agent|${agent}|${Math.floor(last.started / 1000)}`,
      kind: 'agentSpike',
      group: 'now',
      color: NOTICE_COLOR.agent,
      subject: agent,
      subjectType: 'agent',
      title: `Used ${tokenLabel(last.tokens)} tokens in ${minutes} min`,
      body: `Its biggest run in 30 days – the previous record was ${tokenLabel(record)}`,
      action: 'showAgent',
      muteKey: `agent|${agent}`,
    })
  }
  return out
}

/** What Settings turned off and what is muted until tomorrow drop out. */
export function visibleNotices(list: readonly Notice[], off: readonly string[], muted: Readonly<Record<string, number>>, now: number): Notice[] {
  return list.filter(n => !off.includes(n.kind) && !(n.muteKey !== undefined && (muted[n.muteKey] ?? 0) > now))
}

/** The start of tomorrow, local: when "Mute until tomorrow" ends. */
export function tomorrow(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/**
 * Theme keys, so the squares follow the person's Claude Code skin. One colour per
 * cohort, as the app (owner, 2026-10-04): chat, limit, agent, skill.
 */
export const NOTICE_COLOR = {
  chat: 'success',
  limit: 'claude',
  agent: 'error',
  skill: 'warning',
} as const

/** 142K, 1.2M – as the app's token labels. */
export function tokenLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

/**
 * This session's compact: from Claude Code's own warning line on. The mod runs in the
 * session, so the button compacts it for real – no clipboard, no switching.
 */
export function sessionNotices(ctx: Context | null): Notice[] {
  if (!ctx || ctx.tokens === undefined || ctx.window <= 0) return []
  const level = contextLevel(ctx.tokens, ctx.window)
  if (level === 'normal') return []
  const compactAt = ctx.window - 20_000 - 13_000
  const warningAt = compactAt - 20_000
  return [{
    id: `compact|${level}`,
    kind: 'compact',
    group: level === 'heavy' ? 'now' : 'today',
    color: NOTICE_COLOR.chat,
    subject: 'This',
    subjectType: 'session',
    title: 'Run /compact',
    body: level === 'heavy'
      ? `Each reply re-reads ${tokenLabel(ctx.tokens)}. Claude Code compacts this chat on its own soon`
      : `Each reply now re-reads ${tokenLabel(ctx.tokens)}`,
    bar: Math.min(1, ctx.tokens / ctx.window),
    mark: Math.min(1, warningAt / ctx.window),
    action: 'compact',
  }]
}

/** Adds the limits' current reading, one per kind and reading time; keeps the current window only. */
export function addSamples(samples: readonly LimitSample[], limits: readonly Limit[], at: number): LimitSample[] {
  const out = [...samples]
  for (const l of limits) {
    const resetsAt = Date.parse(l.resetsAt ?? '')
    if (!Number.isFinite(resetsAt)) continue
    if (out.some(s => s.kind === l.kind && Math.abs(s.at - at) < 1000)) continue
    out.push({ kind: l.kind, at, used: l.percentUsed, resetsAt })
  }
  return out
    .filter(s => limits.some(l => l.kind === s.kind && Math.abs(Date.parse(l.resetsAt ?? '') - s.resetsAt) < 120_000))
    .slice(-60)
}

/** "16:10" */
function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "40m", "1h 20m" */
function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function day(ms: number, now: number): string {
  const a = new Date(ms)
  const b = new Date(now)
  if (a.toDateString() === b.toDateString()) return 'today'
  if (new Date(now + 86_400_000).toDateString() === a.toDateString()) return 'tomorrow'
  return DAYS[a.getDay()] as string
}

function span(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 24) return Math.floor(hours / 24) === 1 ? '1 day' : `${Math.floor(hours / 24)} days`
  return `${Math.max(1, hours)}h`
}

/** Percent per ms over the recent samples of one kind, or undefined without enough history. */
function pace(samples: readonly LimitSample[], kind: string, weekly: boolean): { latest: LimitSample; perMs: number } | undefined {
  const own = samples.filter(s => s.kind === kind).sort((a, b) => a.at - b.at)
  const latest = own[own.length - 1]
  if (!latest) return undefined
  const span = weekly ? 24 * 3_600_000 : 3_600_000
  const minGap = weekly ? 3 * 3_600_000 : 15 * 60_000
  const earliest = own.find(s => s.at >= latest.at - span && s.at < latest.at)
  if (!earliest || latest.at - earliest.at < minGap || latest.used <= earliest.used) return undefined
  return { latest, perMs: (latest.used - earliest.used) / (latest.at - earliest.at) }
}

/** The limit forecasts: 5h within the hour it runs out, weekly a day or more early. */
export function limitNotices(samples: readonly LimitSample[], now: number): Notice[] {
  const out: Notice[] = []
  const five = pace(samples, 'five_hour', false)
  if (five && five.latest.used < 100) {
    const runsOut = five.latest.at + (100 - five.latest.used) / five.perMs
    const early = five.latest.resetsAt - runsOut
    const left = runsOut - now
    if (early > 5 * 60_000 && left > 0 && left <= 3_600_000) {
      out.push({
        id: `5h|${five.latest.resetsAt}`,
        kind: 'fiveHour',
        group: 'now',
        color: NOTICE_COLOR.limit,
        subject: '5h limit',
        title: `Runs out at ${clock(runsOut)} – ${duration(early)} before reset`,
        body: `${Math.round(five.latest.used)}% used. At the current pace Claude stops at ${clock(runsOut)} and comes back at ${clock(five.latest.resetsAt)}`,
        bar: five.latest.used / 100,
      })
    }
  }
  const week = pace(samples, 'seven_day', true)
  if (week && week.latest.used < 100) {
    const runsOut = week.latest.at + (100 - week.latest.used) / week.perMs
    if (week.latest.resetsAt - runsOut > 6 * 3_600_000 && runsOut > now) {
      out.push({
        id: `7d|${week.latest.resetsAt}`,
        kind: 'weekly',
        group: 'today',
        color: NOTICE_COLOR.limit,
        subject: 'Weekly limit',
        title: `Runs out ${day(runsOut, now)} – ${span(week.latest.resetsAt - runsOut)} before reset`,
        body: `${Math.round(week.latest.used)}% used, resets ${day(week.latest.resetsAt, now)} ${clock(week.latest.resetsAt)}`,
        bar: week.latest.used / 100,
      })
    }
  }
  return out
}

/** Shared triggers and too-long descriptions, as the app's library cards. */
export function libraryNotices(library: readonly Skill[]): Notice[] {
  const out: Notice[] = []
  const owners = new Map<string, { phrase: string; names: string[] }>()
  for (const skill of library) {
    const length = skill.description.length + skill.whenToUse.length
    if (length > DESCRIPTION_LIMIT) {
      out.push({
        id: `chars|${skill.name}|${length}`,
        kind: 'overLimit',
        group: 'anytime',
        color: NOTICE_COLOR.skill,
        subject: skill.name,
        subjectType: 'skill',
        title: `Description is ${length - DESCRIPTION_LIMIT} characters too long`,
        body: `Claude Code reads the first ${DESCRIPTION_LIMIT} characters. Triggers past that are ignored`,
      })
    }
    const p = parsePhrases(skill.description)
    for (const phrase of new Set([...p.triggers, ...p.commands].map(x => x.toLowerCase()))) {
      const entry = owners.get(phrase) ?? { phrase, names: [] }
      if (!entry.names.includes(skill.name)) entry.names.push(skill.name)
      owners.set(phrase, entry)
    }
  }
  for (const { phrase, names } of owners.values()) {
    if (names.length < 2) continue
    const [first, ...rest] = names as [string, ...string[]]
    out.push({
      id: `shared|${first}|${phrase}`,
      kind: 'sharedTrigger',
      group: 'anytime',
      color: NOTICE_COLOR.skill,
      subject: first,
      subjectType: 'skill',
      title: `Shares a trigger with the ${rest.join(' and ')} skill${rest.length > 1 ? 's' : ''}`,
      body: `On “${phrase}” Claude may load either skill. Keep the phrase in one of them`,
    })
  }
  return out
}

function familyVersion(name: string): { family: string; version: number[] } | undefined {
  const [family, v] = name.split(' ')
  if (!family || !v) return undefined
  const version = v.split('.').map(Number)
  return version.every(Number.isFinite) ? { family, version } : undefined
}

function older(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

/** The models the app knows as current, plus anything newer seen locally. */
export const CURRENT_MODELS = ['Opus 5.5', 'Sonnet 5.5', 'Fable 5.1', 'Haiku 4.5']

/**
 * The grey label of an Agents or Sessions row, as the app's: its model only when an older
 * one than its family's newest (`Opus 4.5`), nothing for a current one, never the effort.
 * `seen` adds the models met locally, so a newer one than the list counts as newest.
 */
export function outdatedLabel(key: string | undefined, seen: Iterable<string>): string | undefined {
  if (!key) return undefined
  const name = modelName(key.split('|')[0] ?? '')
  const fv = familyVersion(name)
  if (!fv) return undefined
  let top: number[] | undefined
  for (const candidate of [...CURRENT_MODELS, ...[...seen].map(id => modelName(id.split('|')[0] ?? ''))]) {
    const c = familyVersion(candidate)
    if (c && c.family === fv.family && (!top || older(top, c.version))) top = c.version
  }
  return top && older(fv.version, top) ? name : undefined
}

/** An agent whose heaviest model is older than its family's newest. */
export function modelNotices(agentModels: Readonly<Record<string, Readonly<Record<string, number>>>>): Notice[] {
  const newest = new Map<string, number[]>()
  const consider = (name: string) => {
    const fv = familyVersion(name)
    if (!fv) return
    const cur = newest.get(fv.family)
    if (!cur || older(cur, fv.version)) newest.set(fv.family, fv.version)
  }
  CURRENT_MODELS.forEach(consider)
  for (const models of Object.values(agentModels)) for (const key of Object.keys(models)) consider(modelName(key.split('|')[0] ?? ''))

  const out: Notice[] = []
  for (const [agent, models] of Object.entries(agentModels)) {
    const heaviest = Object.entries(models).sort((a, b) => b[1] - a[1])[0]
    if (!heaviest) continue
    const name = modelName(heaviest[0].split('|')[0] ?? '')
    const fv = familyVersion(name)
    const top = fv && newest.get(fv.family)
    if (!fv || !top || !older(fv.version, top)) continue
    out.push({
      id: `model|${agent}|${name}`,
      kind: 'outdatedModel',
      group: 'anytime',
      color: NOTICE_COLOR.agent,
      subject: agent,
      subjectType: 'agent',
      title: `Runs on ${name} – ${fv.family} ${top.join('.')} is out`,
      body: "The model is set in the agent's file: change model: to update",
    })
  }
  return out
}

const GROUP_ORDER: Record<NoticeGroup, number> = { now: 0, today: 1, anytime: 2 }

/** Every notice, urgent first, minus the dismissed ones. */
export function allNotices(parts: readonly Notice[][], dismissed: readonly string[]): Notice[] {
  return parts
    .flat()
    .filter(n => !dismissed.includes(n.id))
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group])
}
