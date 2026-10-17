import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Activity, AgentDef, AgentRun, Context, LiveSession, DropdownKind, Hidden, History, Kind, License, Limit, LimitSample, Period, Skill, TokenHours, Tokens, TrialView, View } from '../types'
import {
  ACTIVATE_URL,
  PAYWALL,
  isActivated,
  isExpired,
  parseExpiry,
  isKeyShaped,
  isPeriodOpen,
  isProOpen,
  activationError,
  needsRecheck,
  newDeviceId,
  sha256Hex,
  type StoredLicense,
} from './license'
import { OWNER_ID, POSTHOG_CAPTURE, captureBody, isOwnerHome, type EventProps } from './analytics'
import { TRIAL_DAYS, buyUrl, countDay, dayNumber, isTrialActive, lockedLine, mergeTrials, parseTrial, trialFile, type TrialState } from './trial'
import { KIND_PLURAL, NOTICE_KINDS, NOTICE_COLOR, outdatedLabel, spikeNotices, tomorrow, visibleNotices, addSamples, allNotices, libraryNotices, limitNotices, modelNotices, sessionNotices, type Notice } from './notify'
import { appendCommand, appendTriggers, commandFile, removeCommand, removeTrigger, renameTrigger, type EditResult } from './edit'
import { BUILTIN_COMMANDS, NEW_CARRY, bareName, classifyTool, invokedName, parseFile, parseFrontmatter, sessionTitle, skillRead, type FileCall, type FileCarry, type FileCharge, type FileIndex, type FileModel } from './parse'
import {
  DAY,
  ALL_KINDS,
  DROPDOWN,
  durationText,
  GREEN,
  KIND_LABEL,
  PERIODS,
  SOURCE_LABEL,
  SORTS,
  addCalls,
  ago,
  sessionSpend,
  sourceSessions,
  ACTIVITY_CAP,
  EMPTY_TOKENS,
  HOUR,
  addHours,
  addTokens,
  contextLevel,
  isIndexHour,
  keepHours,
  tokensSince,
  chargeCall,
  pruneTokens,
  barCells,
  blankRow,
  modelName,
  modelLabel,
  modelsLine,
  liveContext,
  modelWindow,
  chartCounts,
  chartWindow,
  hourItems,
  overlayBars,
  countParts,
  countText,
  countdown,
  parseUsage,
  flatRows,
  limitColor,
  normalizeSort,
  sortRows,
  agentCardLines,
  cardLines,
  clip,
  wrapText,
  rowKey,
  searchRows,
  skillCard,
  sparkline,
  type Row,
  clockTime,
  computeMarks,
  hiddenNames,
  idleToast,
  lastAt,
  layoutRows,
  nextSort,
  periodStart,
  pruneHistory,
} from './stats'

const PANE = 'skillkeeper'
const SITE = 'https://skillkeeper.app'

/** The pinned row's remainder per tab, as the app names it. */
const REMAINDER_TITLE: Record<Kind, string> = {
  skills: 'No-skill tokens',
  agents: 'No-agent tokens',
  tools: 'No-tool tokens',
  mcp: 'No-MCP tokens',
  commands: 'No-command tokens',
  memory: 'No-memory tokens',
  plugins: 'No-plugin tokens',
  sessions: 'Total tokens',
  hooks: 'Total time',
}

/** Keys of the person's Claude Code theme, never raw colors: the panel follows their skin. */
const COLOR = {
  green: GREEN,
  track: 'subtle',
  warn: 'warning',
  error: 'error',
  blue: 'permission',
  hover: 'userMessageBackgroundHover',
  pulse: 'text',
  card: 'userMessageBackground',
  purple: 'merged',
  greenAlt: 'diffAddedWord',
  trackAlt: 'subtle',
  yellow: 'warning',
  count: GREEN,
  selected: 'selectionBg',
  onBadge: 'inverseText',
} as const

const PANE_MAX_ROWS = 40
/** Rows the panel takes when it draws in the chat. */
const INLINE_ROWS = 34
/** Rows kept above and below the pane's view so the engine always has a row to scroll either way. */
const SLACK = 1
const NARROW_COLUMNS = 56
const PAD_X = 2
const PAD_Y = 1
const LIMIT_BAR_WIDTH = 6
/** The limit readout's right part: the 4-cell share, a gap and the 5-cell reset pill. */
const PILL_WIDTH = 10
/** The dropdown menu's width: it wraps by kind past it. */
const MENU_WIDTH = 38
const BACKFILL_DAYS = 30
const BACKFILL_FILES = 400
// One read: under the engine's 4 MiB cap on a process's output.
const READ_CHUNK = 3_500_000

const library = atom({ plugin: 'skillkeeper', key: 'library' } as const, [] as Skill[])
const history = atom({ plugin: 'skillkeeper', key: 'history' } as const, {} as History)
const sessionStart = atom({ plugin: 'skillkeeper', key: 'sessionStart' } as const, 0)
const hidden = atom({ plugin: 'skillkeeper', key: 'hidden' } as const, null as Hidden | null)
const baseline = atom({ plugin: 'skillkeeper', key: 'baseline' } as const, null as string[] | null)
const EMPTY_ACTIVITY: Activity = { agents: {}, tools: {}, mcp: {}, commands: {}, sessions: {}, memory: {}, hooks: {}, plugins: {} }
// As the app: a launch starts on All and 24h; the sort, the dropdown kind and the
// limit window are remembered.
const DEFAULT_VIEW: View = {
  period: 'day',
  sort: 'count',
  collapsed: [],
  source: 'all',
  dropdown: 'agents',
  isMenuOpen: false,
  limit: 'five_hour',
  expanded: [],
  pinnedShowsTotal: true,
}

const activity = atom({ plugin: 'skillkeeper', key: 'activity' } as const, EMPTY_ACTIVITY)
const limits = atom({ plugin: 'skillkeeper', key: 'limits' } as const, [] as Limit[])
const context = atom({ plugin: 'skillkeeper', key: 'context' } as const, null as Context | null)
const view = atom({ plugin: 'skillkeeper', key: 'view' } as const, DEFAULT_VIEW)
const scroll = atom({ plugin: 'skillkeeper', key: 'scroll' } as const, 0)
const favorites = atom({ plugin: 'skillkeeper', key: 'favorites' } as const, [] as string[])
const pulse = atom({ plugin: 'skillkeeper', key: 'pulse' } as const, false)
const screen = atom({ plugin: 'skillkeeper', key: 'screen' } as const, 'list' as 'list' | 'settings' | 'notifications')
const dismissed = atom({ plugin: 'skillkeeper', key: 'dismissed' } as const, [] as string[])
const limitSamples = atom({ plugin: 'skillkeeper', key: 'limitSamples' } as const, [] as LimitSample[])
const licenseNote = atom({ plugin: 'skillkeeper', key: 'licenseNote' } as const, '')
const folders = atom({ plugin: 'skillkeeper', key: 'folders' } as const, [] as string[])
const live = atom({ plugin: 'skillkeeper', key: 'live' } as const, [] as LiveSession[])
const agentModelsAtom = atom({ plugin: 'skillkeeper', key: 'agentModels' } as const, {} as Record<string, Record<string, number>>)
const agentLast = atom({ plugin: 'skillkeeper', key: 'agentLast' } as const, {} as Record<string, string>)
const sessionLast = atom({ plugin: 'skillkeeper', key: 'sessionLast' } as const, {} as Record<string, string>)
const agentSkillsAtom = atom({ plugin: 'skillkeeper', key: 'agentSkills' } as const, {} as Record<string, Record<string, number>>)
const agentDefs = atom({ plugin: 'skillkeeper', key: 'agentDefs' } as const, [] as AgentDef[])
const indexing = atom({ plugin: 'skillkeeper', key: 'indexing' } as const, { done: 0, total: 0, at: 0 })
const card = atom({ plugin: 'skillkeeper', key: 'card' } as const, null as string | null)
const selected = atom({ plugin: 'skillkeeper', key: 'selected' } as const, null as string | null)
const search = atom({ plugin: 'skillkeeper', key: 'search' } as const, { isOpen: false, query: '' })
const onStart = atom({ plugin: 'skillkeeper', key: 'onStart' } as const, [] as string[])
const paused = atom({ plugin: 'skillkeeper', key: 'paused' } as const, [] as string[])
const agentRunsAtom = atom({ plugin: 'skillkeeper', key: 'agentRuns' } as const, {} as Record<string, AgentRun>)
const noticesOff = atom({ plugin: 'skillkeeper', key: 'noticesOff' } as const, [] as string[])
const renaming = atom({ plugin: 'skillkeeper', key: 'renaming' } as const, null as string | null)
const review = atom({ plugin: 'skillkeeper', key: 'review' } as const, 'closed' as 'closed' | 'ask' | 'thanks' | 'wrong')
const muted = atom({ plugin: 'skillkeeper', key: 'muted' } as const, {} as Record<string, number>)
const agentRunTokens = atom({ plugin: 'skillkeeper', key: 'agentRunTokens' } as const, {} as Record<string, Array<{ tokens: number; started: number; ended: number }>>)
const tokens = atom({ plugin: 'skillkeeper', key: 'tokens' } as const, EMPTY_TOKENS as Tokens)
const totalTokens = atom({ plugin: 'skillkeeper', key: 'totalTokens' } as const, {} as TokenHours)
const scannedAt = atom({ plugin: 'skillkeeper', key: 'scannedAt' } as const, 0)
const license = atom({ plugin: 'skillkeeper', key: 'license' } as const, {
  isPro: false,
  checkedAt: null,
} as License)
const trial = atom({ plugin: 'skillkeeper', key: 'trial' } as const, { isLoaded: false, isActive: true, days: 0 } as TrialView)

type Engine = EngineInterface

async function home($: Engine): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
}

async function readSkill($: Engine, dir: string, folder: string, router?: string): Promise<Skill | undefined> {
  const path = `${dir}/SKILL.md`
  const text = await $.fs.read(path).catch(() => undefined)
  if (typeof text !== 'string') return undefined
  const fm = parseFrontmatter(text)
  return {
    name: fm.name?.trim() || folder,
    folder,
    ...(router ? { router } : {}),
    description: fm.description ?? '',
    whenToUse: fm.when_to_use ?? '',
    path,
    ...(fm['disable-model-invocation']?.trim() === 'true' ? { isUserOnly: true } : {}),
  }
}

/** How far the list may scroll, from the last drawing: rows past the window. */
let scrollMax = 0
/** The last drawing's rows by key, and how many fit: what the arrow keys walk. */
let drawnKeys: string[] = []
let drawnRoom = 1
/** Rows that open a card: skills, by key. */
let cardKeys = new Set<string>()
/** Each session's transcripts' charges, main and subagents, from the last index: what a Sessions or source card sums. */
let sessionFiles = new Map<string, Array<ReadonlyMap<string, number>>>()
/** A source row with a card of its own, as the app's SourcePopover and SessionPopover. */
const SOURCE_CARDS: ReadonlySet<Kind> = new Set<Kind>(['sessions', 'tools', 'mcp', 'memory', 'hooks', 'plugins', 'commands'])

/** Usage counts on (the `usageAnalytics` option); the session's surface, for every event. */
let analyticsOn = true
let surfaceName = 'terminal'

/**
 * Sends one event, as the app's `Analytics.capture`; `ui` presses go as
 * `ui_action` with `element`, as its `Analytics.ui`. Never awaited by a press,
 * never a skill's name.
 */
async function track($: Engine, event: string, props: EventProps = {}, ui = true): Promise<void> {
  if (!analyticsOn || isHeadless) return
  try {
    let distinctId = (await $.store.get('analyticsId')) as string | undefined
    if (!distinctId) {
      distinctId = `cc-${crypto.randomUUID()}`
      await $.store.set('analyticsId', distinctId)
    }
    const body = captureBody(ui ? 'ui_action' : event, ui ? { ...props, element: event } : props, {
      distinctId,
      isOwner: isOwnerHome(await home($)),
      version,
      surface: surfaceName,
      at: await $.clock.now(),
    })
    await $.http.fetch('https://us.i.posthog.com/i/v0/e/', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  } catch {}
}

/**
 * One write to a skill's own description, as the app's SkillFileEditor: gated by the license
 * after the trial, then the library read again. `action` is the app's label for `skill_edited`.
 */
async function editSkill($: Engine, path: string, action: string, edit: (file: string) => EditResult): Promise<boolean> {
  if (!(await isUnlocked($))) {
    void track($, 'paid_action_blocked', { action, app: 'claude_code' }, false)
    $.ui.toast('skillkeeper · editing a skill needs a license')
    return false
  }
  const file = await $.fs.read(path).catch(() => undefined)
  if (typeof file !== 'string') {
    $.ui.toast("skillkeeper · can't read this skill's file")
    return false
  }
  const result = edit(file)
  if ('error' in result) {
    if (result.error !== 'nothing') $.ui.toast('skillkeeper · no description: line in this skill to edit')
    else if (action === 'append_trigger' || action === 'append_command') $.ui.toast('skillkeeper · already there')
    return false
  }
  if (!(await $.fs.write(path, result.text).then(() => true, () => false))) {
    $.ui.toast("skillkeeper · can't write this skill's file")
    return false
  }
  // The app's event for a written skill: the feature only, never the skill or its text.
  void track($, 'skill_edited', { action, app: 'claude_code' }, false)
  await rescan($, settingsCwd)
  return true
}

async function addTrigger($: Engine, path: string, phrases: string): Promise<void> {
  if (phrases.trim() === '') return
  await editSkill($, path, 'append_trigger', file => appendTriggers(file, phrases))
}

/** An added command also gets its command file, as the app registers it: never over one that exists. */
async function addCommand($: Engine, path: string, skill: string, command: string): Promise<void> {
  if (command.trim() === '') return
  if (!(await editSkill($, path, 'append_command', file => appendCommand(file, command)))) return
  const made = commandFile(command, skill)
  if (!made) return
  const target = `${await home($)}/.claude/commands/${made.name}.md`
  if (typeof (await $.fs.read(target).catch(() => undefined)) !== 'string') await $.fs.write(target, made.text).catch(() => undefined)
}

/** Opens or closes a row's card; the row stays selected only while its card is open. */
async function toggleCard($: Engine, key: string): Promise<void> {
  const open = await read($, card)
  if (open !== key) {
    // The app's event for each card it opens: the feature only, never the row's name.
    const source = key.slice(0, key.indexOf(':'))
    if (source === 'agents') void track($, 'agent_row_open')
    else if (source === 'sessions') void track($, 'session_popover_open', { waiting: false, has_context: (await read($, live)).some(l => `sessions:${l.title}` === key) })
    else if (SOURCE_CARDS.has(source as Kind)) void track($, 'source_popover_open', { source })
    else void track($, 'skill_action', { action: 'open_skill', app: 'claude_code' }, false)
  }
  await update($, card, () => (open === key ? null : key))
  await update($, selected, () => (open === key ? null : key))
}

async function toggleFavorite($: Engine, name: string): Promise<void> {
  // The app's free action: favorite / unfavorite, `_agent` for an agent; the feature only.
  const isAgent = name.startsWith('agent:')
  const wasOn = (await read($, favorites)).includes(name)
  void track($, 'skill_action', { action: `${wasOn ? 'unfavorite' : 'favorite'}${isAgent ? '_agent' : ''}`, app: 'claude_code' }, false)
  await update($, favorites, list => (list.includes(name) ? list.filter(n => n !== name) : [...list, name]))
  await $.store.set('favorites', await read($, favorites))
}

/** What the app copies for a skill: `/name`, or `/router subskill` for a subskill. */
function invocation(skill: Skill): string {
  return skill.router ? `/${skill.router} ${skill.name}` : `/${skill.name}`
}

/** Opens a file in its app: `open` on the Mac, `xdg-open` elsewhere. */
async function openFile($: Engine, path: string): Promise<void> {
  const mac = await $.process.run(['open', path]).catch(() => undefined)
  if (mac?.exitCode === 0) return
  const other = await $.process.run(['xdg-open', path]).catch(() => undefined)
  if (other?.exitCode !== 0) $.ui.toast('skillkeeper · could not open the file')
}

async function setSearch($: Engine, next: { isOpen: boolean; query: string }): Promise<void> {
  const wasOpen = (await read($, search)).isOpen
  if (next.isOpen && !wasOpen) void track($, 'search_reveal')
  await update($, search, () => next)
  await update($, scroll, () => 0)
  // The field takes the keys once it is drawn, as the app's search row takes focus.
  if (next.isOpen && !wasOpen) $.clock.after(80, () => void $.ui.focus({ requestId: PANE, key: 'search' }).catch(() => undefined))
}

const isSkipped = (name: string) => name.startsWith('.') || name.startsWith('_')

/** Folders the person added in /config, as the app's + Add folder. */
let extraFolders: string[] = []

async function scanLibrary($: Engine, cwd: string): Promise<Skill[]> {
  const homeDir = await home($)
  const added = await read($, folders)
  const extra = [...extraFolders, ...added].map(f => (f.startsWith('~/') ? `${homeDir}${f.slice(1)}` : f))
  const roots = [...new Set([`${homeDir}/.claude/skills`, `${cwd}/.claude/skills`, ...extra])]
  const out: Skill[] = []
  const names = new Set<string>()

  for (const root of roots) {
    const entries = await $.fs.list(root).catch(() => [])
    for (const entry of entries) {
      if (isSkipped(entry.name) || entry.kind === 'file') continue
      const dir = `${root}/${entry.name}`
      const skill = await readSkill($, dir, entry.name)
      if (!skill || names.has(skill.name)) continue
      names.add(skill.name)
      out.push(skill)

      const subs = await $.fs.list(`${dir}/subskills`).catch(() => [])
      for (const sub of subs) {
        if (isSkipped(sub.name) || sub.kind === 'file') continue
        const child = await readSkill($, `${dir}/subskills/${sub.name}`, sub.name, skill.name)
        if (child) out.push(child)
      }
    }
  }
  return out
}

/** Agent definitions, as the app lists them: ~/.claude/agents and the project's .claude/agents. */
async function scanAgents($: Engine, cwd: string): Promise<AgentDef[]> {
  const out: AgentDef[] = []
  for (const dir of [...new Set([`${await home($)}/.claude/agents`, `${cwd}/.claude/agents`])]) {
    for (const entry of await $.fs.list(dir).catch(() => [])) {
      if (!entry.name.endsWith('.md') || isSkipped(entry.name)) continue
      const path = `${dir}/${entry.name}`
      const text = await $.fs.read(path).catch(() => undefined)
      if (typeof text !== 'string') continue
      const fm = parseFrontmatter(text)
      const skillsLine = /^skills:\s*(.*)$/m.exec(text.split(/\n---/)[0] ?? '')?.[1] ?? ''
      const listed = [...(text.split(/\n---/)[0] ?? '').matchAll(/^\s+-\s+(\S+)\s*$/gm)].map(m => m[1] as string)
      const inline = skillsLine.replace(/[[\]]/g, '').split(',').map(x => x.trim()).filter(Boolean)
      const name = fm.name?.trim() || entry.name.slice(0, -3)
      if (out.some(a => a.name === name)) continue
      const model = /^model:\s*(\S+)/m.exec(text)?.[1]
      out.push({ name, description: fm.description ?? '', path, skills: inline.length > 0 ? inline : listed, ...(model ? { model } : {}) })
    }
  }
  return out
}

async function rescan($: Engine, cwd: string): Promise<void> {
  const skills = await scanLibrary($, cwd)
  await update($, library, () => skills)
  const agents = await scanAgents($, cwd)
  await update($, agentDefs, () => agents)
  const at = await $.clock.now()
  await update($, scannedAt, () => at)

  const first = await read($, baseline)
  if (first === null) {
    const stored = (await $.store.get('baseline')) as string[] | undefined
    const names = stored ?? skills.map(s => s.name)
    if (!stored) await $.store.set('baseline', names)
    await update($, baseline, () => names)
  }
  await update($, onStart, () => [])
  const loaded = await scanOnStart($)
  await update($, onStart, () => loaded)
  const off = await scanPaused($)
  await update($, paused, () => off)
  await refreshHidden($)
}

/** Skills paused in Claude Code's settings: `skillOverrides[name] === "off"`, as the app's SkillOverridesEditor reads them. */
async function scanPaused($: Engine): Promise<string[]> {
  const settings = (await $.settings.read().catch(() => ({}))) as { skillOverrides?: unknown }
  const overrides = settings.skillOverrides
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return []
  return Object.entries(overrides as Record<string, unknown>).filter(([, state]) => state === 'off').map(([name]) => name)
}

/**
 * Skills a SessionStart hook loads, as the app finds them: a hook command that is
 * an interpreter and one absolute script, whose text names `skills/<name>/SKILL.md`.
 */
async function scanOnStart($: Engine): Promise<string[]> {
  const settings = (await $.settings.read().catch(() => ({}))) as { hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: unknown }> }> } }
  const names = new Set<string>()
  for (const group of settings.hooks?.SessionStart ?? []) {
    for (const hook of group.hooks ?? []) {
      const match = typeof hook.command === 'string' ? /^\S+\s+(\/\S+\.(?:sh|js|py))$/.exec(hook.command.trim()) : null
      if (!match) continue
      const script = await $.fs.read(match[1] as string).catch(() => undefined)
      if (typeof script !== 'string') continue
      for (const hit of script.matchAll(/skills\/([^/\s"']+)\/SKILL\.md/g)) names.add(hit[1] as string)
    }
  }
  return [...names]
}

/** `totalSkills − includedSkills` from the context breakdown, with the names left out; and the rate limits. */
async function refreshHidden($: Engine): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  if (usage) {
    // `claude -p /usage` is the fresher source, as the app reads it: the session's own
    // figures stand in only once the last poll is 10 minutes old.
    if ((await $.clock.now()) - lastPolled > 10 * 60_000) {
      await update($, limits, () => usage.rateLimits.map(l => ({ ...l })))
      await recordSamples($)
    }
    const { tokens, window, percent } = usage.context
    await update($, context, () => ({ window, ...(tokens !== undefined ? { tokens } : {}), ...(percent !== undefined ? { percent } : {}) }))
  }
  const skills = usage?.context.breakdown?.skills
  if (!skills) return
  const names =
    skills.totalSkills > skills.includedSkills
      ? hiddenNames(await read($, library), skills.skillFrontmatter.map(s => s.name))
      : []
  await update($, hidden, () => ({ total: skills.totalSkills, included: skills.includedSkills, names }))
}

/** A reading of the current limits for the forecast (`notify.ts`). */
async function recordSamples($: Engine): Promise<void> {
  const now = await $.clock.now()
  const current = await read($, limits)
  await update($, limitSamples, cur => addSamples(cur, current, now))
}

/** Notices already counted as shown this load, so each occurrence counts once. */
const shownNotices = new Set<string>()
/** Compact bands already counted, the same way. */
const shownBands = new Set<string>()

/** Every notification now: this session's compact, limit forecasts, skill and model problems. */
async function currentNotices($: Engine): Promise<Notice[]> {
  const all = allNotices(
    [
      sessionNotices(await read($, context)),
      limitNotices(await read($, limitSamples), await $.clock.now()),
      libraryNotices(await read($, library)),
      modelNotices(await read($, agentModelsAtom)),
      spikeNotices(await read($, agentRunTokens), await $.clock.now()),
    ],
    await read($, dismissed),
  )
  const list = visibleNotices(all, await read($, noticesOff), await read($, muted), await $.clock.now())
  // Each new occurrence once, as the app's `notification_shown`: kind and group only.
  for (const n of list) {
    if (shownNotices.has(n.id)) continue
    shownNotices.add(n.id)
    void track($, 'notification_shown', { kind: n.kind, group: n.group }, false)
  }
  return list
}

/** The app's feedback survey in PostHog: its id and its questions'. */
const SURVEY = { id: '01a0ccb2-a6c2-0000-aa04-558ddcee71c4', rating: '177eaf97-e3ca-4d99-bfe3-1fb3dae15df0', improve: '4e130685-2a26-4678-96b7-bc560ddb21d7' }

/** A thumb, and what's wrong after a thumbs down: the app's `survey sent`, same survey, same questions. */
async function sendReview($: Engine, useful: boolean, improve = ''): Promise<void> {
  const props: EventProps = { $survey_id: SURVEY.id, usage_source: (await read($, view)).source }
  props[`$survey_response_${SURVEY.rating}`] = useful ? 'Useful' : 'Not useful'
  props.$survey_response = useful ? 'Useful' : 'Not useful'
  if (improve.trim() !== '') {
    props[`$survey_response_${SURVEY.improve}`] = improve.trim()
    props.$survey_response_1 = improve.trim()
  }
  void track($, 'survey sent', props, false)
  await update($, review, () => 'thanks' as const)
}

/** Settings' checkbox and the card's "Stop showing …": a kind on or off, kept across sessions. */
async function turnNotices($: Engine, kind: string, enabled: boolean): Promise<void> {
  void track($, enabled ? 'notification_kind_on' : 'notification_kind_off', { kind })
  await update($, noticesOff, cur => (enabled ? cur.filter(k => k !== kind) : [...new Set([...cur, kind])]))
  await $.store.set('noticesOff', await read($, noticesOff))
}

/** "Mute until tomorrow": that agent's records until the start of tomorrow. */
async function muteNotice($: Engine, n: Notice): Promise<void> {
  if (n.muteKey === undefined) return
  void track($, 'notification_action', { kind: n.kind, action: 'mute_today', via: 'card' })
  const until = tomorrow(await $.clock.now())
  await update($, muted, cur => ({ ...cur, [n.muteKey as string]: until }))
  await $.store.set('muted', await read($, muted))
}

/** "Show agent": the Agents tab with that agent's card open. */
async function showAgent($: Engine, name: string): Promise<void> {
  void track($, 'notification_action', { kind: 'agentSpike', action: 'show_agent', via: 'card' })
  await changeView($, cur => ({ ...cur, source: 'agents', dropdown: 'agents', isMenuOpen: false }))
  await update($, screen, () => 'list' as const)
  await update($, card, () => `agents:${name}`)
  await update($, selected, () => `agents:${name}`)
}

/** Runs /compact in this very session – the mod lives in it, so no clipboard and no switching. */
async function compactNow($: Engine, via: 'card' | 'band'): Promise<void> {
  void track($, 'notification_action', { kind: 'compact', action: 'compact', via })
  await $.command.run({ command: 'compact' }).catch(() => $.ui.toast('skillkeeper · type /compact – it could not run from here'))
}

/** Each loop's last `Skill` call, as the app's `lastRouterSkill`: the main loop under ''. */
const lastSkill = new Map<string, string>()

async function recordCall($: Engine, name: string): Promise<void> {
  const now = await $.clock.now()
  const before = await read($, history)
  const previous = lastAt(before, name)
  const next = addCalls(before, [{ name, at: now }], now)
  await update($, history, () => next)
  await $.store.set('history', next)

  const isKnownIdle =
    (await $.store.get('backfilled')) === true && ((await read($, baseline)) ?? []).includes(name)
  const toast = idleToast(name, previous, now, isKnownIdle)
  if (toast) $.ui.toast(toast)
}

let builtins: ReadonlySet<string> = BUILTIN_COMMANDS

/** Everything the store keeps, into the session's state: at start, and again after a /clear. */
async function load($: Engine): Promise<void> {
  const now = await $.clock.now()
  const stored = (await $.store.get('history')) as History | undefined
  await update($, history, () => pruneHistory(stored ?? {}, now))
  const storedActivity = (await $.store.get('activity')) as Partial<Activity> | undefined
  const loaded: Activity = { ...EMPTY_ACTIVITY, ...storedActivity }
  for (const kind of DROPDOWN) loaded[kind] = pruneHistory(loaded[kind], now, ACTIVITY_CAP)
  await update($, activity, () => loaded)
  const storedTokens = (await $.store.get('tokens')) as Partial<Tokens> | undefined
  await update($, tokens, () => pruneTokens({ ...EMPTY_TOKENS, ...storedTokens }, now))
  const storedTotals = (await $.store.get('totalTokens')) as TokenHours | undefined
  await update($, totalTokens, () => addHours(storedTotals ?? {}, [], now))
  const storedModels = (await $.store.get('agentModels')) as Record<string, Record<string, number>> | undefined
  if (storedModels) await update($, agentModelsAtom, () => storedModels)
  const storedLast = (await $.store.get('agentLast')) as Record<string, string> | undefined
  if (storedLast) await update($, agentLast, () => storedLast)
  const storedRunTokens = (await $.store.get('agentRunTokens')) as Record<string, Array<{ tokens: number; started: number; ended: number }>> | undefined
  if (storedRunTokens) await update($, agentRunTokens, () => storedRunTokens)
  const storedOff = (await $.store.get('noticesOff')) as string[] | undefined
  if (storedOff) await update($, noticesOff, () => storedOff)
  const storedMuted = (await $.store.get('muted')) as Record<string, number> | undefined
  if (storedMuted) await update($, muted, () => storedMuted)
  const storedRuns = (await $.store.get('agentRuns')) as Record<string, AgentRun> | undefined
  if (storedRuns) await update($, agentRunsAtom, () => storedRuns)
  const storedSessionLast = (await $.store.get('sessionLast')) as Record<string, string> | undefined
  if (storedSessionLast) await update($, sessionLast, () => storedSessionLast)
  const storedAgentSkills = (await $.store.get('agentSkills')) as Record<string, Record<string, number>> | undefined
  if (storedAgentSkills) await update($, agentSkillsAtom, () => storedAgentSkills)
  const storedFolders = (await $.store.get('folders')) as string[] | undefined
  if (storedFolders) await update($, folders, () => storedFolders)
  const manifest = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => undefined)
  try {
    version = (JSON.parse(typeof manifest === 'string' ? manifest : '{}') as { version?: string }).version ?? ''
  } catch {}
  await update($, favorites, () => [])
  const storedFavorites = (await $.store.get('favorites')) as string[] | undefined
  if (storedFavorites) await update($, favorites, () => storedFavorites)
  const storedView = (await $.store.get('view')) as Partial<View> | undefined
  if (storedView) {
    // Session gave way to 5h, as the app's periods.
    await update($, view, () => ({
      ...DEFAULT_VIEW,
      ...storedView,
      period: DEFAULT_VIEW.period,
      limit: DEFAULT_VIEW.limit,
      source: DEFAULT_VIEW.source,
      sort: normalizeSort(String(storedView.sort)),
      isMenuOpen: false,
      expanded: [],
    }))
  }
  const commands = await $.command.list().catch(() => [])
  builtins = new Set([...BUILTIN_COMMANDS, ...commands.filter(c => c.source === 'builtin').map(c => `/${c.name}`)])
}

/** What the turn ran, for charging its tokens when it completes. */
let turn: { skills: string[]; command?: string; tools: Array<{ kind: Kind; name: string }> } = { skills: [], tools: [] }

/** A call of an agent, tool, MCP server or command: counted, never toasted. */
async function recordActivity($: Engine, kind: DropdownKind, name: string): Promise<void> {
  const now = await $.clock.now()
  const next = { ...(await read($, activity)) }
  next[kind] = addCalls(next[kind], [{ name, at: now }], now, ACTIVITY_CAP)
  await update($, activity, () => next)
  await $.store.set('activity', next)
}

/**
 * Keeps the stored calls outside [since, before) and takes that window from
 * the transcripts: they hold every call made there, live ones included.
 */
function mergeWindow(stored: History, found: readonly { name: string; at: number }[], since: number, before: number, now: number, cap?: number): History {
  const kept: History = {}
  for (const [name, list] of Object.entries(stored)) {
    const outside = list.filter(at => at < since || at >= before)
    if (outside.length > 0) kept[name] = outside
  }
  return addCalls(kept, found, now, cap)
}

/**
 * A transcript's whole lines from byte `offset`, at most one chunk, and the
 * byte where they end. A line longer than a chunk is stepped over: a tool
 * result that size holds nothing the index reads.
 */
async function readLines($: Engine, path: string, offset: number, size: number): Promise<{ text: string; next: number } | undefined> {
  const length = Math.min(READ_CHUNK, size - offset)
  if (length <= 0) return { text: '', next: offset }
  const run = (script: string) =>
    $.process.run(['sh', '-c', script, 'sh', String(offset + 1), path, String(length)], { timeoutMs: 20_000 }).catch(() => undefined)
  const chunk = await run('tail -c +"$1" "$2" | head -c "$3"')
  if (!chunk || chunk.exitCode !== 0) return undefined
  const cut = chunk.stdout.lastIndexOf('\n')
  if (cut >= 0) {
    const text = chunk.stdout.slice(0, cut + 1)
    return { text, next: offset + new TextEncoder().encode(text).length }
  }
  // The file's last line, still being written: wait for the rest.
  if (offset + length >= size) return { text: '', next: offset }
  const line = await run('tail -c +"$1" "$2" | head -n 1 | wc -c')
  const bytes = Number(line?.stdout.trim())
  return line && line.exitCode === 0 && bytes > 0 ? { text: '', next: offset + bytes } : undefined
}

/**
 * What one transcript has given so far, kept for the session so each index
 * reads only what was written since, as the app's scanner keeps its offsets.
 * Tokens are summed per row and hour; calls keep their times.
 */
type FileSoFar = {
  size: number
  offset: number
  carry: FileCarry
  title?: string
  calls: FileCall[]
  charges: Map<string, number>
  totals: Map<number, number>
  /** `agent|model|effort` → tokens. */
  models: Map<string, number>
  /** `agent|model|effort` → its latest call. */
  modelsAt: Map<string, number>
  /** `agent|skill` → tokens. */
  agentSkills: Map<string, number>
}
const SESSION_ROW = '\u0000session'
/** Raised whenever what a transcript gives changes: a kept index from before is read again. */
const INDEX_VERSION = 3
const soFar = new Map<string, FileSoFar>()

const emptySoFar = (): FileSoFar => ({ size: 0, offset: 0, carry: NEW_CARRY, calls: [], charges: new Map(), totals: new Map(), models: new Map(), modelsAt: new Map(), agentSkills: new Map() })

/** Where a transcript's index is kept between sessions: one small file each, as the app's scan cache. */
async function indexPath($: Engine, path: string): Promise<string> {
  const root = `${await home($)}/.claude/projects/`
  const name = (path.startsWith(root) ? path.slice(root.length) : path).replace(/[\\/:]/g, '__')
  return `${await home($)}/.claude/plugins/data/skillkeeper-skillkeeper/index/${name}.json`
}

async function loadSoFar($: Engine, path: string): Promise<FileSoFar | undefined> {
  const text = await $.fs.read(await indexPath($, path)).catch(() => undefined)
  if (typeof text !== 'string') return undefined
  try {
    const d = JSON.parse(text) as {
      v: number
      size: number
      offset: number
      carry: FileCarry & { lastRouterLine: number | null }
      title?: string
      calls: Array<[FileCall['kind'], string, number]>
      charges: Array<[string, number]>
      totals: Array<[number, number]>
      models: Array<[string, number]>
      modelsAt: Array<[string, number]>
      agentSkills: Array<[string, number]>
    }
    if (d.v !== INDEX_VERSION) return undefined
    return {
      size: d.size,
      offset: d.offset,
      carry: { ...d.carry, lastRouterLine: d.carry.lastRouterLine ?? -Infinity },
      ...(d.title !== undefined ? { title: d.title } : {}),
      calls: d.calls.map(([kind, name, at]) => ({ kind, name, at })),
      charges: new Map(d.charges),
      totals: new Map(d.totals),
      models: new Map(d.models),
      modelsAt: new Map(d.modelsAt),
      agentSkills: new Map(d.agentSkills),
    }
  } catch {
    return undefined
  }
}

async function saveSoFar($: Engine, path: string, file: FileSoFar, since: number): Promise<void> {
  const text = JSON.stringify({
    v: INDEX_VERSION,
    size: file.size,
    offset: file.offset,
    carry: file.carry,
    title: file.title,
    calls: file.calls.filter(c => c.at >= since).map(c => [c.kind, c.name, c.at]),
    charges: [...file.charges],
    totals: [...file.totals],
    models: [...file.models],
    modelsAt: [...file.modelsAt],
    agentSkills: [...file.agentSkills],
  })
  // Over the engine's 4 MiB a write rejects: that file is read again next session.
  await $.fs.write(await indexPath($, path), text).catch(() => undefined)
}

async function readSoFar($: Engine, path: string, size: number, ctx: Omit<Parameters<typeof parseFile>[1], 'session'>): Promise<FileSoFar> {
  let file = soFar.get(path) ?? (await loadSoFar($, path))
  if (!file || size < file.size) file = emptySoFar()
  const before = file.offset
  while (file.offset < size) {
    const got = await readLines($, path, file.offset, size)
    if (!got || got.next <= file.offset) break
    if (got.text) {
      file.title = sessionTitle(got.text) ?? file.title
      const found: FileIndex & { carry: FileCarry } = parseFile(got.text, { ...ctx, session: SESSION_ROW }, file.carry)
      file.carry = found.carry
      file.calls.push(...found.calls)
      for (const c of found.charges) {
        const key = `${c.kind}\u0000${c.name}\u0000${Math.floor(c.at / HOUR)}`
        file.charges.set(key, (file.charges.get(key) ?? 0) + c.tokens)
      }
      for (const t of found.totals) {
        const hour = Math.floor(t.at / HOUR)
        file.totals.set(hour, (file.totals.get(hour) ?? 0) + t.tokens)
      }
      for (const m of found.models) {
        const key = `${m.agent ?? ''}|${m.model}|${m.effort}`
        file.models.set(key, (file.models.get(key) ?? 0) + m.tokens)
        file.modelsAt.set(key, Math.max(file.modelsAt.get(key) ?? 0, m.at))
      }
      for (const r of found.agentSkills) {
        const key = `${r.agent}|${r.skill}`
        file.agentSkills.set(key, (file.agentSkills.get(key) ?? 0) + r.tokens)
      }
    }
    file.offset = got.next
  }
  file.size = size
  soFar.set(path, file)
  if (file.offset !== before) await saveSoFar($, path, file, ctx.since)
  return file
}

let isIndexing = false
let isLiveScanning = false

/**
 * The live sessions, as the app's context block finds them: transcripts written in the
 * last hour (a warm cache), each read from its tail for the last main-chain call.
 */
async function scanLive($: Engine): Promise<void> {
  if (isLiveScanning) return
  isLiveScanning = true
  try {
    const root = `${await home($)}/.claude/projects`
    const now = await $.clock.now()
    const found: LiveSession[] = []
    for (const project of await $.fs.list(root).catch(() => [])) {
      if (project.kind !== 'dir') continue
      for (const file of await $.fs.list(`${root}/${project.name}`).catch(() => [])) {
        if (file.kind !== 'file' || !file.name.endsWith('.jsonl') || now - file.mtimeMs > HOUR) continue
        const path = `${root}/${project.name}/${file.name}`
        const tail = file.size <= 400_000 ? await $.fs.read(path).catch(() => undefined) : (await $.process.run(['tail', '-c', '400000', path]).catch(() => undefined))?.stdout
        if (typeof tail !== 'string') continue
        const ctx = liveContext(tail)
        if (!ctx || !Number.isFinite(ctx.lastCall) || now - ctx.lastCall > HOUR) continue
        const id = file.name.slice(0, -'.jsonl'.length)
        found.push({
          id,
          title: sessionTitle(tail) ?? `Session ${id.slice(0, 8)}`,
          tokens: ctx.tokens,
          window: modelWindow(ctx.model, ctx.tokens),
          lastCall: ctx.lastCall,
          entrypoint: ctx.entrypoint,
        })
      }
    }
    found.sort((a, b) => b.tokens - a.tokens)
    await update($, live, () => found)
  } finally {
    isLiveScanning = false
  }
}

/**
 * Opens a session where it runs, as the app does: an editor session through its
 * extension's link (`<scheme>://anthropic.claude-code/open?session=<id>`), the scheme the
 * running editor's own. A terminal session has no such link.
 */
async function openSession($: Engine, session: LiveSession, via = 'live'): Promise<void> {
  if (session.entrypoint && session.entrypoint !== 'claude-vscode') {
    void track($, 'session_open', { route: 'none', host: 'terminal', via })
    $.ui.toast('skillkeeper · a terminal session can\'t be opened from here')
    return
  }
  const ps = await $.process.run(['ps', '-axww', '-o', 'args=']).catch(() => undefined)
  const hosts = (ps?.stdout ?? '').split('\n').filter(l => l.includes('anthropic.claude-code') && l.includes('/native-binary/claude'))
  const host = hosts.find(l => l.includes(session.id)) ?? hosts[0] ?? ''
  const folder = /\/\.(antigravity-ide|vscode|cursor|antigravity|windsurf)\/extensions\//.exec(host)?.[1]
  if (!folder) {
    void track($, 'session_open', { route: 'failed', host: 'editor', via })
    $.ui.toast('skillkeeper · no editor found for this session')
    return
  }
  const run = await $.process.run(['open', `${folder}://anthropic.claude-code/open?session=${session.id}`]).catch(() => undefined)
  // After the attempt, as the app: a goal counts chats that opened.
  void track($, 'session_open', { route: run?.exitCode === 0 ? 'editor' : 'failed', host: 'editor', via })
}
let lastPaneDrawn = 0
/** Set on open: the first drawing after it scrolls past the top slack row. */
let needsTop = false
let isPolling = false
/** A headless session: no polls, no index, no timers. */
let isHeadless = false
let lastPolled = 0

/**
 * The limits as `claude -p /usage` reports them, as the app polls them while its panel
 * is open: the session's own figures age until its next model call.
 */
async function pollUsage($: Engine): Promise<void> {
  if (isPolling || isHeadless) return
  isPolling = true
  try {
    // As the app runs it: no session file, and no settings – so the child loads no
    // plugins, this mod included, and cannot start a poll of its own.
    const run = await $.process.run(['claude', '-p', '/usage', '--no-session-persistence', '--setting-sources', ''], { timeoutMs: 30_000 }).catch(() => undefined)
    if (!run || run.exitCode !== 0) return
    const found = parseUsage(run.stdout, await $.clock.now())
    if (found.length === 0) return
    lastPolled = await $.clock.now()
    await update($, limits, cur => {
      const out = [...cur]
      for (const f of found) {
        const at = out.findIndex(l => l.kind === f.kind)
        const resetsAt = f.resetsAt ?? (at >= 0 ? out[at]?.resetsAt : undefined)
        const next = { kind: f.kind, percentUsed: f.percentUsed, ...(resetsAt ? { resetsAt } : {}) }
        if (at >= 0) out[at] = next
        else out.push(next)
      }
      return out
    })
    await recordSamples($)
  } finally {
    isPolling = false
  }
}

/**
 * The history index, as the app's scanner builds it: the last 30 days of transcripts
 * and their subagents', read once for every tab. Run at start, on ↻ and when the pane
 * opens on an index older than 10 minutes; what it reads replaces that window, what
 * was counted live since it began stays.
 */
async function indexHistory($: Engine): Promise<void> {
  if (isIndexing || isHeadless) return
  isIndexing = true
  try {
    const root = `${await home($)}/.claude/projects`
    const started = await $.clock.now()
    const since = started - BACKFILL_DAYS * DAY
    const skills = await read($, library)
    const routers = new Set(skills.filter(s => s.router).map(s => s.router as string))

    const files: Array<{ path: string; size: number; mtimeMs: number }> = []
    for (const project of await $.fs.list(root).catch(() => [])) {
      if (project.kind !== 'dir') continue
      for (const file of await $.fs.list(`${root}/${project.name}`).catch(() => [])) {
        if (file.kind === 'file' && file.name.endsWith('.jsonl') && file.mtimeMs >= since) {
          files.push({ path: `${root}/${project.name}/${file.name}`, size: file.size, mtimeMs: file.mtimeMs })
        }
      }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const chosen = files.slice(0, BACKFILL_FILES)
    await update($, indexing, cur => ({ ...cur, done: 0, total: chosen.length }))

    const calls: FileCall[] = []
    const charges: FileCharge[] = []
    const totals: Array<{ at: number; tokens: number }> = []
    const models: FileModel[] = []
    // Each session's own latest model: its main thread's calls, not its subagents'.
    const sessionLatest: Record<string, { key: string; at: number }> = {}
    const bySession = new Map<string, Array<ReadonlyMap<string, number>>>()
    const runs: Record<string, AgentRun & { path?: string }> = {}
    const runTokens: Record<string, Array<{ tokens: number; started: number; ended: number }>> = {}
    const agentRuns: Array<{ agent: string; skill: string; tokens: number }> = []
    const take = (file: FileSoFar, session: string) => {
      bySession.set(session, [...(bySession.get(session) ?? []), file.charges])
      const name = (n: string) => (n === SESSION_ROW ? session : n)
      for (const c of file.calls) if (c.at >= since && c.at < started) calls.push({ ...c, name: name(c.name) })
      // Only the hours the book gives up: a later one, reached while the index ran, keeps its live charges.
      for (const [key, tokens] of file.charges) {
        const [kind, row, hour] = key.split('\u0000') as [Kind, string, string]
        if (isIndexHour(Number(hour), since, started)) charges.push({ kind, name: name(row), at: Number(hour) * HOUR, tokens })
      }
      for (const [hour, tokens] of file.totals) if (isIndexHour(hour, since, started)) totals.push({ at: hour * HOUR, tokens })
      for (const [key, tokens] of file.models) {
        const [agent, model, effort] = key.split('|') as [string, string, string]
        const at = file.modelsAt.get(key) ?? 0
        models.push({ ...(agent ? { agent } : {}), model, effort, tokens, at })
        if (!agent && at > (sessionLatest[session]?.at ?? -1)) sessionLatest[session] = { key: `${model}|${effort}`, at }
      }
      for (const [key, tokens] of file.agentSkills) {
        const cut = key.indexOf('|')
        agentRuns.push({ agent: key.slice(0, cut), skill: key.slice(cut + 1), tokens })
      }
    }

    for (const [i, file] of chosen.entries()) {
      const id = file.path.slice(file.path.lastIndexOf('/') + 1, -'.jsonl'.length)
      const ctx = { since, isRouter: (n: string) => routers.has(n) }
      const main = await readSoFar($, file.path, file.size, ctx)
      const session = main.title ?? `Session ${id.slice(0, 8)}`
      take(main, session)
      // The session's subagents: their calls count toward it, and toward their agent.
      // Workflow agents sit deeper, under subagents/workflows/<run>/: walked like the app's enumerator.
      const subs: Array<{ dir: string; name: string; size: number; mtimeMs: number }> = []
      const walk = async (dir: string, depth: number): Promise<void> => {
        for (const entry of await $.fs.list(dir).catch(() => [])) {
          if (entry.kind === 'dir' && depth < 3) await walk(`${dir}/${entry.name}`, depth + 1)
          else if (entry.kind === 'file' && entry.name.endsWith('.jsonl') && entry.mtimeMs >= since) subs.push({ dir, name: entry.name, size: entry.size, mtimeMs: entry.mtimeMs })
        }
      }
      await walk(`${file.path.slice(0, -'.jsonl'.length)}/subagents`, 0)
      for (const { dir, ...sub } of subs) {
        const meta = await $.fs.read(`${dir}/${sub.name.slice(0, -'.jsonl'.length)}.meta.json`).catch(() => undefined)
        let agent = 'general-purpose'
        let task: string | undefined
        try {
          const m = JSON.parse(typeof meta === 'string' ? meta : '{}') as { agentType?: string; description?: string }
          agent = m.agentType || agent
          task = typeof m.description === 'string' && m.description !== '' ? m.description : undefined
        } catch {}
        const name = agent.includes(':') ? bareName(agent) : agent
        const subFile = await readSoFar($, `${dir}/${sub.name}`, sub.size, { ...ctx, agent: name })
        take(subFile, session)
        // The agent's latest run, as the app's AgentPopover finds it: the newest transcript of its type.
        const tokensRun = [...subFile.totals.values()].reduce((n, t) => n + t, 0)
        if (tokensRun > 0 && sub.mtimeMs > started - 30 * DAY) (runTokens[name] ??= []).push({ tokens: tokensRun, started: sub.mtimeMs, ended: sub.mtimeMs })
        if (tokensRun > 0 && sub.mtimeMs > (runs[name]?.ended ?? 0)) {
          runs[name] = { ...(task ? { task } : {}), tokens: tokensRun, started: sub.mtimeMs, ended: sub.mtimeMs, session, sessionId: id, path: `${dir}/${sub.name}` } as AgentRun & { path: string }
        }
      }
      if (i % 10 === 9) await update($, indexing, cur => ({ ...cur, done: i + 1 }))
    }

    // Every open Claude Code session runs its own copy of the mod over one shared store:
    // a session still on older counting rules must not overwrite a newer one's totals.
    const storedVersion = Number((await $.store.get('indexVersion')) ?? 0)
    if (storedVersion > INDEX_VERSION) {
      await update($, indexing, () => ({ done: chosen.length, total: chosen.length, at: started }))
      return
    }
    await $.store.set('indexVersion', INDEX_VERSION)

    const now = await $.clock.now()
    const of = (kind: Kind) => calls.filter(c => c.kind === kind)
    const skillsMerged = mergeWindow(await read($, history), of('skills'), since, started, now)
    await update($, history, () => skillsMerged)
    await $.store.set('history', skillsMerged)
    const stored = await read($, activity)
    const merged: Activity = { ...EMPTY_ACTIVITY, ...stored }
    for (const kind of DROPDOWN) merged[kind] = mergeWindow(stored[kind] ?? {}, of(kind), since, started, now, ACTIVITY_CAP)
    await update($, activity, () => merged)
    await $.store.set('activity', merged)

    const keptBook = pruneTokens(await read($, tokens), now)
    for (const kind of Object.keys(keptBook) as Kind[]) {
      for (const [name, hours] of Object.entries(keptBook[kind])) keptBook[kind][name] = keepHours(hours, since, started)
    }
    const book = addTokens(keptBook, charges, now)
    await update($, tokens, () => book)
    await $.store.set('tokens', book)
    const allTotals = addHours(keepHours(await read($, totalTokens), since, started), totals, now)
    await update($, totalTokens, () => allTotals)
    await $.store.set('totalTokens', allTotals)

    // Each agent's models and the skills it ran: rebuilt whole from the window.
    const agentModels: Record<string, Record<string, number>> = {}
    for (const m of models) {
      const agent = m.agent ?? ''
      if (!agent) continue
      const key = `${m.model}|${m.effort}`
      agentModels[agent] = { ...(agentModels[agent] ?? {}), [key]: (agentModels[agent]?.[key] ?? 0) + m.tokens }
    }
    await update($, agentModelsAtom, () => agentModels)
    await $.store.set('agentModels', agentModels)
    // The label names the model an agent ran on last, not the one it spent most on.
    const latest: Record<string, { key: string; at: number }> = {}
    for (const m of models) {
      if (!m.agent) continue
      const cur = latest[m.agent]
      if (!cur || m.at > cur.at) latest[m.agent] = { key: `${m.model}|${m.effort}`, at: m.at }
    }
    const lastByAgent = Object.fromEntries(Object.entries(latest).map(([agent, l]) => [agent, l.key]))
    await update($, agentLast, () => lastByAgent)
    await $.store.set('agentLast', lastByAgent)
    const lastBySession = Object.fromEntries(Object.entries(sessionLatest).map(([session, l]) => [session, l.key]))
    await update($, sessionLast, () => lastBySession)
    await $.store.set('sessionLast', lastBySession)
    sessionFiles = bySession
    // A run's start: the first timestamp in its transcript, read from its head.
    for (const run of Object.values(runs)) {
      const head = run.path ? (await $.process.run(['head', '-c', '4000', run.path]).catch(() => undefined))?.stdout : undefined
      const stamp = /"timestamp":"([^"]+)"/.exec(head ?? '')?.[1]
      const started = stamp ? Date.parse(stamp) : NaN
      if (Number.isFinite(started) && started <= run.ended) run.started = started
      delete run.path
    }
    await update($, agentRunsAtom, () => runs)
    await $.store.set('agentRuns', runs)
    // The latest run's start from its head: the record card says how long it took.
    for (const [name, list] of Object.entries(runTokens)) {
      const latest = list.reduce((a, b) => (b.ended > a.ended ? b : a))
      latest.started = runs[name]?.started ?? latest.started
    }
    await update($, agentRunTokens, () => runTokens)
    await $.store.set('agentRunTokens', runTokens)
    const agentSkills: Record<string, Record<string, number>> = {}
    for (const r of agentRuns) agentSkills[r.agent] = { ...(agentSkills[r.agent] ?? {}), [r.skill]: (agentSkills[r.agent]?.[r.skill] ?? 0) + r.tokens }
    await update($, agentSkillsAtom, () => agentSkills)
    await $.store.set('agentSkills', agentSkills)

    await $.store.set('backfilled', true)
    await update($, indexing, () => ({ done: chosen.length, total: chosen.length, at: now }))
    $.ui.log(`skillkeeper: indexed ${calls.length} calls from ${chosen.length} transcripts`, { to: 'debug' })
  } finally {
    isIndexing = false
  }
}

let version = ''
/** The key typed on the settings screen this session; the store keeps only its hash. */
let typedKey = ''

/** Where both clients keep the trial: one per machine (docs/shared_trial_spec.md). */
async function trialPath($: Engine): Promise<string> {
  return `${await home($)}/.claude/skillkeeper/trial.json`
}

/** A Mac says `this Mac` in the locked line, anything else `this computer`. */
let isMac = true

/** The store's copy and the file's, merged; a broken or missing file is just absent. */
async function readTrial($: Engine): Promise<{ file?: TrialState; own?: TrialState; merged?: TrialState }> {
  const file = parseTrial(await $.fs.read(await trialPath($)).catch(() => undefined))
  const own = parseTrial(JSON.stringify((await $.store.get('trial')) ?? null))
  const merged = mergeTrials(file, own)
  return { ...(file ? { file } : {}), ...(own ? { own } : {}), ...(merged ? { merged } : {}) }
}

/** Kept in the store and in the file: a temp file renamed over, so the app never reads half of it. */
async function writeTrial($: Engine, state: TrialState): Promise<void> {
  await $.store.set('trial', state)
  const path = await trialPath($)
  const tmp = `${path}.${await $.clock.now()}.tmp`
  if (!(await $.fs.write(tmp, trialFile(state)).then(() => true, () => false))) return
  const moved = await $.process.run(['mv', '-f', tmp, path]).catch(() => undefined)
  if (moved?.exitCode === 0) return
  const moveWin = await $.process.run(['cmd', '/c', 'move', '/y', tmp, path]).catch(() => undefined)
  if (moveWin?.exitCode !== 0) await $.fs.write(path, trialFile(state)).catch(() => undefined)
}

async function trialProps($: Engine, state: TrialState): Promise<EventProps> {
  return { client: 'mod', trial_source: ((await $.store.get('trialSource')) as string | undefined) ?? 'own', day: dayNumber(state, await $.clock.now()) }
}

async function showTrial($: Engine, state: TrialState): Promise<void> {
  const now = await $.clock.now()
  const isActive = isTrialActive(state, now)
  await update($, trial, () => ({ isLoaded: true, isActive, days: dayNumber(state, now) }))
  if (!isActive && !(await $.store.get('trialEndedSent'))) {
    await $.store.set('trialEndedSent', true)
    void track($, 'trial_ended', await trialProps($, state), false)
  }
}

/** Launch: the file and the store merged and written back; neither there starts a trial now. */
async function loadTrial($: Engine): Promise<void> {
  isMac = (await home($)).startsWith('/Users/')
  const nowSec = Math.floor((await $.clock.now()) / 1000)
  const { file, own, merged } = await readTrial($)
  // Shared: this client's first launch found a trial the app started.
  if ((await $.store.get('trialSource')) === undefined) await $.store.set('trialSource', !own && file ? 'shared' : 'own')
  const state = merged ?? { start: nowSec, days: 0, last: '' }
  await writeTrial($, state)
  await showTrial($, state)
}

/** The panel opens: read again (the app may have counted today), count today once, write. */
async function countTrialDay($: Engine): Promise<void> {
  const now = await $.clock.now()
  const nowSec = Math.floor(now / 1000)
  const { merged } = await readTrial($)
  const state = merged ?? { start: nowSec, days: 0, last: '' }
  const counted = countDay(state, now)
  await writeTrial($, counted)
  if (counted !== state) void track($, 'trial_day', await trialProps($, counted), false)
  await showTrial($, counted)
}

/** Week, Month and skill edits: a good key, or the trial still running. */
async function isUnlocked($: Engine): Promise<boolean> {
  return !PAYWALL || (await read($, license)).isPro || (await read($, trial)).isActive
}

/** Notifications are paid too: open in the trial and with a key, as the app's (owner, 2026-10-04, B). */
async function isNoticesLocked($: Engine): Promise<boolean> {
  return PAYWALL && (await read($, trial)).isLoaded && !(await isUnlocked($))
}

/** The buy page, tagged so a sale ties back to this install; the app's event for the click. */
async function openBuy($: Engine, source: string): Promise<void> {
  const id = isOwnerHome(await home($)) ? OWNER_ID : ((await $.store.get('analyticsId')) as string | undefined)
  void track($, 'license_offer_click', { source }, false)
  await openFile($, buyUrl(id))
}

async function checkLicense($: Engine, key: string): Promise<void> {
  if (!PAYWALL) return
  if (!isKeyShaped(key)) {
    if (key.trim() !== '') await update($, licenseNote, () => 'That key doesn’t look right – check for typos')
    await update($, license, () => ({ isPro: false, checkedAt: null }))
    return
  }
  const now = await $.clock.now()
  const hash = await sha256Hex(key.trim())
  const stored = (await $.store.get('license')) as StoredLicense | undefined
  let verdict = stored?.hash === hash ? stored : undefined

  if (needsRecheck(stored, hash, now)) {
    let deviceId = (await $.store.get('deviceId')) as string | undefined
    if (!deviceId) {
      deviceId = newDeviceId()
      await $.store.set('deviceId', deviceId)
    }
    const answer = await $.http.fetch('https://fadercraft.com/api/skillkeeper-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ license: key.trim(), device_id: deviceId, supports_expiry: true }),
    }).catch(() => undefined)
    // Offline: a key accepted before keeps working.
    if (answer) {
      verdict = { hash, isPro: isActivated(answer.status, answer.text), checkedAt: now, expiresAt: parseExpiry(answer.text) }
      await $.store.set('license', verdict)
      // The server's own words when it refuses the key (a device limit, a typo).
      const note = verdict.isPro ? 'License activated – thank you!' : (activationError(answer.text) ?? 'That key doesn’t look right – check for typos')
      await update($, licenseNote, () => note)
      if (!verdict.isPro) $.ui.toast(`skillkeeper · ${note}`)
      else if (!stored?.isPro) void track($, 'license_activated', {}, false)
      if (!verdict.isPro) void track($, 'license_activation_failed', { reason: answer.status === 200 ? 'rejected' : `http_${answer.status}` }, false)
    } else {
      await update($, licenseNote, () => 'Couldn’t reach the activation server – try again later')
    }
  }
  await update($, license, () => ({ isPro: (verdict?.isPro ?? false) && !isExpired(verdict?.expiresAt, now), checkedAt: verdict?.checkedAt ?? null }))
}

/**
 * A key typed on the settings screen: checked, then kept where /config keeps it (the
 * field is sensitive: the keychain), so the next session has it. The store holds only
 * its hash, and this session's `typedKey` dies with the session or a reload.
 */
async function submitKey($: Engine, value: string): Promise<void> {
  void track($, 'license_activate_tap')
  typedKey = value.replace(/\s+/g, '')
  await checkLicense($, typedKey)
  if (!isKeyShaped(typedKey) || (PAYWALL && !(await read($, license)).isPro)) return
  const kept = await $.config.set({ key: 'skillkeeper.licenseKey', value: typedKey }).catch(() => ({ deny: 'failed' }))
  if (kept.deny !== undefined) await update($, licenseNote, () => 'Couldn’t keep the key – add it in /config')
}

async function saveFolders($: Engine, change: (list: string[]) => string[]): Promise<void> {
  // The app's setup events: a folder added or removed.
  const before = await read($, folders)
  const after = change(before)
  if (after.length !== before.length) void track($, after.length > before.length ? 'setup_add_folder' : 'setup_remove_folder')
  await update($, folders, change)
  await $.store.set('folders', await read($, folders))
  await rescan($, settingsCwd)
  void indexHistory($)
}

/** The cwd rescans run from: the session's, set at start. */
let settingsCwd = '.'

async function setPeriod($: Engine, period: Period): Promise<void> {
  await update($, scroll, () => 0)
  if (!isPeriodOpen(period, await isUnlocked($))) {
    void track($, 'timeframe_locked', { value: period })
    $.ui.toast('skillkeeper · 5h, Week and Month need a license')
    return
  }
  // The limit readout follows the period: the 5-hour limit for 5h and 24h, the week's
  // for Week and Month (Claude has no monthly limit); a press still switches it.
  if ((await read($, view)).period !== period) void track($, 'timeframe', { value: period })
  await update($, view, v => ({ ...v, period, limit: period === 'fiveHours' || period === 'day' ? ('five_hour' as const) : ('seven_day' as const) }))
  await $.store.set('view', await read($, view))
}

/** Opens or closes a router: ABC keeps the person's collapsed set, the other sorts their session openings. */
async function toggleGroup($: Engine, name: string): Promise<void> {
  const flip = (list: string[]) => (list.includes(name) ? list.filter(n => n !== name) : [...list, name])
  const cur = await read($, view)
  const isCollapsing = cur.sort === 'abc' ? !cur.collapsed.includes(name) : cur.expanded.includes(name)
  void track($, 'group_toggle', { collapsed: isCollapsing })
  await changeView($, cur => (cur.sort === 'abc' ? { ...cur, collapsed: flip(cur.collapsed) } : { ...cur, expanded: flip(cur.expanded) }))
}

async function changeView($: Engine, change: (v: View) => View): Promise<void> {
  const before = await read($, view)
  await update($, view, change)
  const after = await read($, view)
  await $.store.set('view', after)
  // The presses the app counts, named as it names them.
  if (after.source !== before.source) void track($, 'tab', { value: after.source })
  if (after.sort !== before.sort) void track($, 'sort', { value: after.sort })
  if (after.limit !== before.limit && after.period === before.period) void track($, 'limit_readout', { value: after.limit })
  if (after.pinnedShowsTotal !== before.pinnedShowsTotal) void track($, 'pinned_total', { on: after.pinnedShowsTotal })
}

/**
 * The SkillKeeper panel, drawn in the pane, or in the chat as the command's output where
 * the surface shows no pane (the editor extension): the same tree, sized to its site.
 */
/**
 * The panel as text, for a chat that draws no mod UI (the editor extensions):
 * the All tab in the person's period and sort, the limit, Total tokens.
 */
async function chatReport($: Engine): Promise<string> {
  const now = await $.clock.now()
  const v = await read($, view)
  const calls = await read($, history)
  const others = await read($, activity)
  const book = await read($, tokens)
  const windows = await read($, limits)
  const since = periodStart(v.period, now, await read($, sessionStart))
  const rows = sortRows(
    ALL_KINDS.flatMap(k => (k === 'skills' ? flatRows(calls, since, 'skills', book.skills) : flatRows(others[k] ?? {}, since, k, book[k]))).filter(
      r => r.period > 0 || r.tokens > 0,
    ),
    v.sort,
  ).slice(0, 20)
  const metric = (r: Row) => (v.sort === 'usage' ? r.tokens : r.period)
  const label = (r: Row) =>
    r.source ? KIND_LABEL[r.source] : ''
  const names = rows.map(r => `${r.name} ${label(r)}`.trim())
  const width = Math.min(40, Math.max(12, ...names.map(n => n.length)))
  const figure = (n: number) => (v.sort === 'usage' ? countText(n) : String(n))
  const period = PERIODS.find(p => p.id === v.period)?.label ?? '24h'
  const sortLabel = SORTS.find(s => s.id === v.sort)?.label ?? '321'
  const limit = windows.find(w => w.kind === v.limit) ?? windows[0]
  const lines = [`SkillKeeper · ${period} · ${sortLabel}`]
  if (limit) lines.push(`${v.limit === 'seven_day' ? 'Week' : '5h'} limit ${Math.round(limit.percentUsed)}% · resets in ${countdown(Date.parse(limit.resetsAt ?? '') - now || 0)}`)
  lines.push('')
  rows.forEach((r, i) => lines.push(`${clip(names[i] as string, width).padEnd(width)}  ${figure(metric(r)).padStart(6)}`))
  if (rows.length === 0) lines.push('Nothing ran in this period')
  lines.push('', `${'Total tokens'.padEnd(width)}  ${countText(tokensSince(await read($, totalTokens), since)).padStart(6)}`)
  lines.push('', 'The full panel opens in the terminal: /skillkeeper')
  return lines.join('\n')
}

/** A 10-cell bar in the notice's colour, with a tick where the suggestion starts. */
function noticeBar(Text: ReturnType<Engine['ui']['resolve']>['Text'], n: Notice): RenderElement[] {
  const width = 10
  const full = Math.round(Math.min(1, Math.max(0, n.bar ?? 0)) * width)
  const markAt = n.mark === undefined ? -1 : Math.min(width - 1, Math.round(n.mark * width))
  return Array.from({ length: width }, (_, i) =>
    i === markAt ? (
      <Text key={`m${i}`}>┃</Text>
    ) : (
      <Text key={`c${i}`} color={i < full ? n.color : COLOR.track}>━</Text>
    ),
  )
}

const GROUP_TITLE = { now: '', today: 'TODAY', anytime: 'ANYTIME' } as const

type NoticesDraw = { ui: ReturnType<Engine['ui']['resolve']>; geom: { columns: number; rows: number; inline: boolean } }
/** What the notifications screen draws with: set by drawPanel just before it calls renderNotices. */
let noticesDraw = undefined as unknown as NoticesDraw

/** The notifications screen: cards by urgency – Now (no header), Today, Anytime. */
async function renderNotices($: Engine): Promise<RenderElement> {
  const { ui, geom } = noticesDraw
  const { Box, Text, Button } = ui
  const isLocked = await isNoticesLocked($)
  const list = isLocked ? [] : await currentNotices($)
  const width = Math.max(16, geom.columns - 2 * PAD_X - 2)
  const back = () => {
    void track($, 'notifications_flip', { to: 'front', count: list.length })
    void update($, screen, () => 'list' as const)
  }
  const hide = (ids: string[]) => void update($, dismissed, cur => [...cur, ...ids])
  const dismissOne = (n: Notice) => {
    void track($, 'notification_dismiss', { kind: n.kind, via: 'card' })
    hide([n.id])
  }
  const groups = (['now', 'today', 'anytime'] as const).map(g => ({ g, items: list.filter(n => n.group === g) })).filter(x => x.items.length > 0)
  const scanned = await read($, scannedAt)
  const now = await $.clock.now()
  // The main screen's rows (owner, 2026-10-04: same spacing as the first screen):
  // a blank row, the close mark's row, the header, the cards, the footer pinned below.
  return (
    // The main screen's height, so the header and the footer sit on the same rows (owner,
    // 2026-10-04: content jumped between the screens).
    // The main screen is `rows` + 2 tall: its list gets `rows − chrome`, and the blank
    // rows above and below aren't in `chrome` – so the footer lands on the same row.
    <Box flexDirection="column" height={geom.rows + 2}>
      <Text> </Text>
      <Box flexDirection="column" paddingX={PAD_X} flexGrow={1}>
        <Text> </Text>
        <Box justifyContent="space-between" columnGap={1}>
          {/* The title leads back to the list (owner, 2026-10-05: the bell alone wasn't found). */}
          <Button key="notices-header-back" plain label="‹ Notifications" onPress={back} />
          {list.length > 0 && <Button key="notices-clear" plain dimColor label="Clear all" onPress={() => {
            void track($, 'notifications_clear_all', { count: list.length })
            hide(list.map(n => n.id))
          }} />}
        </Box>
      {isLocked ? (
        // After the trial, as the app's locked state: what they would tell, and where to buy.
        <Box flexDirection="column" marginTop={1}>
          <Text>Trial ended – notifications need a license</Text>
          {([[NOTICE_COLOR.chat, 'This chat is due for /compact'], [NOTICE_COLOR.limit, 'A limit may run out before reset'], [NOTICE_COLOR.skill, 'Claude may skip one of your skills']] as const).map(([color, line], i) => (
            <Box key={`locked-when-${i}`} gap={1}>
              <Text color={color}>■</Text>
              <Text dimColor>{line}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Button key="notices-buy" plain label="Buy a license on Gumroad" onPress={() => void openBuy($, 'notifications_locked')} />
          </Box>
        </Box>
      ) : list.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {/* The app's list (owner's wording, 2026-10-04), with the mod's own cases. */}
          {/* The cards' colour squares instead of bullets (owner, 2026-10-04). */}
          {([[NOTICE_COLOR.chat, 'This chat is due for /compact'], [NOTICE_COLOR.limit, 'A limit may run out before reset'], [NOTICE_COLOR.skill, 'Claude may skip one of your skills']] as const).map(([color, line], i) => (
            <Box key={`empty-${i}`} gap={1}>
              <Text color={color}>■</Text>
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        groups.map(({ g, items }) => (
          <Box key={`group-${g}`} flexDirection="column" marginTop={1}>
            {GROUP_TITLE[g] !== '' && <Text dimColor>{GROUP_TITLE[g]}</Text>}
            {items.map(n => (
              <Box key={`notice-${n.id}`} flexDirection="column" marginTop={g === 'now' && n === items[0] ? 0 : 1}>
                <Box justifyContent="space-between" columnGap={1}>
                  <Box gap={1} flexShrink={1}>
                    <Text color={n.color}>■</Text>
                    {/* One line, never more (owner, 2026-10-04): a long name ends in "…". */}
                    <Box flexShrink={1}><Text bold wrap="truncate-end">{n.subject ?? n.title}</Text></Box>
                    {n.subjectType !== undefined && <Box flexShrink={0}><Text dimColor>{n.subjectType}</Text></Box>}
                    {n.bar !== undefined && <Box>{noticeBar(Text, n)}</Box>}
                  </Box>
                  <Button key={`notice-x-${n.id}`} plain dimColor label="✕" onPress={() => dismissOne(n)} />
                </Box>
                {n.subject !== undefined && <Text>{n.title}</Text>}
                {n.body !== undefined && wrapText(n.body, width).map((line, i) => (
                  <Text key={`notice-b-${n.id}-${i}`} dimColor>{line}</Text>
                ))}
                {n.action === 'compact' && (
                  <Box marginTop={1}>
                    <Button key={`notice-compact-${n.id}`} label="Compact now" onPress={() => void compactNow($, 'card')} />
                  </Box>
                )}
                {n.action === 'showAgent' && n.subject !== undefined && (
                  <Box marginTop={1}>
                    <Button key={`notice-agent-${n.id}`} label="Show agent" onPress={() => void showAgent($, n.subject as string)} />
                  </Box>
                )}
                {/* The app's card menu, in a row: mute, turn the kind off, settings. */}
                <Box columnGap={2} flexWrap="wrap">
                  {n.muteKey !== undefined && <Button key={`notice-mute-${n.id}`} plain dimColor label="Mute until tomorrow" onPress={() => void muteNotice($, n)} />}
                  <Button key={`notice-off-${n.id}`} plain dimColor label={`Stop showing ${KIND_PLURAL[n.kind]}`} onPress={() => void turnNotices($, n.kind, false)} />
                  <Button key={`notice-settings-${n.id}`} plain dimColor label="Notification settings…" onPress={() => {
                    void track($, 'notification_settings_open')
                    void update($, screen, () => 'settings' as const)
                  }} />
                </Box>
              </Box>
            ))}
          </Box>
        ))
      )}
        <Box flexGrow={1} />
        {/* The main screen's footer: the bell in the middle turns back to the list. */}
        <Box justifyContent="space-between" columnGap={1} paddingRight={1}>
          <Text dimColor>{`↻ ${clockTime(scanned || now)}`}</Text>
          <Button key="notices-back" plain label={list.length > 0 ? `${list.length} notifications` : 'Notifications'} onPress={back} />
          <Button key="notices-settings" plain label="Settings" onPress={() => {
            void track($, 'settings_open', { from: 'notifications' })
            void update($, screen, () => 'settings' as const)
          }} />
        </Box>
      </Box>
      <Text> </Text>
    </Box>
  )
}

async function drawPanel(
  $: Engine,
  e: Parameters<Engine['ui']['resolve']>[0],
  geom: { columns: number; rows: number; inline: boolean },
): Promise<RenderElement> {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const now = await $.clock.now()
  lastPaneDrawn = now
  if (needsTop && !geom.inline) {
    needsTop = false
    // The tree mounts a moment after the hook returns: try, and once more if it is not there yet.
    const toTop = (tries: number) =>
      $.clock.after(tries === 3 ? 150 : tries === 2 ? 400 : 900, () =>
        void $.ui
          .scroll({ to: { key: 'pane-top' }, in: PANE, block: 'start' })
          .then(r => {
            if (r.deny && tries > 1) toTop(tries - 1)
          })
          .catch(() => undefined),
      )
    toTop(3)
  }
  const skills = await read($, library)
  const calls = await read($, history)
  const others = await read($, activity)
  const allHours = await read($, totalTokens)
  const defs = await read($, agentDefs)
  const models = await read($, agentModelsAtom)
  const last = await read($, agentLast)
  const sessionLasts = await read($, sessionLast)
  const agentRuns = await read($, agentRunsAtom)
  const seenModels = Object.values(models).flatMap(m => Object.keys(m))
  const book = await read($, tokens)
  const v = await read($, view)
  const lic = await read($, license)
  const trialView = await read($, trial)
  // Paid after the trial: Week, Month, skill edits, notifications; duplicate-trigger marks too, as in the app.
  const pro = isProOpen(lic.isPro || trialView.isActive)
  const isLocked = PAYWALL && trialView.isLoaded && !pro
  // Locked, the bell counts nothing, as the app's.
  const noticeCount = isLocked ? 0 : (await currentNotices($)).length

  // The notifications screen: the app's bell layer, as a screen of the pane.
  if ((await read($, screen)) === 'notifications') {
    noticesDraw = { ui, geom }
    const notices = await renderNotices($)
    return notices
  }

  // The settings screen, as the app's Settings window: version, privacy, license,
  // skill folders, links; ‹ Back or Esc returns to the list.
  if ((await read($, screen)) === 'settings') {
    const note = await read($, licenseNote)
    const off = await read($, noticesOff)
    const reviewStep = await read($, review)
    const added = await read($, folders)
    const width = Math.max(16, geom.columns - 2 * PAD_X)
    const back = () => {
      void track($, 'settings_close')
      void update($, review, () => 'closed' as const)
      void update($, screen, () => 'list' as const)
    }
    return (
      <Box flexDirection="column" paddingX={PAD_X} paddingTop={PAD_Y}>
        <Box justifyContent="space-between" paddingRight={2}>
          <Box gap={1}>
            <Text bold>SkillKeeper</Text>
            {version !== '' && <Text dimColor>{`mod ${version}`}</Text>}
          </Box>
          <Button key="settings-back" plain label="‹ Back" onPress={back} />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {wrapText('SkillKeeper reads your local session history and skill files – nothing more. It edits a skill only when you add a trigger in its card.', width).map((line, i) => (
            <Text key={`privacy-${i}`} dimColor>
              {line}
            </Text>
          ))}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {lic.isPro ? (
            <Text color={COLOR.green}>✓ All features unlocked</Text>
          ) : (
            <>
              <Text>Have a license key?</Text>
              {'Input' in ui ? (
                <ui.Input
                  key="license"
                  placeholder="SKKP-..."
                  submitLabel="Activate"
                  onSubmit={value => void submitKey($, value)}
                />
              ) : (
                <Text dimColor>Enter the key in /config</Text>
              )}
              {!PAYWALL ? (
                <Text dimColor>Every feature is free for 3 days. One key works for the mod and the macOS app</Text>
              ) : isLocked ? (
                <Box gap={1}>
                  <Text dimColor>{lockedLine(isMac)}</Text>
                  <Button key="settings-buy" plain label="Buy · $19" onPress={() => void openBuy($, 'settings')} />
                </Box>
              ) : (
                trialView.isLoaded && <Text dimColor>{`Trial: day ${Math.max(1, trialView.days)} of ${TRIAL_DAYS}`}</Text>
              )}
            </>
          )}
          {note !== '' && <Text dimColor>{note}</Text>}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {/* The app's Settings → Notifications…: one checkbox per kind. */}
          <Text>Show these notifications</Text>
          {NOTICE_KINDS.map(kind => {
            const isOn = !off.includes(kind)
            return (
              <Button
                key={`notice-kind-${kind}`}
                plain
                dimColor={!isOn}
                label={`${isOn ? '☑' : '☐'} ${KIND_PLURAL[kind].charAt(0).toUpperCase()}${KIND_PLURAL[kind].slice(1)}`}
                onPress={() => void turnNotices($, kind, !isOn)}
              />
            )
          })}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text>Skill folders</Text>
          <Text dimColor>{'  ~/.claude/skills'}</Text>
          <Text dimColor>{'  ./.claude/skills'}</Text>
          {extraFolders.map(folder => (
            <Text key={`cfg-${folder}`} dimColor>{`  ${folder}  (from /config)`}</Text>
          ))}
          {added.map(folder => (
            <Box key={`folder-${folder}`} gap={1}>
              <Text>{`  ${folder}`}</Text>
              <Button key={`folder-remove-${folder}`} plain dimColor label="✕" onPress={() => void saveFolders($, list => list.filter(f => f !== folder))} />
            </Box>
          ))}
          {'Input' in ui && (
            <ui.Input
              key="folder-add"
              placeholder="+ Add folder (path)"
              submitLabel="Add"
              onSubmit={value => {
                const folder = value.trim().replace(/\/+$/, '')
                if (folder !== '') void saveFolders($, list => (list.includes(folder) ? list : [...list, folder]))
              }}
            />
          )}
        </Box>

        <Box marginTop={1} gap={2}>
          {/* A button, not a Link: a terminal without hyperlinks prints a Link's URL after it. */}
          <Button key="site" plain label="SkillKeeper.app" onPress={() => void openFile($, SITE)} />
          {!(await home($)).startsWith('/Users/') && <Button key="site-mac" plain label="SkillKeeper for macOS" onPress={() => void openFile($, SITE)} />}
        </Box>
        {/* On a line of its own (owner, 2026-10-05). */}
        <Box>
          <Button key="review-open" plain label="Leave a review" onPress={() => {
            void track($, 'feedback_open', { entry: 'settings' })
            void update($, review, () => 'ask' as const)
          }} />
        </Box>
        {/* The app's two-thumb review: 👍 thanks, 👎 asks what's wrong; both go to the same survey. */}
        {reviewStep === 'ask' && (
          <Box gap={2} marginTop={1}>
            <Button key="review-up" plain label="👍" onPress={() => void sendReview($, true)} />
            <Button key="review-down" plain label="👎" onPress={() => void ('Input' in ui ? update($, review, () => 'wrong' as const) : sendReview($, false))} />
          </Box>
        )}
        {reviewStep === 'thanks' && <Box marginTop={1}><Text>Thanks – that helps a lot</Text></Box>}
        {reviewStep === 'wrong' && (
          <Box flexDirection="column" marginTop={1}>
            <Text>Sorry to hear that. What's wrong?</Text>
            {'Input' in ui && (
              <ui.Input key="review-text" placeholder="What would make SkillKeeper better?" submitLabel="send" autoFocus onSubmit={value => void sendReview($, false, value)} />
            )}
          </Box>
        )}
      </Box>
    )
  }
  const hide = await read($, hidden)
  const base = await read($, baseline)
  const scanned = await read($, scannedAt)
  const idx = await read($, indexing)
  const windows = await read($, limits)
  const ctx = await read($, context)
  const isMac = (await home($)).startsWith('/Users/')

  const since = periodStart(v.period, now, await read($, sessionStart))
  const rows: Row[] =
    v.source === 'skills'
      ? layoutRows({
          library: skills,
          history: calls,
          since,
          sort: v.sort,
          collapsed: v.collapsed,
          expanded: v.expanded,
          favorites: await read($, favorites),
          onStart: await read($, onStart),
          hidden: hide,
          baseline: base,
          marks: computeMarks(skills, { shared: pro }),
          tokens: book.skills,
        })
      : v.source === 'all'
        ? sortRows(
            ALL_KINDS.flatMap(k => (k === 'skills' ? flatRows(calls, since, 'skills', book.skills) : flatRows(others[k] ?? {}, since, k, book[k]))).filter(
              r => r.period > 0 || r.tokens > 0,
            ),
            v.sort,
          )
        : sortRows(
            // Agents lists every definition too, used or not, as the app's.
            v.source === 'agents'
              ? [...flatRows(others.agents ?? {}, since, 'agents', book.agents), ...defs.filter(d => !(others.agents ?? {})[d.name] && !book.agents[d.name]).map(d => blankRow(d.name, 'agents'))]
              : flatRows(others[v.source] ?? {}, since, v.source, book[v.source]),
            v.sort,
          )

  const times =
    v.source === 'skills'
      ? Object.values(calls).flat()
      : v.source === 'all'
        ? [...Object.values(calls), ...ALL_KINDS.filter(k => k !== 'skills').flatMap(k => Object.values(others[k] ?? {}))].flat()
        : Object.values(others[v.source] ?? {}).flat()

  // What a row's figure and bar show: calls, or under Usage the tokens, as the app.
  const metric = (r: Row) => (v.sort === 'usage' ? r.tokens : r.period)
  // One scale for every row: a row's share of the period's total, as the app's bars.
  const scale = rows.filter(r => r.kind !== 'group').reduce((n, r) => n + metric(r), 0)
  const limit = windows.find(w => w.kind === v.limit) ?? windows[0]
  const barColor = limitColor(limit?.percentUsed)
  const limitBar = barCells((limit?.percentUsed ?? 0) / 100, LIMIT_BAR_WIDTH)

  // Breathing room inside the pane's frame, as the app's 12pt insets.
  const inner = geom.columns - 2 * PAD_X
  const isNarrow = inner < NARROW_COLUMNS
  // As the app: Usage charts tokens, the other sorts calls.
  const usageItems = (kind: Kind | 'all') =>
    kind === 'all' ? hourItems(allHours) : Object.values(book[kind] ?? {}).flatMap(hours => hourItems(hours))
  const chartItems = v.sort === 'usage' ? usageItems(v.source) : times
  const span = chartWindow(v.period, now)
  const chart = sparkline(chartItems, span, Math.max(8, inner))
  const isPulse = await read($, pulse)
  // A row's own chart items, for the chart that lights while the row is hovered.
  const rowItems = (row: Row): Array<number | { at: number; weight: number }> => {
    const kind = row.source ?? 'skills'
    const names = row.kind === 'group' ? [row.name, ...skills.filter(sk => sk.router === row.name).map(sk => sk.name)] : [row.name]
    return names.flatMap<number | { at: number; weight: number }>(name =>
      v.sort === 'usage' ? hourItems(book[kind]?.[name]) : kind === 'skills' ? (calls[name] ?? []) : (others[kind as DropdownKind]?.[name] ?? []),
    )
  }
  // The header, chart and footer stay put; the list scrolls in the rows between
  // (ui.scroll below keeps the engine's own window at the top and moves this one).
  // As the app: on All the context block lists the live sessions past the warning line,
  // heaviest first, up to three; Total sits in Usage.
  const liveRows = (await read($, live)).filter(l => contextLevel(l.tokens, l.window) !== 'normal').slice(0, 3)
  const showsContext = v.source === 'all' && liveRows.length > 0
  const showsPinned = v.sort === 'usage'
  const pinnedRows = showsContext ? 1 + liveRows.length : showsPinned ? 2 : 0
  // Rows besides the list: the top padding (the close mark's row), the switcher,
  // periods, chart and the spaces between, Total tokens with the row above it (or
  // the expensive context in its place), the footer.
  // The locked block over the footer: its line, the buy row, a blank row above.
  const lockedLines = isLocked ? wrapText(lockedLine(isMac), Math.max(16, inner - 1)) : []
  const lockedRows = isLocked ? lockedLines.length + 2 : 0
  const chrome = PAD_Y + 6 + lockedRows + pinnedRows + (v.isMenuOpen ? 2 : 0) + (isNarrow ? 1 : 0)
  // An inline pane grows with its tree up to a third of the terminal, then scrolls it:
  // draw for that height, so the pane opens as tall as it may and the footer shows.
  const body = geom.rows
  const room = Math.max(1, body - chrome)
  // Every subskill of a router, folded or not, for the search to reach.
  const subsOf = (group: string) =>
    layoutRows({ library: skills, history: calls, since, sort: v.sort, collapsed: [], expanded: skills.filter(sk => !sk.router).map(sk => sk.name), hidden: hide, baseline: base, tokens: book.skills })
      .filter(r => r.kind === 'sub' && skills.some(sk => sk.name === r.name && sk.router === group))
  // The search row, as the app's Mac search: by name on every tab.
  const find = await read($, search)
  const listed =
    find.isOpen && find.query.trim() !== ''
      ? v.source === 'skills'
        ? searchRows(rows, find.query, group => subsOf(group))
        : rows.filter(r => r.name.toLowerCase().includes(find.query.trim().toLowerCase()))
      : rows
  // A skill row's card opens under it and takes rows of the window.
  const openCard = await read($, card)
  const cardWidth = Math.max(16, inner - 2)
  const agentSkills = await read($, agentSkillsAtom)
  const liveList = await read($, live)
  // A Sessions row: where its tokens went, as the app's SessionPopover; any other source row:
  // its calls, the average per call and the sessions it was used in, as the app's SourcePopover.
  const sourceCardLines = (row: Row): string[][] => {
    const lines: string[][] = []
    if (row.source === 'sessions') {
      const liveRow = liveList.find(l => l.title === row.name)
      lines.push(liveRow ? ['session-actions', liveRow.id] : ['note', `Last active ${ago(row.lastAt, now)}`])
      if (liveRow) {
        lines.push(['note', `Last active ${ago(liveRow.lastCall, now)}`])
        lines.push(['head', 'Context'])
        lines.push(['text', `Each reply re-reads ${countText(liveRow.tokens)}`])
      }
      const spend = sessionSpend(sessionFiles.get(row.name) ?? [], since)
      if (spend.rows.length > 0) {
        lines.push(['head', 'Where the tokens went'])
        for (const r of spend.rows) lines.push(['spend', r.name, r.kind, countText(r.tokens)])
      }
      return lines
    }
    // The app's stats line, word for word.
    const each = row.period > 0 ? Math.round(row.tokens / row.period) : 0
    if (row.source === 'hooks') {
      lines.push(['note', row.period > 0 ? `${row.period} runs · ${durationText(row.tokens)} total · ${durationText(each)} each` : `No runs in this period · ${row.total} in total`])
      return lines
    }
    if (row.lastAt !== undefined) lines.push(['note', `Last used ${ago(row.lastAt, now)}`])
    lines.push([
      'note',
      row.period === 0 ? 'Not used in this period' : row.source === 'memory' ? `In ${row.period} requests · ${countText(each)} each` : `${row.period} calls · ${countText(each)} per call · ${countText(row.tokens)} total`,
    ])
    const used = sourceSessions(sessionFiles, row.source as Kind, row.name, since)
    if (used.length > 0) {
      lines.push(['head', 'Where it was used'])
      for (const r of used) lines.push(['spend', r.name, r.kind, countText(r.tokens)])
    }
    return lines
  }
  const cardOf = (row: Row): { lines: string[][]; path?: string; copy?: string; fav: string } | undefined => {
    if (rowKey(row) !== openCard) return undefined
    if ((row.source ?? 'skills') === 'agents') {
      const def = defs.find(d => d.name === row.name)
      const lines = agentCardLines(def, models[row.name], agentSkills[row.name], cardWidth)
      // Latest first, as the app's: the last run under the actions.
      const run = agentRuns[row.name]
      if (run) {
        const runLines: string[][] = [['head', 'Last run']]
        if (run.task) for (const line of wrapText(run.task, cardWidth).slice(0, 3)) runLines.push(['text', line])
        runLines.push(['note', `${countText(run.tokens)} tokens in ${Math.max(1, Math.round((run.ended - run.started) / 60_000))} min · ended ${ago(run.ended, now)}`])
        runLines.push(['run-session', run.session, run.sessionId])
        lines.splice(1, 0, ...runLines)
      }
      return { lines, ...(def ? { path: def.path } : {}), fav: `agent:${row.name}` }
    }
    if (row.source !== undefined && SOURCE_CARDS.has(row.source)) return { lines: sourceCardLines(row), fav: `${row.source}:${row.name}` }
    if (row.kind === 'group' && v.source !== 'skills') return undefined
    if ((row.source ?? 'skills') !== 'skills') return undefined
    const skill = skills.find(sk => sk.name === row.name)
    if (!skill) return undefined
    // The add field closes the text triggers, or stands where they would.
    const lines = cardLines(skillCard(skill, skills, pro), cardWidth)
    const lastTrigger = lines.map(l => l[0]).lastIndexOf('trigger')
    const slashHead = lines.findIndex(l => l[0] === 'head' && l[1] === 'Slash triggers')
    lines.splice(lastTrigger >= 0 ? lastTrigger + 1 : slashHead >= 0 ? slashHead : lines.length, 0, ['add-trigger'])
    // The command field closes the slash triggers, or ends the card.
    const lastCommand = lines.map(l => l[0]).lastIndexOf('command')
    lines.splice(lastCommand >= 0 ? lastCommand + 1 : lines.length, 0, ['add-command'])
    return { lines, path: skill.path, copy: invocation(skill), fav: skill.name }
  }
  const listRoom = room - (find.isOpen ? 1 : 0)
  scrollMax = Math.max(0, listed.length - 1)
  const top = Math.min(await read($, scroll), scrollMax)
  const shown: Row[] = []
  let used = 0
  for (const row of listed.slice(top)) {
    const extra = cardOf(row)?.lines.length ?? 0
    if (used + 1 > listRoom) break
    shown.push(row)
    used += 1 + extra
  }
  scrollMax = Math.max(0, listed.length - Math.max(1, shown.length))
  drawnKeys = listed.map(rowKey)
  drawnRoom = Math.max(1, shown.length)
  cardKeys = new Set(
    listed.filter(r => ((r.source ?? 'skills') === 'skills' && skills.some(sk => sk.name === r.name)) || r.source === 'agents' || (r.source !== undefined && SOURCE_CARDS.has(r.source))).map(rowKey),
  )
  const chosen = await read($, selected)
  const favs = await read($, favorites)
  const pausedNames = await read($, paused)
  const renamingKey = await read($, renaming)
  // As the app: one count, the period's, right-aligned in a column as wide as
  // the longest number on screen, its K or M in a column of its own after it.
  const counts = shown.filter(r => r.kind !== 'group' && metric(r) > 0).map(r => countParts(metric(r)))
  const unitWidth = counts.some(c => c.unit !== '') ? 1 : 0
  // Every row's bar sits under the limit's bar, as wide as it, and the figures
  // fill the limit pill's width beside it, ending where its label ends.
  const trailing = LIMIT_BAR_WIDTH + 1 + PILL_WIDTH
  const periodTotal = tokensSince(allHours, since)
  // The tab's remainder: every token less what its rows were charged.
  const charged =
    v.source === 'all' ? periodTotal : Object.values(book[v.source]).reduce((n, hours) => n + tokensSince(hours, since), 0)
  const pinnedFixed = v.source === 'all'
  const pinnedShowsTotal = pinnedFixed || v.pinnedShowsTotal
  const pinnedValue = pinnedShowsTotal ? periodTotal : Math.max(0, periodTotal - charged)
  const pinnedTitle = pinnedShowsTotal ? 'Total tokens' : REMAINDER_TITLE[v.source as Kind]
  const pinnedBar = barCells(periodTotal > 0 ? pinnedValue / periodTotal : 0, LIMIT_BAR_WIDTH)
  const sortLabel = SORTS.find(s => s.id === v.sort)?.label ?? '321'
  const isDropdownActive = v.source !== 'all' && v.source !== 'skills'

  const pickSource = (source: View['source']) => () =>
    void update($, scroll, () => 0).then(() => changeView($, cur => ({
      ...cur,
      source,
      isMenuOpen: false,
      ...(source !== 'all' && source !== 'skills' ? { dropdown: source } : {}),
    })))

  return (
    <Box flexDirection="column">
      <Text> </Text>
      {/* No bottom padding: the slack row under it is the footer's, half the room the rest gets. */}
      <Box flexDirection="column" paddingX={PAD_X}>
        {/* The top padding row, where the close mark sits; its blank, keyed element is what
            the opening scroll lands on (the engine scrolls to an element, not a Box). */}
        <Button key="pane-top" plain label=" " onPress={() => undefined} />
        {/* As the app's first row: All / Skills / the dropdown kind, the limit readout on the right. */}
        {/* Wraps when narrow: the limit pill goes whole to a row of its own. */}
        <Box justifyContent="space-between" columnGap={1} flexWrap="wrap">
          <Box flexShrink={0}>
            <Button key="source-all" plain dimColor={v.source !== 'all'} label="All" onPress={pickSource('all')} />
            <Text dimColor> / </Text>
            <Button key="source-skills" plain dimColor={v.source !== 'skills'} label="Skills" onPress={pickSource('skills')} />
            <Text dimColor> / </Text>
            <Button key="source-dropdown" plain dimColor={!isDropdownActive} label={SOURCE_LABEL[v.dropdown]} onPress={pickSource(v.dropdown)} />
            <Button
              key="source-menu"
              plain
              dimColor={!isDropdownActive}
              label={v.isMenuOpen ? ' ▴' : ' ▾'}
              onPress={() => void changeView($, cur => ({ ...cur, isMenuOpen: !cur.isMenuOpen }))}
            />
          </Box>
          {/* As the app: one limit readout, its bar, reset and share; a press switches
            between the 5-hour session and the week. A Button takes a plain label only,
            so the bar beside it is drawn as text and the press lands on the figures. */}
          {limit && (
            <Box gap={1} flexShrink={0}>
              <Text>
                {limitBar.fill !== '' && <Text color={barColor}>{limitBar.fill}</Text>}
                {limitBar.rest !== '' && <Text color={COLOR.track}>{limitBar.rest}</Text>}
              </Text>
              {/* As the app: the share used, outside the pill, in the limit's colour. */}
              <Box width={4} flexShrink={0} justifyContent="flex-end">
                <Text color={barColor}>{`${Math.round(limit.percentUsed)}%`}</Text>
              </Box>
              {/* A pill like the sort toggle's, so it reads as pressable; fixed width, so
                  switching the 5-hour and the week moves nothing. */}
              <Box width={5} flexShrink={0} justifyContent="center" backgroundColor={COLOR.selected}>
                <Button
                  key="limit"
                  plain
                  label={countdown(Date.parse(limit.resetsAt ?? '') - now || 0)}
                  onPress={() => void changeView($, cur => ({ ...cur, limit: cur.limit === 'five_hour' ? 'seven_day' : 'five_hour' }))}
                />
              </Box>
            </Box>
          )}
        </Box>
        {v.isMenuOpen && (
          // The dropdown's kinds, slash-separated like the switcher, flush with All; it wraps
          // by kind at about the switcher's width rather than running the whole row.
          <Box width={MENU_WIDTH} flexWrap="wrap">
            {DROPDOWN.map((kind, i) => (
              <Box key={`menu-item-${kind}`} flexShrink={0}>
                <Button key={`menu-${kind}`} plain dimColor={v.source !== kind} label={SOURCE_LABEL[kind]} onPress={pickSource(kind)} />
                {i < DROPDOWN.length - 1 && <Text dimColor> / </Text>}
              </Box>
            ))}
          </Box>
        )}

        {/* As the app's second row: a segmented period control, the sort pill on the right. */}
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={1} marginTop={1}>
          <Box>
            {PERIODS.map(p => {
              const isOpen = isPeriodOpen(p.id, pro)
              const isSelected = p.id === v.period
              return (
                <Box key={`segment-${p.id}`} paddingX={1} {...(isSelected ? { backgroundColor: COLOR.selected } : {})}>
                  <Button
                    key={`period-${p.id}`}
                    plain
                    label={isOpen ? p.label : `${p.label} · license`}
                    onPress={() => void setPeriod($, p.id)}
                  />
                </Box>
              )
            })}
          </Box>
          <Box paddingX={1} backgroundColor={COLOR.selected}>
            <Button
              key="sort"
              plain
              label={sortLabel}
              onPress={() => void changeView($, cur => ({ ...cur, sort: nextSort(cur.sort), expanded: [] }))}
            />
          </Box>
        </Box>

        {/* The app's activity chart over the period. */}
        <Box flexDirection="column" marginTop={1}>
          <Text wrap="truncate-end">
            {/* Bars edge to edge, every other one a shade darker so each reads apart; an empty
                bar is a dim stub, as the app's; the now bar pulses brighter. */}
            {chart.bars.map((bar, i) => (
              <Text
                key={`b${i}`}
                color={
                  bar.isEmpty
                    ? i % 2
                      ? COLOR.trackAlt
                      : COLOR.track
                    : i === chart.bars.length - 1 && isPulse
                      ? COLOR.pulse
                      : i % 2
                        ? COLOR.greenAlt
                        : COLOR.green
                }
              >
                {bar.text}
              </Text>
            ))}
          </Text>
          {/* As the app: a hovered row lights its own bars, the rest go grey. Each shown row has
              its chart here, revealed over the period's while the row is hovered. */}
          {shown.map((row, r) => (
            <Box key={`overlay-${rowKey(row)}-${row.kind}`} position="absolute" top={0} left={0} display="none" hover={{ scope: `row-${r}`, display: 'flex' }}>
              <Text wrap="truncate-end">
                {overlayBars(chart.counts, chartCounts(rowItems(row), span), Math.max(8, inner)).map((bar, i) => (
                  <Text key={`o${i}`} color={bar.isRow ? COLOR.green : COLOR.track}>
                    {bar.text}
                  </Text>
                ))}
              </Text>
            </Box>
          ))}
        </Box>

        {/* The list keeps the window's height, so the pinned row below sits at the bottom
            edge of the pane even when the list is short. */}
        <Box flexDirection="column" marginTop={1} height={room} overflow="hidden">
          {find.isOpen && (
            // As the app's search row: by name on this tab; ✕ hides it and clears it.
            <Box gap={1}>
              {'Input' in ui ? (
                <ui.Input
                  key="search"
                  placeholder={v.source === 'skills' ? 'Search skills on Mac' : 'Search on Mac'}
                  value={find.query}
                  // The list narrows as the person types, as the app's: Enter has nothing to do.
                  submitLabel=""
                  autoFocus
                  onInput={value => void update($, search, cur => ({ ...cur, query: value }))}
                  onSubmit={value => {
                    void track($, 'search_submit', { store: false })
                    void update($, search, cur => ({ ...cur, query: value }))
                  }}
                />
              ) : (
                <Text dimColor>Search needs a keyboard</Text>
              )}
              <Button key="search-close" plain dimColor label="✕" onPress={() => {
                void track($, 'search_dismiss')
                void setSearch($, { isOpen: false, query: '' })
              }} />
            </Box>
          )}
          {find.isOpen && find.query.trim() !== '' && listed.length === 0 && <Text dimColor>No results</Text>}
          {rows.length === 0 && <Text dimColor>{v.source === 'skills' ? 'No skills found in ~/.claude/skills or ./.claude/skills' : 'Nothing counted yet'}</Text>}
          {shown.map(row => {
            const mark = row.marks[0]
            // When it last ran, or the problem its mark stands for.
            const tip = mark ? mark.reason : ago(row.lastAt, now)
            const bar = barCells(scale > 0 ? metric(row) / scale : 0, LIMIT_BAR_WIDTH)
            const key = rowKey(row)
            // The grey label: the kind in All; an agent's model and effort, as the app's.
            // As the app: the kind on All; on Agents and Sessions an outdated model, nothing for a current one.
            const label =
              v.source === 'all'
                ? row.source
                  ? KIND_LABEL[row.source]
                  : undefined
                : v.source === 'agents'
                  ? outdatedLabel(last[row.name], seenModels)
                  : v.source === 'sessions'
                    ? outdatedLabel(sessionLasts[row.name], seenModels)
                    : undefined
            const opened = cardOf(row)
            const isChosen = key === chosen
            // As the app: a paused skill's name is muted and says so.
            const isPaused = (row.source ?? 'skills') === 'skills' && pausedNames.includes(row.name)
            // Room for the name: the row less its counts, badges and indent.
            const badges =
              (row.kind === 'group' ? `${row.fired}/${row.size}`.length + 1 : 0) +
              (row.isFavorite ? 2 : 0) +
              (label ? label.length + 1 : 0) +
              (mark ? 2 : 0) +
              (row.isHidden ? 7 : 0) +
              (row.isNew ? 6 : 0) +
              (row.isOnStart ? 11 : 0) +
              (isPaused ? 7 : 0)
            const nameRoom = Math.max(6, inner - trailing - badges - (row.kind === 'sub' ? 2 : 0) - 2)
            return (
              <Box key={`entry-${key}-${row.kind}`} flexDirection="column">
                <Box
                  key={`row-${key}-${row.kind}`}
                  hover={{ backgroundColor: COLOR.hover, scope: `row-${shown.indexOf(row)}` }}
                  {...(isChosen ? { backgroundColor: COLOR.hover } : {})}
                >
                  <Box flexGrow={1} flexShrink={1} minWidth={0} gap={1} marginRight={1} paddingLeft={row.kind === 'sub' ? 2 : 0}>
                    {row.kind === 'group' ? (
                      // As the app: a router's name opens its card; the counter and chevron fold it.
                      <Button key={`group-${row.name}`} plain dimColor={isPaused} label={clip(row.name, nameRoom)} onPress={() => void toggleCard($, key)} />
                    ) : cardKeys.has(key) ? (
                      <Button key={`name-${key}`} plain dimColor={isPaused} label={clip(row.name, nameRoom)} onPress={() => void toggleCard($, key)} />
                    ) : (
                      <Text wrap="truncate-end">{row.name}</Text>
                    )}
                    {row.kind === 'group' && (
                      // As the app: the N/M counter expands and collapses too.
                      <Button key={`count-${row.name}`} plain dimColor label={`${row.fired}/${row.size}`} onPress={() => void toggleGroup($, row.name)} />
                    )}
                    {(row.isFavorite || (row.source === 'agents' && favs.includes(`agent:${row.name}`))) && <Text color={COLOR.yellow}>★</Text>}
                    {label && (
                      // The label keeps its width; the name before it is what truncates.
                      <Box flexShrink={0}>
                        <Text dimColor>{label}</Text>
                      </Box>
                    )}
                    {mark && <Text color={mark.level === 'error' ? COLOR.error : COLOR.warn}>{mark.level === 'error' ? '!' : '⚠'}</Text>}
                    {row.isHidden && <Text color={COLOR.warn}>hidden</Text>}
                    {isPaused && <Text key={`paused-${key}`} dimColor>Paused</Text>}
                    {row.isNew && (
                      <Text color={COLOR.onBadge} backgroundColor={COLOR.blue}>
                        {' New '}
                      </Text>
                    )}
                    {row.isOnStart && (
                      <Text color={COLOR.onBadge} backgroundColor={COLOR.purple}>
                        {' On Start '}
                      </Text>
                    )}
                  </Box>
                  {row.kind === 'group' ? (
                    // As the app: a group row carries its chevron, in the K/M column under the
                    // figures' units; in Usage its own tokens stand where a bar would.
                    <Box width={trailing} flexShrink={0} justifyContent="flex-end" paddingRight={1}>
                      {v.sort === 'usage' && (row.ownTokens ?? 0) > 0 && (
                        <Box flexGrow={1} justifyContent="flex-end" paddingRight={1}>
                          <Text color={COLOR.count}>{countText(row.ownTokens ?? 0)}</Text>
                        </Box>
                      )}
                      <Button key={`chevron-${row.name}`} plain dimColor label={row.isCollapsed ? '▾' : '▴'} onPress={() => void toggleGroup($, row.name)} />
                    </Box>
                  ) : (
                    // A row Box, not a fragment: the engine lays a fragment's children out as a column.
                    <Box flexShrink={0}>
                      {/* Painted over the row, never in its flow: a hover must not wrap or move the list. */}
                      <Box
                        position="absolute"
                        top={0}
                        right={trailing}
                        display="none"
                        hover={{ display: 'flex' }}
                        backgroundColor={COLOR.hover}
                        paddingX={1}
                      >
                        <Text dimColor wrap="truncate-start">
                          {tip}
                        </Text>
                      </Box>
                      {/* As the app: a bar only for a row with calls in the period. */}
                      <Box width={LIMIT_BAR_WIDTH + 1} flexShrink={0} paddingRight={1}>
                        {metric(row) > 0 && (
                          <Text wrap="truncate-end">
                            {bar.fill !== '' && <Text color={barColor}>{bar.fill}</Text>}
                            {bar.rest !== '' && <Text color={COLOR.track}>{bar.rest}</Text>}
                          </Text>
                        )}
                      </Box>
                      <Box width={PILL_WIDTH} flexShrink={0} paddingRight={1} justifyContent="flex-end">
                        <Text color={row.lastAt !== undefined && now - row.lastAt < 60_000 && isPulse ? COLOR.pulse : COLOR.count}>{metric(row) > 0 ? (row.source === 'hooks' && v.sort === 'usage' ? durationText(metric(row)) : countParts(metric(row)).num) : ' '}</Text>
                        {unitWidth > 0 && (
                          <Box width={unitWidth} flexShrink={0}>
                            <Text color={COLOR.count}>{metric(row) > 0 && !(row.source === 'hooks' && v.sort === 'usage') ? countParts(metric(row)).unit || ' ' : ' '}</Text>
                          </Box>
                        )}
                      </Box>
                    </Box>
                  )}
                </Box>
                {opened && (
                  // The card, as the app's popover: actions, description, triggers, commands.
                  <Box flexDirection="column" backgroundColor={COLOR.card} paddingX={1}>
                    {opened.lines.map((line, i) => {
                      const [kind, a = '', b = ''] = line
                      if (kind === 'actions')
                        return (
                          <Box key={`card-${i}`} gap={2}>
                            <Button
                              key="card-star"
                              plain
                              label={favs.includes(opened.fav) ? '★ Favorite' : '☆ Favorite'}
                              onPress={() => void toggleFavorite($, opened.fav)}
                            />
                            {opened.path && (
                              <Button
                                key="card-open"
                                plain
                                label="Open"
                                onPress={() => {
                                  void track($, row.source === 'agents' ? 'agent_file_open' : 'skill_file_open')
                                  void openFile($, opened.path as string)
                                }}
                              />
                            )}
                            {opened.copy && (
                              <Button
                                key="card-copy"
                                plain
                                label={`Copy ${opened.copy}`}
                                onPress={press => {
                                  void track($, 'command_copy')
                                  void $.ui.copy({ text: opened.copy as string, surface: press.surface }).then(r => {
                                    if (r.isCopied) $.ui.toast(`skillkeeper · ${opened.copy} copied`)
                                  })
                                }}
                              />
                            )}
                          </Box>
                        )
                      if (kind === 'spend')
                        return (
                          <Box key={`card-${i}`} gap={1} paddingLeft={2}>
                            <Box flexGrow={1} flexShrink={1} minWidth={0} gap={1}>
                              <Text wrap="truncate-end">{a}</Text>
                              {b !== '' && <Text dimColor>{b}</Text>}
                            </Box>
                            <Text dimColor>{line[3] ?? ''}</Text>
                          </Box>
                        )
                      if (kind === 'run-session') {
                        const target = liveList.find(l => l.id === b)
                        return (
                          <Box key={`card-${i}`} gap={2}>
                            <Text dimColor wrap="truncate-end">{`Last session: ${a}`}</Text>
                            {target && <Button key="card-run-session" plain dimColor label="Open session" onPress={() => {
                              void track($, 'agent_run_session_open')
                              void openSession($, target, 'agent_card')
                            }} />}
                          </Box>
                        )
                      }
                      if (kind === 'session-actions') {
                        const target = liveList.find(l => l.id === a)
                        return (
                          <Box key={`card-${i}`} gap={2}>
                            {target && <Button key="card-session-open" plain label="Open" onPress={() => void openSession($, target, 'session_card')} />}
                          </Box>
                        )
                      }
                      if (kind === 'unmatched')
                        return (
                          <Text key={`card-${i}`} color={COLOR.warn}>
                            ⚠ Nothing for Claude Code to match this skill on
                          </Text>
                        )
                      if (kind === 'head')
                        return (
                          <Text key={`card-${i}`} dimColor bold>
                            {a}
                          </Text>
                        )
                      if (kind === 'text') return <Text key={`card-${i}`}>{a}</Text>
                      if (kind === 'add-trigger')
                        return !pro ? (
                          <Text key={`card-${i}`} dimColor>{'  + Add trigger · license'}</Text>
                        ) : 'Input' in ui && opened.path ? (
                          <Box key={`card-${i}`} paddingLeft={2}>
                            <ui.Input key="card-add-trigger" placeholder="+ Add trigger" submitLabel="add" onSubmit={value => void addTrigger($, opened.path as string, value)} />
                          </Box>
                        ) : (
                          <Text key={`card-${i}`}> </Text>
                        )
                      if (kind === 'note')
                        return (
                          <Text key={`card-${i}`} dimColor>
                            {a}
                          </Text>
                        )
                      if (kind === 'add-command')
                        return !pro ? (
                          <Text key={`card-${i}`} dimColor>{'  + Add command · license'}</Text>
                        ) : 'Input' in ui && opened.path ? (
                          <Box key={`card-${i}`} paddingLeft={2}>
                            <ui.Input key="card-add-command" placeholder="+ Add command" submitLabel="add" onSubmit={value => void addCommand($, opened.path as string, opened.fav, value)} />
                          </Box>
                        ) : (
                          <Text key={`card-${i}`}> </Text>
                        )
                      // As the app's popover: a trigger renames in place on a press, ✕ removes it or a command.
                      const editable = pro && opened.path !== undefined && (kind === 'trigger' || kind === 'command')
                      const path = opened.path as string
                      if (editable && kind === 'trigger' && renamingKey === `${path}|${a}` && 'Input' in ui)
                        return (
                          <Box key={`card-${i}`} paddingLeft={2}>
                            <ui.Input
                              key="card-rename-trigger"
                              value={a}
                              submitLabel="rename"
                              autoFocus
                              onSubmit={value => {
                                void update($, renaming, () => null)
                                void editSkill($, path, 'rename_trigger', file => renameTrigger(file, a, value))
                              }}
                            />
                          </Box>
                        )
                      return (
                        <Box key={`card-${i}`} gap={1} paddingLeft={2}>
                          {editable && kind === 'trigger' ? (
                            <Button key={`card-trigger-${a}`} plain label={a} onPress={() => {
                              void track($, 'trigger_edit_start')
                              void update($, renaming, () => `${path}|${a}`)
                            }} />
                          ) : (
                            <Text>{a}</Text>
                          )}
                          {b !== '' && <Text color={COLOR.warn}>{`⚠ also on ${b}`}</Text>}
                          {editable && (
                            <Button
                              key={`card-remove-${kind}-${a}`}
                              plain
                              dimColor
                              label="✕"
                              onPress={() => void editSkill($, path, kind === 'trigger' ? 'remove_trigger' : 'remove_command', file => (kind === 'trigger' ? removeTrigger(file, a) : removeCommand(file, a)))}
                            />
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>

        {/* Pinned above the footer, as the app: in Usage, Total tokens, or a press away the
            tab's remainder; on All an expensive context takes the slot. */}
        {showsContext ? (
          <Box marginTop={1} flexDirection="column">
            {liveRows.map(session => {
              const level = contextLevel(session.tokens, session.window)
              const color = level === 'heavy' ? COLOR.error : COLOR.yellow
              const cells = barCells(session.tokens / session.window, LIMIT_BAR_WIDTH)
              return (
                <Box key={`live-${session.id}`}>
                  <Box flexGrow={1} flexShrink={1} minWidth={0} gap={1}>
                    {/* As the app: a press opens the session in its editor. */}
                    <Button key={`live-open-${session.id}`} plain label={clip(session.title, Math.max(6, inner - trailing - 10))} onPress={() => void openSession($, session)} />
                    <Box flexShrink={0}>
                      <Text dimColor>context</Text>
                    </Box>
                  </Box>
                  <Box width={LIMIT_BAR_WIDTH + 1} flexShrink={0} paddingRight={1}>
                    <Text>
                      {cells.fill !== '' && <Text color={color}>{cells.fill}</Text>}
                      {cells.rest !== '' && <Text color={COLOR.track}>{cells.rest}</Text>}
                    </Text>
                  </Box>
                  <Box width={PILL_WIDTH} flexShrink={0} paddingRight={1} justifyContent="flex-end">
                    <Text color={color}>{countText(session.tokens)}</Text>
                  </Box>
                </Box>
              )
            })}
          </Box>
        ) : showsPinned ? (
          <Box marginTop={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              {pinnedFixed ? (
                <Text wrap="truncate-end">Total tokens</Text>
              ) : (
                <Box gap={1}>
                  <Button
                    key="pinned"
                    plain
                    label={pinnedTitle}
                    onPress={() => void changeView($, cur => ({ ...cur, pinnedShowsTotal: !cur.pinnedShowsTotal }))}
                  />
                  {/* As the app: two small squares say which reading is on, the total or the remainder. */}
                  <Button
                    key="pinned-squares"
                    plain
                    dimColor
                    label={pinnedShowsTotal ? '▪▫' : '▫▪'}
                    onPress={() => void changeView($, cur => ({ ...cur, pinnedShowsTotal: !cur.pinnedShowsTotal }))}
                  />
                </Box>
              )}
            </Box>
            <Box width={LIMIT_BAR_WIDTH + 1} flexShrink={0} paddingRight={1}>
              <Text>
                {pinnedBar.fill !== '' && <Text color={barColor}>{pinnedBar.fill}</Text>}
                {pinnedBar.rest !== '' && <Text color={COLOR.track}>{pinnedBar.rest}</Text>}
              </Text>
            </Box>
            <Box width={PILL_WIDTH} flexShrink={0} paddingRight={1} justifyContent="flex-end">
              <Text color={COLOR.count}>{v.source === 'hooks' ? durationText(pinnedValue) : countText(pinnedValue)}</Text>
            </Box>
          </Box>
        ) : null}
        {isLocked && (
          // The trial is over (here or in the app): the line, the buy link, where the key goes.
          <Box flexDirection="column" marginTop={1}>
            <Text wrap="wrap">{lockedLine(isMac)}</Text>
            <Box gap={1}>
              <Button key="buy" plain label="Buy · $19" onPress={() => void openBuy($, 'panel_locked')} />
              <Text dimColor>·</Text>
              <Button key="locked-settings" plain dimColor label="Have a key? Settings" onPress={() => {
                void track($, 'settings_open', { from: 'locked' })
                void update($, screen, () => 'settings' as const)
              }} />
            </Box>
          </Box>
        )}
        <Box justifyContent="space-between" columnGap={1} paddingRight={1}>
          {/* As the app: ↻ rescans; while the history index runs the footer counts its files. */}
          <Button
            key="rescan"
            plain
            dimColor
            label={isIndexing && idx.total > 0 ? `Indexing ${idx.done} of ${idx.total}…` : `↻ ${clockTime(scanned || now)}`}
            onPress={() => {
              void track($, 'refresh')
              void rescan($, settingsCwd).then(() => indexHistory($))
            }}
          />
          {/* The bell in the middle, digits left of it, as the app's footer (owner, 2026-10-04). */}
          <Button
            key="bell"
            plain
            // Text, not a glyph (owner, 2026-10-04, B): no flat bell exists in the Mac's fonts.
            label={noticeCount > 0 ? `${noticeCount} notifications` : 'Notifications'}
            onPress={() => {
              void track($, 'notifications_flip', { to: 'back', count: noticeCount })
              // The locked screen's reach – its buy click alone has no denominator.
              if (isLocked) void track($, 'notifications_locked_shown', {}, false)
              void update($, screen, () => 'notifications' as const)
            }}
          />
          {/* Settings on the right; the pane's ✕ closes it. */}
          <Button
            key="settings"
            plain
            label="Settings"
            onPress={() => {
              void track($, 'settings_open')
              void update($, screen, () => 'settings' as const)
            }}
          />
        </Box>
      </Box>
      <Text> </Text>
    </Box>
  )
}

export const register: Register = (on, options) => {
  let cwd = '.'
  const licenseKey = typeof options.licenseKey === 'string' ? options.licenseKey : ''
  analyticsOn = options.usageAnalytics !== 'off'
  extraFolders = (typeof options.extraSkillFolders === 'string' ? options.extraSkillFolders : '')
    .split(',')
    .map(f => f.trim().replace(/\/+$/, ''))
    .filter(Boolean)

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    settingsCwd = e.cwd
    await $.command.register({
      name: 'skillkeeper',
      description: 'Which skills fire, which never do, which Claude cannot see',
      immediate: true,
    })

    // A hot reload fires session.start again: keep the session's own start.
    if ((await read($, sessionStart)) === 0) {
      const usage = await $.session.usage().catch(() => undefined)
      const startedAt = usage?.startedAt ?? (await $.clock.now())
      await update($, sessionStart, () => startedAt)
    }
    await load($)
    await rescan($, cwd)
    // A headless run (`claude -p`, a script, a child process) gets the command and the
    // library, nothing that reads history, polls limits or keeps timers.
    isHeadless = !e.isInteractive
    if (isHeadless) return next(e)
    surfaceName = (await $.session.surface().catch(() => null)) ?? 'terminal'
    void track($, 'app_launched', {}, false)
    await scanLive($)
    // Limits fresh from the start: poll at start and after a turn once 5 minutes pass.
    void pollUsage($)
    await checkLicense($, typedKey || licenseKey)
    await loadTrial($)
    $.clock.after(1000, () => void indexHistory($))
    // The now bar pulses while the pane is on screen, as the app's breathing glow.
    $.clock.every(1500, () => {
      void $.clock.now().then(now => {
        if (now - lastPaneDrawn < 5000) void update($, pulse, lit => !lit)
      })
    })
    // Live sessions refresh every minute while the pane is on screen.
    $.clock.every(60_000, () => {
      void $.clock.now().then(now => {
        if (now - lastPaneDrawn < 2 * 60_000) void scanLive($)
      })
    })
    // While the pane is on screen, the limits refresh every 5 minutes, as the app's.
    $.clock.every(5 * 60_000, () => {
      void $.clock.now().then(now => {
        if (now - lastPaneDrawn < 6 * 60_000) void pollUsage($)
      })
    })

    return next(e)
  })

  // A run is the model's Skill call, as the app counts them: a typed `/name` is a command,
  // and a skill preloaded into a subagent is not run (`skill.prompt` fires for all three).
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const name = bareName(e.skill)
    await recordCall($, name)
    // The main loop's turn holds it for its tokens; a subagent's calls are its own.
    if (!e.agentId) turn.skills = [name]
    // What the call named: the read that loads it is not a run of its own.
    lastSkill.set(e.agentId ?? '', invokedName(e.skill))
    return ran
  })

  on('prompt.submit', ($, e, next) => {
    lastSkill.clear()
    return next(e)
  })

  // A skill read from its file runs too, and holds the turn's tokens, as the app counts it.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    const loop = e.agentId ?? ''
    const run = skillRead(e.file_path, lastSkill.get(loop), true)
    if (!run || ran.deny !== undefined || ran.isError === true) return ran
    const skill = (await read($, library)).find(s => s.folder === run.name && !s.router === run.isTop)
    await recordCall($, skill?.name ?? run.name)
    if (!e.agentId) turn.skills = [skill?.name ?? run.name]
    if (run.isTop) lastSkill.set(loop, run.name)
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const call = classifyTool(e.tool, e as { subagent_type?: unknown })
    if (call && call.kind !== 'skills') {
      await recordActivity($, call.kind, call.name)
      // The main turn's tokens go to the main loop's calls; a subagent's are charged by its transcript.
      if (!e.agentId) turn.tools.push({ kind: call.kind, name: call.name })
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    // Every turn, a subagent's too, counts toward the total.
    if (e.usage) {
      const u = e.usage
      const now = await $.clock.now()
      const all = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const totals = addHours(await read($, totalTokens), [{ at: now, tokens: all }], now)
      await update($, totalTokens, () => totals)
      await $.store.set('totalTokens', totals)
    }
    // A subagent's turn: its tokens to its agent type, as the app reads its transcript.
    if (e.agentId && e.usage) {
      const u = e.usage
      const total = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const info = (await $.agent.list().catch(() => [])).find(a => a.id === e.agentId)
      if (info) {
        const now = await $.clock.now()
        const agent = info.type.includes(':') ? bareName(info.type) : info.type
        const book = addTokens(await read($, tokens), [{ kind: 'agents', name: agent, at: now, tokens: total }], now)
        await update($, tokens, () => book)
        await $.store.set('tokens', book)
        await update($, agentModelsAtom, cur => ({ ...cur, [agent]: { ...(cur[agent] ?? {}), [`${u.model}|`]: (cur[agent]?.[`${u.model}|`] ?? 0) + total } }))
        // A live call has no effort: the indexed one stays while the model is the same.
        await update($, agentLast, cur => (cur[agent]?.startsWith(`${u.model}|`) ? cur : { ...cur, [agent]: `${u.model}|` }))
      }
    }
    // The main thread's turn: its tokens to what it ran, as the app charges a call.
    if (!e.agentId && e.usage) {
      const u = e.usage
      if ((await $.clock.now()) - lastPolled > 5 * 60_000) void pollUsage($)
      const total = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const now = await $.clock.now()
      const book = addTokens(await read($, tokens), chargeCall(total, now, turn), now)
      await update($, tokens, () => book)
      await $.store.set('tokens', book)
      turn = { skills: [], tools: [] }
    }
    await refreshHidden($)
    return next(e)
  })

  // Above the prompt, only when this chat should compact (owner, 2026-10-04, option A):
  // the moment it matters, without opening the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Not while a turn runs: the suggestion is for the moment between turns.
    if (isHeadless || e.props.hasSurvey || e.props.isWorking) return next(e)
    // After the trial the compact line is paid, as every notification.
    if (await isNoticesLocked($)) return next(e)
    const hiddenIds = await read($, dismissed)
    const notice = (await read($, noticesOff)).includes('compact') ? undefined : sessionNotices(await read($, context)).find(n => !hiddenIds.includes(n.id))
    if (!notice) return next(e)
    // The band's own impression, once per occurrence: how often the suggestion reaches the prompt.
    if (!shownBands.has(notice.id)) {
      shownBands.add(notice.id)
      void track($, 'compact_band_shown', { group: notice.group }, false)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Text color={notice.color}>■</Text>
        <Text>{`${notice.title} – ${notice.body?.split('.')[0]?.replace(/^Each reply (now )?/, 'each reply ') ?? ''}`}</Text>
        <Button key="band-compact" label="Compact now" onPress={() => void compactNow($, 'band')} />
        <Button key="band-hide" plain dimColor label="✕" onPress={() => {
          void track($, 'notification_dismiss', { kind: notice.kind, via: 'band' })
          void update($, dismissed, cur => [...cur, notice.id])
        }} />
      </Box>
    )
  })

  on('command.run', async ($, e, next) => {
    const name = `/${e.command}`
    if (!builtins.has(name)) {
      await recordActivity($, 'commands', name)
      turn.command = name
    }
    if (e.command !== PANE) return next(e)
    // Opening the panel: the app's click on its menu bar icon.
    void track($, 'menu_bar_icon_clicked', {}, false)
    if (!isHeadless) await countTrialDay($)

    // After a /clear no session.start comes: bring the stored data back first.
    if ((await read($, library)).length === 0) {
      await load($)
      await rescan($, cwd)
    }
    void refreshHidden($).then(() => pollUsage($))
    void scanLive($)
    const idx = await read($, indexing)
    const indexed = (await $.clock.now()) - idx.at > 10 * 60_000 ? indexHistory($) : Promise.resolve()
    // Inline, ask for room for the whole list plus header and footer.
    const rows = Math.min(PANE_MAX_ROWS, (await read($, library)).length + 7 + 2 * PAD_Y)
    // Opening shows the list, wherever the pane was left.
    await update($, screen, () => 'list' as const)
    // Start below the top slack row, where the header begins: once the pane has drawn.
    needsTop = true
    // Only the terminal shows a pane; elsewhere (the editor extension, desktop, mobile)
    // answer in the chat, and the panel draws in place of the answer.
    const surface = await $.session.surface().catch(() => null)
    if (surface !== 'terminal') {
      // Give the index a moment: after a first read of the history, it only reads what is new.
      await Promise.race([indexed, new Promise<void>(r => $.clock.after(5000, r))])
      return { text: await chatReport($) }
    }
    const placed = await $.ui.open({ id: PANE, title: 'SkillKeeper', focus: true, closeOnEscape: true, rows })
    if (!placed.isPlaced) return { text: await chatReport($) }
    return {}
  })

  // The list scrolls, not the pane: the move goes to the list's own window and the
  // engine's stays at the top, so the header above it never leaves.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    const top = Math.min(await read($, scroll), scrollMax)
    // The wheel (it carries a pointer) and page keys scroll; past the top, as the app's
    // pull, it opens the search row.
    if (e.pointer || Math.abs(e.by) > 1) {
      if (e.by < 0 && top === 0) {
        const open = await read($, search)
        if (!open.isOpen) await setSearch($, { isOpen: true, query: '' })
      }
      await update($, scroll, () => Math.max(0, Math.min(scrollMax, top + e.by)))
      return next({ ...e, offset: SLACK })
    }
    // Arrow keys walk the rows, as the app's: the selected row's card follows.
    const at = drawnKeys.indexOf((await read($, selected)) ?? '')
    if (e.by < 0 && at <= 0 && top === 0) {
      await update($, selected, () => null)
      await update($, card, () => null)
      if (!(await read($, search)).isOpen) await setSearch($, { isOpen: true, query: '' })
      return next({ ...e, offset: SLACK })
    }
    const to = Math.max(0, Math.min(drawnKeys.length - 1, at < 0 ? (e.by > 0 ? 0 : drawnKeys.length - 1) : at + Math.sign(e.by)))
    const key = drawnKeys[to]
    if (key !== undefined) {
      await update($, selected, () => key)
      await update($, card, () => (cardKeys.has(key) ? key : null))
      // Keep it in view: the list moves only when the row would leave the window.
      if (to < top) await update($, scroll, () => to)
      else if (to >= top + drawnRoom) await update($, scroll, () => to - drawnRoom + 1)
    }
    return next({ ...e, offset: SLACK })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    drawPanel($, e, {
      columns: e.props.bodyColumns,
      // An inline pane grows with its tree up to a third of the terminal, then scrolls it.
      rows: Math.max(e.props.scroll.bodyRows, Math.floor((e.viewport?.rows ?? 24) / 3) - 2),
      inline: false,
    }),
  )

  // Where the surface shows no pane, /skillkeeper answers in the chat and the panel
  // draws in place of that answer.
  on('ui.render', { component: 'CommandOutput', props: { command: PANE } }, async ($, e) =>
    drawPanel($, e, { columns: Math.max(40, (e.viewport?.columns ?? 80) - 2), rows: INLINE_ROWS, inline: true }),
  )
}
