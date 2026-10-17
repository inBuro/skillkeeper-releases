// Pure statistics and layout: history, periods, problem marks, list rows,
// the band and the idle toast. Nothing here touches `$`.

import type { DropdownKind, Hidden, History, Kind, Period, Skill, SortOrder, Source, TokenHours, Tokens } from '../types'
import { parsePhrases, stripPhrases } from './parse'

export const DAY = 86_400_000
export const HISTORY_DAYS = 90
export const HISTORY_CAP = 500
/** Tools run far more often than skills: Bash alone passes 500 in a week. */
export const ACTIVITY_CAP = 5000
export const DESCRIPTION_LIMIT = 1536
export const UNUSED_DAYS = 30
export const IDLE_TOAST_DAYS = 14

export const PERIODS: ReadonlyArray<{ id: Period; label: string }> = [
  { id: 'fiveHours', label: '5h' },
  { id: 'day', label: '24h' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

export const SORTS: ReadonlyArray<{ id: SortOrder; label: string }> = [
  { id: 'count', label: '321' },
  { id: 'usage', label: 'Usage' },
  { id: 'abc', label: 'ABC' },
  { id: 'last', label: 'Last' },
]

export function nextSort(sort: SortOrder): SortOrder {
  const index = SORTS.findIndex(s => s.id === sort)
  return (SORTS[(index + 1) % SORTS.length] as (typeof SORTS)[number]).id
}

/** Where a period starts, in ms. */
export function periodStart(period: Period, now: number, sessionStart: number): number {
  switch (period) {
    case 'fiveHours':
      return now - 5 * 3_600_000
    case 'day':
      return now - DAY
    case 'week':
      return now - 7 * DAY
    case 'month':
      return now - 30 * DAY
  }
}

export function countSince(history: History, name: string, since: number): number {
  let n = 0
  for (const at of history[name] ?? []) if (at >= since) n++
  return n
}

export function lastAt(history: History, name: string): number | undefined {
  const list = history[name]
  return list && list.length > 0 ? list[list.length - 1] : undefined
}

/** Adds invocations, keeping 90 days and at most 500 per skill. */
export function addCalls(history: History, calls: ReadonlyArray<{ name: string; at: number }>, now: number, cap = HISTORY_CAP): History {
  const out: History = { ...history }
  // Each touched list is copied once: a month of history holds tens of thousands of calls.
  const touched = new Set<string>()
  for (const { name, at } of calls) {
    if (!touched.has(name)) {
      out[name] = [...(out[name] ?? [])]
      touched.add(name)
    }
    ;(out[name] as number[]).push(at)
  }
  for (const name of touched) (out[name] as number[]).sort((a, b) => a - b)
  return pruneHistory(out, now, cap)
}

export function pruneHistory(history: History, now: number, cap = HISTORY_CAP): History {
  const since = now - HISTORY_DAYS * DAY
  const out: History = {}
  for (const [name, list] of Object.entries(history)) {
    const kept = list.filter(at => at >= since).slice(-cap)
    if (kept.length > 0) out[name] = kept
  }
  return out
}

export type Mark = { level: 'warn' | 'error'; reason: string }

export function formatThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * The app's problem marks per skill name, red ones first. Duplicate-trigger marks are
 * a Pro feature, as in the app: `shared: false` leaves them out.
 */
export function computeMarks(library: readonly Skill[], options: { shared?: boolean } = {}): Map<string, Mark[]> {
  const marks = new Map<string, Mark[]>()
  const add = (name: string, mark: Mark) => marks.set(name, [...(marks.get(name) ?? []), mark])
  const owners = new Map<string, { phrase: string; names: string[] }>()

  for (const skill of library) {
    const phrases = parsePhrases(skill.description)
    if (phrases.commands.length > 1) {
      add(skill.name, { level: 'error', reason: `${phrases.commands.length} slash commands, keep one` })
    }
    if (skill.description.trim() === '' && phrases.triggers.length === 0 && phrases.commands.length === 0) {
      add(skill.name, { level: 'warn', reason: 'No description, trigger phrase, or slash command – Claude Code has nothing to match this skill on' })
    }
    const length = skill.description.length + skill.whenToUse.length
    if (length > DESCRIPTION_LIMIT) {
      add(skill.name, {
        level: 'warn',
        reason: `description ${formatThousands(length)} / ${formatThousands(DESCRIPTION_LIMIT)} – cut silently`,
      })
    }
    const seen = new Set<string>()
    for (const phrase of [...phrases.triggers, ...phrases.commands]) {
      const key = phrase.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const entry = owners.get(key) ?? { phrase, names: [] }
      entry.names.push(skill.name)
      owners.set(key, entry)
    }
  }

  for (const { phrase, names } of owners.values()) {
    if (names.length < 2 || options.shared === false) continue
    for (const name of names) {
      const other = names.find(n => n !== name) as string
      add(name, { level: 'warn', reason: `“${phrase}” also routes to ${other}` })
    }
  }

  for (const [name, list] of marks) {
    marks.set(name, [...list].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)))
  }
  return marks
}

export type Row = {
  kind: 'skill' | 'group' | 'sub'
  name: string
  /** What the row counts; in All a label names it. */
  source?: Kind
  /** Calls in the selected period; for a group, its own and its subskills'. */
  period: number
  /** Tokens charged in the selected period, the same way. */
  tokens: number
  /** Calls in the whole history; for a group, its subskills' sum. */
  total: number
  lastAt?: number
  /** A group's subskills that fired in the period, and how many it has. */
  fired?: number
  size?: number
  isCollapsed?: boolean
  /** A router's own tokens, without its subskills': the figure the app shows on it in Usage. */
  ownTokens?: number
  /** A subskill shown under its collapsed router, as the app peeks the ones that matter for the sort. */
  isPeek?: boolean
  isFavorite?: boolean
  isOnStart?: boolean
  marks: Mark[]
  isHidden: boolean
  isNew: boolean
}

export type LayoutInput = {
  library: readonly Skill[]
  history: History
  since: number
  sort: SortOrder
  collapsed: readonly string[]
  /** Routers opened in 321, Usage and Last, where every router starts collapsed. */
  expanded?: readonly string[]
  favorites?: readonly string[]
  onStart?: readonly string[]
  hidden: Hidden | null
  baseline: readonly string[] | null
  marks?: Map<string, Mark[]>
  tokens?: Record<string, TokenHours>
}

/** One list: groups and standalone skills ranked together, subskills under their group. */
export function layoutRows(input: LayoutInput): Row[] {
  const { library, history, since, sort, collapsed, hidden, baseline } = input
  const marks = input.marks ?? computeMarks(library)
  const hiddenNames = new Set(hidden?.names ?? [])
  const baselineSet = baseline ? new Set(baseline) : null
  const routers = new Set(library.filter(s => s.router).map(s => s.router as string))

  const leaf = (skill: Skill, kind: Row['kind']): Row => {
    const total = (history[skill.name] ?? []).length
    return {
      kind,
      name: skill.name,
      period: countSince(history, skill.name, since),
      tokens: tokensSince(input.tokens?.[skill.name], since),
      total,
      lastAt: lastAt(history, skill.name),
      marks: marks.get(skill.name) ?? [],
      isFavorite: input.favorites?.includes(skill.name) ?? false,
      isOnStart: input.onStart?.includes(skill.name) ?? false,
      isHidden: hiddenNames.has(skill.name),
      isNew: baselineSet !== null && !baselineSet.has(skill.name) && total === 0,
    }
  }

  const top: Array<{ row: Row; children: Row[] }> = []
  for (const skill of library) {
    if (skill.router) continue
    if (!routers.has(skill.name)) {
      top.push({ row: leaf(skill, 'skill'), children: [] })
      continue
    }
    const children = library.filter(s => s.router === skill.name).map(s => leaf(s, 'sub'))
    const own = leaf(skill, 'group')
    const lasts = children.map(c => c.lastAt ?? 0).concat(own.lastAt ?? 0)
    const newest = Math.max(...lasts)
    top.push({
      row: {
        ...own,
        // As the app ranks a group: its own calls plus every subskill's.
        period: own.period + children.reduce((n, c) => n + c.period, 0),
        tokens: own.tokens + children.reduce((n, c) => n + c.tokens, 0),
        ownTokens: own.tokens,
        total: own.total + children.reduce((n, c) => n + c.total, 0),
        lastAt: newest > 0 ? newest : undefined,
        fired: children.filter(c => c.period > 0).length,
        size: children.length,
        // As the app: ABC keeps the routers the person collapsed; the other sorts start
        // every router collapsed and remember openings for the session.
        isCollapsed: sort === 'abc' ? collapsed.includes(skill.name) : !(input.expanded ?? []).includes(skill.name),
        isNew: own.isNew && children.every(c => c.total === 0),
      },
      children: sortRows(children, sort),
    })
  }

  const ordered = sortRows(top.map(t => t.row), sort)
  const out: Row[] = []
  for (const row of ordered) {
    out.push(row)
    const entry = top.find(t => t.row === row) as (typeof top)[number]
    if (!row.isCollapsed) out.push(...entry.children)
    else out.push(...peek(entry.children, sort).map(c => ({ ...c, isPeek: true })))
  }
  return out
}

/** The subskills a collapsed router shows, as the app picks them for each sort. */
export function peek(children: readonly Row[], sort: SortOrder): Row[] {
  switch (sort) {
    case 'count':
      return children.filter(c => c.period > 0).sort((a, b) => b.period - a.period || a.name.localeCompare(b.name))
    case 'usage':
      return children.filter(c => c.tokens > 0).sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
    case 'last':
      return children.filter(c => c.period > 0).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.name.localeCompare(b.name))
    case 'abc':
      return []
  }
}

export function sortRows(rows: readonly Row[], sort: SortOrder): Row[] {
  const byName = (a: Row, b: Row) => a.name.localeCompare(b.name)
  const list = [...rows]
  switch (sort) {
    case 'count':
      return list.sort((a, b) => b.period - a.period || byName(a, b))
    case 'usage':
      return list.sort((a, b) => b.tokens - a.tokens || byName(a, b))
    case 'abc':
      return list.sort(byName)
    case 'last':
      // Activity in the period first, then the most recent call.
      return list.sort(
        (a, b) => Number(b.period > 0) - Number(a.period > 0) || (b.lastAt ?? 0) - (a.lastAt ?? 0) || byName(a, b),
      )
  }
}

/** Names of top-level skills the listing left out: not in `skillFrontmatter`. */
export function hiddenNames(library: readonly Skill[], listed: readonly string[]): string[] {
  const seen = new Set(listed.map(n => n.slice(n.lastIndexOf(':') + 1)))
  return library.filter(s => !s.router && !s.isUserOnly && !seen.has(s.name)).map(s => s.name)
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}


/** The idle toast for a call at `now`, given the skill's previous call. */
export function idleToast(name: string, previous: number | undefined, now: number, isKnownIdle: boolean): string | undefined {
  if (previous === undefined) {
    return isKnownIdle ? `skillkeeper · ${name} fired – idle for ${UNUSED_DAYS}+ days` : undefined
  }
  const days = Math.floor((now - previous) / DAY)
  return days >= IDLE_TOAST_DAYS ? `skillkeeper · ${name} fired – idle for ${days} days` : undefined
}

export function ago(at: number | undefined, now: number): string {
  if (at === undefined) return 'never'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < DAY / 1000) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function clockTime(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** A stored sort from before Last replaced New. */
export function normalizeSort(sort: string): SortOrder {
  return sort === 'usage' || sort === 'abc' || sort === 'last' ? sort : sort === 'new' ? 'last' : 'count'
}

export const SOURCE_LABEL: Record<Source, string> = {
  all: 'All',
  skills: 'Skills',
  agents: 'Agents',
  tools: 'Tools',
  mcp: 'MCP',
  commands: 'Commands',
  sessions: 'Sessions',
  memory: 'Memory',
  hooks: 'Hooks',
  plugins: 'Plugins',
}

/** A row's kind label in All, as the app's. */
export const KIND_LABEL: Record<Kind, string> = {
  skills: 'skill',
  agents: 'agent',
  tools: 'tool',
  mcp: 'MCP',
  commands: 'command',
  sessions: 'session',
  memory: 'memory',
  hooks: 'hook',
  plugins: 'plugin',
}

/** The switcher's third slot drops down over these, in the app's order. */
export const DROPDOWN: readonly DropdownKind[] = ['agents', 'sessions', 'tools', 'mcp', 'commands', 'memory', 'hooks', 'plugins']

/** What All mixes, as the app's: every token source; sessions and hooks stay out. */
export const ALL_KINDS: readonly Kind[] = ['skills', 'agents', 'tools', 'mcp', 'commands', 'memory', 'plugins']

/** The app's duration: `340ms`, `12s`, `4m`, `2h`. */
export function durationText(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 3_600_000)}h`
}

/** Plain rows, one per name, for a kind with no groups. */
export function flatRows(history: History, since: number, source: Kind, tokens?: Record<string, TokenHours>): Row[] {
  const names = new Set([...Object.keys(history), ...Object.keys(tokens ?? {})])
  return [...names].map(name => ({
    kind: 'skill' as const,
    name,
    source,
    period: countSince(history, name, since),
    tokens: tokensSince(tokens?.[name], since),
    total: (history[name] ?? []).length,
    lastAt: lastAt(history, name),
    marks: [],
    isHidden: false,
    isNew: false,
  }))
}

/**
 * A row's usage bar on one scale shared by every row, as the app draws it:
 * `fill` cells of the bar and `rest` cells of track, one stroke for both (the
 * colour tells them apart); whole cells, so the fill meets the track with no
 * gap, and a share above zero shows at least one.
 */
export function barCells(fraction: number, width: number): { fill: string; rest: string } {
  const share = Math.min(1, Math.max(0, fraction))
  const full = share > 0 ? Math.max(1, Math.round(share * width)) : 0
  return { fill: '━'.repeat(full), rest: '━'.repeat(width - full) }
}

/** Sums neighbouring buckets down to `size` of them. */
function mergeBuckets(counts: readonly number[], size: number): number[] {
  const out = new Array<number>(size).fill(0)
  counts.forEach((count, i) => {
    const j = Math.min(size - 1, Math.floor((i * size) / counts.length))
    out[j] = (out[j] ?? 0) + count
  })
  return out
}

const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** The chart's window and bar count per period, as the app's chart has them. */
export function chartWindow(period: Period, now: number): { start: number; end: number; count: number } {
  const HALF_HOUR = 1_800_000
  switch (period) {
    case 'fiveHours': {
      // 10 bars ending at the close of the current half hour.
      const end = Math.ceil(now / HALF_HOUR) * HALF_HOUR
      return { start: end - 5 * 3_600_000, end, count: 10 }
    }
    case 'day':
      return { start: now - DAY, end: now, count: 24 }
    case 'week':
      return { start: now - 8 * DAY, end: now, count: 8 }
    case 'month':
      return { start: now - 30 * DAY, end: now, count: 30 }
  }
}

/**
 * The activity chart: `count` bars over [start, end) across `columns`, one
 * row of eighth blocks scaled to the busiest bar (two rows leave a seam where
 * a terminal draws blocks short of the cell). `bars` holds each bar's cells;
 * in `bottom` an empty bar's stub is `_`.
 */
export function sparkline(
  times: ReadonlyArray<number | { at: number; weight: number }>,
  window: { start: number; end: number; count: number },
  columns: number,
  peakOf?: number,
): { bottom: string; bars: Array<{ text: string; isEmpty: boolean }>; total: number; counts: number[] } {
  const counts = chartCounts(times, window)
  const total = counts.reduce((n, c) => n + c, 0)
  // No gaps: bars stand edge to edge, told apart by alternating shades where
  // drawn. Narrower than the bars, neighbours merge; left-over columns widen
  // bars, spread evenly, so the chart reaches the right edge and never wraps.
  const width = Math.max(1, columns)
  const merged = counts.length > width ? mergeBuckets(counts, width) : counts
  const n = merged.length
  const peak = Math.max(1, peakOf ?? 0, ...merged)
  let bottom = ''
  const bars: Array<{ text: string; isEmpty: boolean }> = []
  merged.forEach((count, i) => {
    const bar = Math.max(1, Math.floor(((i + 1) * width) / n) - Math.floor((i * width) / n))
    const level = count === 0 ? 0 : Math.max(1, Math.round((count / peak) * 8))
    const text = (level === 0 ? '▁' : (SPARKS[level - 1] as string)).repeat(bar)
    bars.push({ text, isEmpty: level === 0 })
    bottom += level === 0 ? '_'.repeat(bar) : text
  })
  return { bottom, bars, total, counts }
}

/** What each bar of the chart holds: calls, or weighted items such as tokens. */
export function chartCounts(times: ReadonlyArray<number | { at: number; weight: number }>, window: { start: number; end: number; count: number }): number[] {
  const { start, end, count } = window
  const counts = new Array<number>(Math.max(1, count)).fill(0)
  const span = Math.max(1, end - start)
  for (const item of times) {
    const at = typeof item === 'number' ? item : item.at
    if (at < start || at >= end) continue
    const index = Math.min(counts.length - 1, Math.floor(((at - start) / span) * counts.length))
    counts[index] = (counts[index] ?? 0) + (typeof item === 'number' ? 1 : item.weight)
  }
  return counts
}

/** The app's reset countdown: `3d`, `2h`, `14m`. */
export function countdown(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes >= 24 * 60) return `${Math.floor(minutes / (24 * 60))}d`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`
  return `${minutes}m`
}

/** Every color is a key of the person's Claude Code theme, so the panel follows their skin. */
export const GREEN = 'success'

/** The limit's color, which the usage bars take too: green, Claude orange past 80, red past 100; theme keys. */
export function limitColor(percent: number | undefined): string {
  if (percent === undefined) return 'inactive'
  if (percent < 80) return GREEN
  if (percent < 100) return 'claude'
  return 'error'
}

/** A short count split as the app draws it: the number, then its unit in a column of its own. */
export function countParts(n: number): { num: string; unit: string } {
  const text = countText(n)
  const unit = /[KMB]$/.test(text) ? text.slice(-1) : ''
  return { num: unit ? text.slice(0, -1) : text, unit }
}

/** The app's short count: `340`, `5K`, `15K`, `2M`, `4.1B`; K and M whole. */
export function countText(n: number): string {
  if (n >= 1_000_000_000) {
    const b = n / 1_000_000_000
    const text = b >= 100 ? String(Math.round(b)) : b.toFixed(1)
    return `${text.endsWith('.0') ? text.slice(0, -2) : text}B`
  }
  if (n >= 999_500) return `${Math.round(n / 1_000_000)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export const HOUR = 3_600_000
export const TOKEN_DAYS = 31

/** Adds tokens into hour buckets, keeping 31 days. */
export function addHours(hours: TokenHours, items: ReadonlyArray<{ at: number; tokens: number }>, now: number): TokenHours {
  const first = Math.floor((now - TOKEN_DAYS * DAY) / HOUR)
  const out: TokenHours = {}
  for (const [hour, tokens] of Object.entries(hours)) if (Number(hour) >= first) out[hour] = tokens
  for (const { at, tokens } of items) {
    const hour = String(Math.floor(at / HOUR))
    if (Number(hour) >= first && tokens > 0) out[hour] = (out[hour] ?? 0) + tokens
  }
  return out
}

/**
 * Where a context gets expensive, by Claude Code's own thresholds as the app
 * keeps them: `compact` where auto-compact fires (the window less the output
 * reserve and the buffer), `warning` where its context indicator appears.
 */
export function contextLevel(tokens: number, window: number): 'normal' | 'warning' | 'heavy' {
  const compact = window - 20_000 - 13_000
  if (tokens >= compact) return 'heavy'
  if (tokens >= compact - 20_000) return 'warning'
  return 'normal'
}

/**
 * The hours an index run recounts from the transcripts: from `since`'s hour
 * through the hour it began in, whose live charges the transcripts hold too.
 */
export function isIndexHour(hour: number, since: number, began: number): boolean {
  return hour >= Math.floor(since / HOUR) && hour <= Math.floor(began / HOUR)
}

/** Hours of a token book an index run keeps: the ones it does not recount. */
export function keepHours(hours: TokenHours, since: number, began: number): TokenHours {
  return Object.fromEntries(Object.entries(hours).filter(([hour]) => !isIndexHour(Number(hour), since, began)))
}

export const EMPTY_TOKENS: Tokens = { skills: {}, agents: {}, tools: {}, mcp: {}, commands: {}, sessions: {}, memory: {}, hooks: {}, plugins: {} }

/** Tokens in the hours that start at or after `since`'s hour. */
export function tokensSince(hours: TokenHours | undefined, since: number): number {
  if (!hours) return 0
  const first = Math.floor(since / HOUR)
  let sum = 0
  for (const [hour, tokens] of Object.entries(hours)) if (Number(hour) >= first) sum += tokens
  return sum
}

/** Adds charges into hour buckets, keeping 31 days. */
export function addTokens(book: Tokens, charges: ReadonlyArray<{ kind: Kind; name: string; at: number; tokens: number }>, now: number): Tokens {
  const out: Tokens = { ...EMPTY_TOKENS }
  for (const kind of Object.keys(EMPTY_TOKENS) as Kind[]) out[kind] = { ...(book[kind] ?? {}) }
  // Each touched row is copied once, then added to in place.
  const touched = new Set<string>()
  for (const { kind, name, at, tokens } of charges) {
    if (tokens <= 0) continue
    const hour = String(Math.floor(at / HOUR))
    const key = `${kind}\u0000${name}`
    if (!touched.has(key)) {
      out[kind][name] = { ...(out[kind][name] ?? {}) }
      touched.add(key)
    }
    const hours = out[kind][name] as TokenHours
    hours[hour] = (hours[hour] ?? 0) + tokens
  }
  return pruneTokens(out, now)
}

export function pruneTokens(book: Tokens, now: number): Tokens {
  const first = Math.floor((now - TOKEN_DAYS * DAY) / HOUR)
  const out: Tokens = { ...EMPTY_TOKENS }
  for (const kind of Object.keys(EMPTY_TOKENS) as Kind[]) {
    const names: Record<string, TokenHours> = {}
    for (const [name, hours] of Object.entries(book[kind] ?? {})) {
      const kept = Object.fromEntries(Object.entries(hours).filter(([hour]) => Number(hour) >= first))
      if (Object.keys(kept).length > 0) names[name] = kept
    }
    out[kind] = names
  }
  return out
}

/**
 * One model call's charges, as the app splits them: the whole call to the
 * turn's skill and command, and evenly across the tools whose results it read.
 */
export function chargeCall(
  tokens: number,
  at: number,
  turn: { skills: readonly string[]; command?: string; tools: ReadonlyArray<{ kind: Kind; name: string }> },
): Array<{ kind: Kind; name: string; at: number; tokens: number }> {
  const out: Array<{ kind: Kind; name: string; at: number; tokens: number }> = []
  for (const name of turn.skills) out.push({ kind: 'skills', name, at, tokens })
  if (turn.command) out.push({ kind: 'commands', name: turn.command, at, tokens })
  const share = turn.tools.length > 0 ? Math.round(tokens / turn.tools.length) : 0
  for (const tool of turn.tools) out.push({ ...tool, at, tokens: share })
  return out
}

/** A row's key across tabs: `<kind>:<name>`. */
export function rowKey(row: Pick<Row, 'name' | 'source'>): string {
  return `${row.source ?? 'skills'}:${row.name}`
}

/** Word-wraps text into lines of at most `width` cells; long words are cut. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(8, width)
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      for (let piece = word; piece.length > 0; piece = piece.slice(w)) {
        const chunk = piece.slice(0, w)
        if (line === '') line = chunk
        else if (line.length + 1 + chunk.length <= w) line += ` ${chunk}`
        else {
          out.push(line)
          line = chunk
        }
      }
    }
    out.push(line)
  }
  return out
}

/** Cuts a label to `width` cells with an ellipsis. */
export function clip(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`
}

/**
 * The rows a search keeps, as the app's Mac search: by name, case-insensitive; a
 * router whose name matches keeps every subskill, else only the matching ones.
 */
export function searchRows(rows: readonly Row[], query: string, children: (group: string) => Row[]): Row[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...rows]
  const out: Row[] = []
  for (const row of rows) {
    if (row.kind === 'sub') continue
    const isHit = row.name.toLowerCase().includes(q)
    if (row.kind !== 'group') {
      if (isHit) out.push(row)
      continue
    }
    const kids = children(row.name)
    const hits = isHit ? kids : kids.filter(c => c.name.toLowerCase().includes(q))
    if (isHit || hits.length > 0) out.push({ ...row, isCollapsed: false }, ...hits.map(c => ({ ...c, isPeek: false })))
  }
  return out
}

/** The card a skill row opens, as the app's description popover lays it out. */
export type SkillCard = {
  description: string
  triggers: Array<{ phrase: string; sharedWith: string[] }>
  commands: Array<{ command: string; sharedWith: string[] }>
  isUnmatched: boolean
}

export function skillCard(skill: Skill, library: readonly Skill[], showShared = true): SkillCard {
  const phrases = parsePhrases(skill.description)
  const owners = (phrase: string) =>
    !showShared
      ? []
      : library
      .filter(s => s.name !== skill.name)
      .filter(s => {
        const p = parsePhrases(s.description)
        return [...p.triggers, ...p.commands].some(x => x.toLowerCase() === phrase.toLowerCase())
      })
      .map(s => s.name)
  // The description as the app shows it: its prose, the marker sections listed apart.
  const prose = stripPhrases(skill.description)
  return {
    description: [prose, skill.whenToUse.trim()].filter(Boolean).join('\n'),
    triggers: phrases.triggers.map(phrase => ({ phrase, sharedWith: owners(phrase) })),
    commands: phrases.commands.map(command => ({ command, sharedWith: owners(command) })),
    isUnmatched: skill.description.trim() === '' && phrases.triggers.length === 0 && phrases.commands.length === 0,
  }
}

/** The lines a card takes, for windowing the list around it. */
export function cardLines(card: SkillCard, width: number): string[][] {
  const lines: string[][] = [['actions']]
  if (card.isUnmatched) lines.push(['unmatched'])
  if (card.description) {
    lines.push(['head', 'Description'])
    for (const line of wrapText(card.description, width)) lines.push(['text', line])
  }
  if (card.triggers.length > 0) {
    lines.push(['head', 'Text triggers'])
    for (const t of card.triggers) lines.push(['trigger', t.phrase, t.sharedWith.join(', ')])
  }
  if (card.commands.length > 0) {
    lines.push(['head', 'Slash triggers'])
    for (const c of card.commands) lines.push(['command', c.command, c.sharedWith.join(', ')])
  }
  return lines
}

/** A row with nothing counted: an agent defined but never run. */
export function blankRow(name: string, source: Kind): Row {
  return { kind: 'skill', name, source, period: 0, tokens: 0, total: 0, marks: [], isHidden: false, isNew: false }
}

/** `claude-opus-5-5` → `Opus 5.5`, as the app names a model. */
export function modelName(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?/.exec(id)
  if (!m) return id
  const family = (m[1] as string).charAt(0).toUpperCase() + (m[1] as string).slice(1)
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

const EFFORT: Record<string, string> = { low: 'Lw', medium: 'Md', high: 'Hg', xhigh: 'X.H', max: 'Mx' }

/** An agent's grey label, as the app's: its heaviest model and effort (`Opus 5.5 · Md`). */
export function modelLabel(models: Record<string, number> | undefined): string | undefined {
  const top = Object.entries(models ?? {}).sort((a, b) => b[1] - a[1])[0]
  if (!top) return undefined
  const [model = '', effort = ''] = top[0].split('|')
  return EFFORT[effort] ? `${modelName(model)} · ${EFFORT[effort]}` : modelName(model)
}

/** An agent's grey label from its latest model, `model|effort` (`Opus 5.5 · Hg`). */
export function lastModelLabel(key: string | undefined): string | undefined {
  return key ? modelLabel({ [key]: 1 }) : undefined
}

/** The models line of the agent card: `Opus 5.5 high · 12M, Haiku 4.5 · 1M`. */
export function modelsLine(models: Record<string, number> | undefined): string {
  return Object.entries(models ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([key, tokens]) => {
      const [model = '', effort = ''] = key.split('|')
      return `${modelName(model)}${effort ? ` ${effort}` : ''} · ${countText(tokens)}`
    })
    .join(', ')
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * The limits in `claude -p /usage`: `Current session: 34% used · resets Oct 3 at 1:59am`
 * and `Current week (all models): 11% used · resets …`. The reset is local time.
 */
export function parseUsage(text: string, now: number): Array<{ kind: string; percentUsed: number; resetsAt?: string }> {
  const out: Array<{ kind: string; percentUsed: number; resetsAt?: string }> = []
  const rows: Array<[RegExp, string]> = [
    [/Current session:\s*(\d+(?:\.\d+)?)% used(?:\s*·\s*resets ([^(\n]+))?/, 'five_hour'],
    [/Current week \(all models\):\s*(\d+(?:\.\d+)?)% used(?:\s*·\s*resets ([^(\n]+))?/, 'seven_day'],
  ]
  for (const [re, kind] of rows) {
    const m = re.exec(text)
    if (!m) continue
    const resets = m[2] ? resetTime(m[2].trim(), now) : undefined
    out.push({ kind, percentUsed: Number(m[1]), ...(resets !== undefined ? { resetsAt: new Date(resets).toISOString() } : {}) })
  }
  return out
}

/** `Oct 3 at 1:59am`, `Oct 9 at 12am` or `1:59am` → the next such moment, local time. */
function resetTime(text: string, now: number): number | undefined {
  const m = /(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text)
  if (!m) return undefined
  const base = new Date(now)
  const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : base.getMonth()
  const day = m[2] ? Number(m[2]) : base.getDate()
  let hour = Number(m[3]) % 12
  if ((m[5] as string).toLowerCase() === 'pm') hour += 12
  const at = new Date(base.getFullYear(), month < 0 ? base.getMonth() : month, day, hour, Number(m[4] ?? 0)).getTime()
  // A date already behind us falls in the next year (or, for a bare time, the next day).
  return at < now - 60_000 ? (m[1] ? new Date(base.getFullYear() + 1, month, day, hour, Number(m[4] ?? 0)).getTime() : at + DAY) : at
}

/** The agent card, as the app's agent popover: description, models, preloaded skills, past runs. */
export function agentCardLines(
  def: { description: string; skills: string[]; model?: string } | undefined,
  models: Record<string, number> | undefined,
  ran: Record<string, number> | undefined,
  width: number,
): string[][] {
  const lines: string[][] = [['actions']]
  if (def?.description) for (const line of wrapText(def.description, width).slice(0, 8)) lines.push(['text', line])
  else lines.push(['note', def ? 'No description' : 'Built-in agent – no definition file to edit'])
  const used = modelsLine(models)
  for (const line of wrapText(`Models: ${used || def?.model || '–'}`, width)) lines.push(['note', line])
  lines.push(['head', 'Preloaded skills'])
  if (def && def.skills.length > 0) for (const skill of def.skills) lines.push(['item', skill])
  else lines.push(['note', 'None – the agent loads skills on demand'])
  lines.push(['head', 'Skills invoked in past runs'])
  const top = Object.entries(ran ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
  // The name left, its tokens right-aligned (owner, 2026-10-05).
  if (top.length > 0) for (const [skill, tokens] of top) lines.push(['spend', skill, '', countText(tokens)])
  else lines.push(['note', 'None yet'])
  return lines
}

/** Token hours as chart items: each hour's tokens at the middle of the hour. */
export function hourItems(hours: TokenHours | undefined): Array<{ at: number; weight: number }> {
  return Object.entries(hours ?? {}).map(([hour, tokens]) => ({ at: Number(hour) * HOUR + HOUR / 2, weight: tokens }))
}

/**
 * The chart's time marks, as the app's axis: 5h whole hours; 24h now at the right and
 * 6-hour steps back; Week the weekday names; Month five dates. One line of `width`.
 */
export function axisLine(period: Period, window: { start: number; end: number }, now: number, width: number): string {
  const span = Math.max(1, window.end - window.start)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = (t: number) => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const marks: Array<{ at: number; text: string }> = []
  if (period === 'fiveHours') {
    for (let t = Math.ceil(window.start / HOUR) * HOUR; t <= window.end; t += HOUR) marks.push({ at: t, text: hm(t) })
  } else if (period === 'day') {
    for (let i = 4; i >= 0; i--) marks.push({ at: now - i * 6 * HOUR, text: hm(now - i * 6 * HOUR) })
  } else if (period === 'week') {
    for (let i = 0; i < 5; i++) {
      const t = window.start + (i * span) / 4
      marks.push({ at: t, text: DAYS[new Date(t).getDay()] as string })
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const t = window.start + (i * span) / 4
      const d = new Date(t)
      marks.push({ at: t, text: i === 0 || i === 4 ? `${d.getDate()} ${MON[d.getMonth()]}` : String(d.getDate()) })
    }
  }
  const line = new Array<string>(Math.max(1, width)).fill(' ')
  let lastEnd = -1
  marks.forEach((mark, i) => {
    const x = Math.round(((mark.at - window.start) / span) * (width - 1))
    // The first mark starts at its place, the last ends at it, the rest centre on it.
    const want = i === 0 ? x : i === marks.length - 1 ? x - mark.text.length + 1 : x - Math.floor(mark.text.length / 2)
    const from = Math.max(0, Math.min(width - mark.text.length, want))
    if (from <= lastEnd) return
    for (let k = 0; k < mark.text.length && from + k < width; k++) line[from + k] = mark.text[k] as string
    lastEnd = from + mark.text.length
  })
  return line.join('')
}

/**
 * The period's chart as the app lights a hovered row: every bar keeps the period's
 * height, so nothing moves; bars where the row ran stay green, the rest go grey.
 */
export function overlayBars(base: readonly number[], row: readonly number[], columns: number): Array<{ text: string; isRow: boolean }> {
  const width = Math.max(1, columns)
  const merge = (c: readonly number[]) => (c.length > width ? mergeBuckets(c, width) : [...c])
  const b = merge(base)
  const r = merge(row)
  const n = b.length
  const peak = Math.max(1, ...b)
  return b.map((count, i) => {
    const bar = Math.max(1, Math.floor(((i + 1) * width) / n) - Math.floor((i * width) / n))
    const own = r[i] ?? 0
    const level = count === 0 ? 0 : Math.max(1, Math.round((count / peak) * 8))
    return { text: (level === 0 ? '▁' : (SPARKS[level - 1] as string)).repeat(bar), isRow: own > 0 }
  })
}

/** The model windows Claude Code counts against, as the app copies them; 200K for the rest. */
const MILLION_WINDOW = /opus-4-[78]|opus-5|sonnet-5|fable|mythos/

export function modelWindow(model: string, tokens: number): number {
  const base = /\[1m\]/i.test(model) || MILLION_WINDOW.test(model) ? 1_000_000 : 200_000
  return tokens > base ? Math.max(base, 1_000_000) : base
}

/** A session's context right now, from its transcript's tail: the last main-chain call's input. */
export function liveContext(text: string): { tokens: number; model: string; lastCall: number; entrypoint: string } | undefined {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] as string
    if (!line.includes('"usage"') || !line.includes('"assistant"') || line.includes('"isSidechain":true')) continue
    try {
      const row = JSON.parse(line) as { timestamp?: string; entrypoint?: string; message?: { model?: string; usage?: Record<string, unknown> } }
      const u = row.message?.usage ?? {}
      const num = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0)
      const tokens = num('input_tokens') + num('cache_creation_input_tokens') + num('cache_read_input_tokens')
      if (tokens === 0) continue
      return { tokens, model: row.message?.model ?? '', lastCall: Date.parse(row.timestamp ?? ''), entrypoint: row.entrypoint ?? '' }
    } catch {}
  }
  return undefined
}


/** A line of a card's spend list: a name, its kind, its tokens. */
export type SpendRow = { name: string; kind: string; tokens: number }

/** One transcript's index charges: `kind\0name\0hour` → tokens; a session row is named `sessionRow`. */
type Charges = ReadonlyMap<string, number>

function eachCharge(files: ReadonlyArray<Charges>, since: number, fn: (kind: string, name: string, tokens: number) => void): void {
  for (const charges of files) {
    for (const [key, tokens] of charges) {
      const [kind = '', name = '', hour = '0'] = key.split('\u0000')
      if (Number(hour) * HOUR >= since) fn(kind, name, tokens)
    }
  }
}

/**
 * A Sessions row's card, as the app's SessionPopover: where the session's tokens went in
 * the period – skills, agents, tools, MCP, and the calls outside any skill – most first.
 */
export function sessionSpend(files: ReadonlyArray<Charges>, since: number, limit = 5): { rows: SpendRow[]; total: number } {
  let total = 0
  let inSkills = 0
  const by = new Map<string, SpendRow>()
  eachCharge(files, since, (kind, name, tokens) => {
    if (kind === 'sessions') total += tokens
    if (kind !== 'skills' && kind !== 'agents' && kind !== 'tools' && kind !== 'mcp') return
    if (kind === 'skills') inSkills += tokens
    const key = `${kind}\u0000${name}`
    const row = by.get(key) ?? { name, kind: KIND_LABEL[kind as Kind], tokens: 0 }
    row.tokens += tokens
    by.set(key, row)
  })
  const rows = [...by.values()]
  if (total - inSkills > 0) rows.push({ name: 'No skill', kind: '', tokens: total - inSkills })
  return { rows: rows.filter(r => r.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, limit), total }
}

/** A Tools / MCP / Memory / Hooks / Plugins / Commands row's card: the sessions it was used in, most first. */
export function sourceSessions(sessions: ReadonlyMap<string, ReadonlyArray<Charges>>, kind: Kind, name: string, since: number, limit = 6): SpendRow[] {
  const rows: SpendRow[] = []
  for (const [session, files] of sessions) {
    let tokens = 0
    eachCharge(files, since, (k, n, t) => {
      if (k === kind && n === name) tokens += t
    })
    if (tokens > 0) rows.push({ name: session, kind: 'session', tokens })
  }
  return rows.sort((a, b) => b.tokens - a.tokens).slice(0, limit)
}
