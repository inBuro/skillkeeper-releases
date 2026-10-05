export type Skill = {
  /** The frontmatter `name`, or the folder's when it has none. */
  name: string
  /** The folder the SKILL.md sits in. */
  folder: string
  /** The router's name, for a skill under `<router>/subskills/`. */
  router?: string
  description: string
  whenToUse: string
  path: string
  /** `disable-model-invocation: true`: run by the person only, never listed for the model. */
  isUserOnly?: boolean
}

/** Invocation times in ms per skill name, newest last. */
export type History = Record<string, number[]>

export type Period = 'fiveHours' | 'day' | 'week' | 'month'

export type SortOrder = 'count' | 'usage' | 'abc' | 'last'

/** What the list counts, as the app's switcher: one kind, or All of them. */
export type Kind = 'skills' | 'agents' | 'tools' | 'mcp' | 'commands' | 'sessions' | 'memory' | 'hooks' | 'plugins'
export type Source = 'all' | Kind
/** The kinds the switcher's third slot drops down over. */
export type DropdownKind = Exclude<Kind, 'skills'>

/** Calls per name for every kind but skills, which keep `history`. */
export type Activity = Record<DropdownKind, History>

/** Tokens per name in hour buckets: the hour's start (ms / 3,600,000) to its tokens. */
export type TokenHours = Record<string, number>
/** Tokens each kind's names were charged, as the app splits a model call's usage; for hooks, milliseconds. */
export type Tokens = Record<Kind, Record<string, TokenHours>>

/** The live context window: tokens the last response read, of the model's window. */
export type Context = { tokens?: number; window: number; percent?: number }

export type LiveSession = { id: string; title: string; tokens: number; window: number; lastCall: number; entrypoint: string }

/** One subagent run: from its transcript and the meta file beside it. */
export type AgentRun = { task?: string; tokens: number; started: number; ended: number; session: string; sessionId: string }

export type AgentDef = { name: string; description: string; path: string; skills: string[]; model?: string }

export type LimitWindow = 'five_hour' | 'seven_day'

/** One rate-limit window as `$.session.usage()` reads it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type View = {
  period: Period
  sort: SortOrder
  collapsed: string[]
  source: Source
  /** The dropdown kind the third slot shows: the last one picked. */
  dropdown: DropdownKind
  isMenuOpen: boolean
  limit: LimitWindow
  /** Routers opened in 321, Usage and Last, where every router starts collapsed: kept for the session only. */
  expanded: string[]
  /** The pinned row reads Total tokens (true) or the tab's remainder. */
  pinnedShowsTotal: boolean
}

/** What the context breakdown says about the skill listing. */
export type Hidden = { total: number; included: number; names: string[] }

export type License = { isPro: boolean; checkedAt: number | null }

/** The shared trial as the panel reads it: open or over, and the active days counted. */
export type TrialView = { isLoaded: boolean; isActive: boolean; days: number }

/** One reading of a rate-limit window, for the limit forecast (`hooks/notify.ts`). */
export type LimitSample = { kind: string; at: number; used: number; resetsAt: number }

declare module 'claude-code' {
  interface PluginState {
    skillkeeper: {
      library: Skill[]
      history: History
      activity: Activity
      limits: Limit[]
      context: Context | null
      tokens: Tokens
      /** Every token in an hour, whatever it went to: the Total tokens row. */
      totalTokens: TokenHours
      favorites: string[]
      /** Which screen the pane shows: the list, the settings (as the app's Settings window), or the notifications (the app's bell layer). */
      screen: 'list' | 'settings' | 'notifications'
      /** Notification ids hidden this session (× or Clear all). */
      dismissed: string[]
      /** Rate-limit readings of the current windows, for the forecast. */
      limitSamples: LimitSample[]
      /** The settings screen's last license message, for the person to read. */
      licenseNote: string
      /** Skill folders added on the settings screen, as the app's + Add folder. */
      folders: string[]
      /** Sessions with a warm cache, as the app's context block: their context right now. */
      live: LiveSession[]
      /** The now bar's pulse: on or off, flipped on a timer while the pane shows. */
      pulse: boolean
      /** Each agent's models: `model|effort` to tokens, from its runs. */
      agentModels: Record<string, Record<string, number>>
      /** Each agent's latest model, `model|effort`: what its label names. */
      agentLast: Record<string, string>
      /** Skills paused in Claude Code's settings (`skillOverrides: "off"`), as the app reads them. */
      paused: string[]
      /** Notification kinds turned off in Settings. */
      noticesOff: string[]
      /** The trigger being renamed in a card: `path|phrase`. */
      renaming: string | null
      /** The review in Settings, as the app's two-thumb popover. */
      review: 'closed' | 'ask' | 'thanks' | 'wrong'
      /** Mute keys (one agent) muted until a time. */
      muted: Record<string, number>
      /** Each agent's runs in the last 30 days, for the record check. */
      agentRunTokens: Record<string, Array<{ tokens: number; started: number; ended: number }>>
      /** Each agent's latest run, as the app's AgentPopover shows it: its task, tokens, how long, where. */
      agentRuns: Record<string, AgentRun>
      /** Each session's latest model of its own (not its subagents'), `model|effort`. */
      sessionLast: Record<string, string>
      /** Skills each agent ran, with the tokens of its calls under them. */
      agentSkills: Record<string, Record<string, number>>
      /** Agent definitions from ~/.claude/agents and the project's. */
      agentDefs: AgentDef[]
      /** Where the history index stands: files read of files to read, and when it last finished. */
      indexing: { done: number; total: number; at: number }
      /** The row whose card is open (`<kind>:<name>`), as the app's popover. */
      card: string | null
      /** The row the arrow keys have selected, by the same key. */
      selected: string | null
      /** The search row: open, and what it holds. */
      search: { isOpen: boolean; query: string }
      /** Skills a SessionStart hook loads. */
      onStart: string[]
      sessionStart: number
      hidden: Hidden | null
      baseline: string[] | null
      view: View
      scannedAt: number
      license: License
      /** The trial shared with the app (~/.claude/skillkeeper/trial.json). */
      trial: TrialView
      /** The first list row the pane shows: the list scrolls under a fixed header. */
      scroll: number
    }
  }
}
