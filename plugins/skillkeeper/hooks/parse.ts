// Pure parsing: SKILL.md frontmatter, trigger/command phrases, transcript lines.
// Nothing here touches `$`.

export type Frontmatter = {
  name?: string
  description?: string
  when_to_use?: string
  'disable-model-invocation'?: string
}

const KEYS = ['name', 'description', 'when_to_use', 'disable-model-invocation'] as const

/** Reads `name`, `description`, `when_to_use` and `disable-model-invocation` from a SKILL.md's frontmatter. */
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  const body = lines.slice(1, end < 0 ? lines.length : end)
  const out: Frontmatter = {}

  for (let i = 0; i < body.length; i++) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(body[i] ?? '')
    if (!match) continue
    const key = match[1] as string
    const raw = (match[2] ?? '').trim()

    // Continuation lines: indented or blank, until the next top-level key.
    const rest: string[] = []
    let j = i + 1
    while (j < body.length) {
      const line = body[j] ?? ''
      if (line.trim() !== '' && !/^\s/.test(line)) break
      rest.push(line)
      j++
    }
    i = j - 1

    if (!(KEYS as readonly string[]).includes(key)) continue
    out[key as (typeof KEYS)[number]] = scalar(raw, rest)
  }
  return out
}

function scalar(raw: string, rest: string[]): string {
  const block = /^([>|])([+-]?)\d*\s*(#.*)?$/.exec(raw)
  if (block) {
    while (rest.length > 0 && (rest[rest.length - 1] ?? '').trim() === '') rest.pop()
    const indent = Math.min(
      ...rest.filter(l => l.trim() !== '').map(l => (/^\s*/.exec(l)?.[0].length ?? 0)),
    )
    const lines = rest.map(l => l.slice(Number.isFinite(indent) ? indent : 0))
    if (block[1] === '|') return lines.join('\n')
    // Folded: single newlines become spaces, blank lines stay newlines.
    let text = ''
    for (const line of lines) {
      if (line === '') text += '\n'
      else text += text === '' || text.endsWith('\n') ? line : ` ${line}`
    }
    return text
  }

  const more = rest.map(l => l.trim()).filter(Boolean)
  if (raw.startsWith('"')) {
    const joined = [raw, ...more].join(' ')
    const close = findClosingQuote(joined)
    const inner = joined.slice(1, close < 0 ? undefined : close)
    try {
      return JSON.parse(`"${inner.replace(/\t/g, '\\t')}"`) as string
    } catch {
      return inner.replace(/\\"/g, '"')
    }
  }
  if (raw.startsWith("'")) {
    const joined = [raw, ...more].join(' ')
    let text = ''
    for (let i = 1; i < joined.length; i++) {
      if (joined[i] !== "'") text += joined[i]
      else if (joined[i + 1] === "'") {
        text += "'"
        i++
      } else break
    }
    return text
  }
  return [raw.replace(/\s+#.*$/, ''), ...more].join(' ').trim()
}

function findClosingQuote(text: string): number {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '"') return i
  }
  return -1
}

export type Phrases = { triggers: string[]; commands: string[] }

// Longest first, so `Триггеры (RU):` wins over `Триггеры:`.
const MARKERS: ReadonlyArray<{ text: string; kind: keyof Phrases }> = [
  { text: 'Триггерные фразы', kind: 'triggers' },
  { text: 'Триггеры (RU):', kind: 'triggers' },
  { text: 'Триггеры:', kind: 'triggers' },
  { text: 'Triggers:', kind: 'triggers' },
  { text: 'Команды:', kind: 'commands' },
  { text: 'Commands:', kind: 'commands' },
]

const QUOTES = /[«»"“”„]/g

/** Trigger phrases and slash commands a description lists after its markers. */
export function parsePhrases(description: string): Phrases {
  return phraseSections(description).phrases
}

/** The description without its marker sections: the prose the app's popover shows. */
export function stripPhrases(description: string): string {
  return phraseSections(description).prose
}

function phraseSections(description: string): { phrases: Phrases; prose: string } {
  const hits: Array<{ at: number; end: number; kind: keyof Phrases }> = []
  for (const marker of MARKERS) {
    let from = 0
    for (;;) {
      const at = description.indexOf(marker.text, from)
      if (at < 0) break
      from = at + marker.text.length
      if (hits.some(h => at >= h.at && at < h.end)) continue
      let end = at + marker.text.length
      // `Триггерные фразы:` or `Триггерные фразы (RU):`: swallow up to the colon.
      if (!marker.text.endsWith(':')) {
        const tail = /^[^:.\n]{0,24}:/.exec(description.slice(end))
        if (tail) end += tail[0].length
      }
      hits.push({ at, end, kind: marker.kind })
    }
  }
  hits.sort((a, b) => a.at - b.at)

  const out: Phrases = { triggers: [], commands: [] }
  const cuts: Array<[number, number]> = []
  hits.forEach((hit, index) => {
    const next = hits[index + 1]?.at ?? description.length
    let segment = description.slice(hit.end, next)
    const stop = /\.(\s|$)/.exec(segment)
    if (stop) segment = segment.slice(0, stop.index)
    cuts.push([hit.at, hit.end + segment.length + (stop ? 1 : 0)])
    for (const part of segment.split(',')) {
      const phrase = part.replace(QUOTES, '').trim().replace(/[.;]+$/, '').trim()
      if (phrase !== '') out[hit.kind].push(phrase)
    }
  })
  let prose = ''
  let from = 0
  for (const [a, b] of cuts) {
    prose += description.slice(from, a)
    from = b
  }
  prose += description.slice(from)
  return { phrases: out, prose: prose.replace(/\s+/g, ' ').trim() }
}

/** The skill name a `Skill` call or `skill.prompt` names: after the last `:`. */
export function bareName(skill: string): string {
  const cut = skill.lastIndexOf(':')
  return cut < 0 ? skill : skill.slice(cut + 1)
}

/** What a `Skill` call invoked, as the app keeps it for the reads after it: the router of `router:sub`, else the name. */
export function invokedName(skill: string): string {
  const cut = skill.indexOf(':')
  return cut < 0 ? skill : skill.slice(0, cut)
}

/** `<router>` and `<sub>` from a path ending `<router>/subskills/<sub>/SKILL.md`. */
export function subskillOfPath(path: string): { router: string; sub: string } | undefined {
  const match = /([^/\\]+)[/\\]subskills[/\\]([^/\\]+)[/\\]SKILL\.md$/.exec(path)
  return match ? { router: match[1] as string, sub: match[2] as string } : undefined
}

export type Invocation = { name: string; at: number }

/**
 * How many transcript lines a `Read` of a SKILL.md may trail the `Skill` call
 * that loaded it by and still be that same run, as the app bounds it.
 */
export const ROUTER_READ_LINE_GAP = 100

/** `<name>` from a path ending `skills/<name>/SKILL.md`: a top-level skill's own file. */
export function topSkillOfPath(path: string): string | undefined {
  return /[/\\]skills[/\\]([^/\\]+)[/\\]SKILL\.md$/.exec(path)?.[1]
}

/**
 * The skill a `Read` of a SKILL.md runs, as the app counts it: every read of a
 * skill's or a subskill's file is a run, but for the read that loads what the
 * `Skill` call just before it named. `last` is that call's name (the router's,
 * for `router:sub`), the app's `lastRouterSkill`; `isNear`, the read within
 * `ROUTER_READ_LINE_GAP` lines of it. A top-level read becomes the new `last`.
 */
export function skillRead(path: string, last: string | undefined, isNear: boolean): { name: string; isTop: boolean } | undefined {
  const hit = subskillOfPath(path)
  if (hit) return isNear && hit.router !== last && hit.sub === last ? undefined : { name: hit.sub, isTop: false }
  const top = topSkillOfPath(path)
  return top === undefined || (isNear && top === last) ? undefined : { name: top, isTop: true }
}

/**
 * The skill invocations one transcript records: each `Skill` tool_use, and
 * each `Read` of a SKILL.md that `skillRead` counts as a run.
 */
export function parseTranscript(text: string, since: number): Invocation[] {
  return parseActivity(text, since)
    .filter(a => a.kind === 'skills')
    .map(({ name, at }) => ({ name, at }))
}

export type Kind = 'skills' | 'agents' | 'tools' | 'mcp' | 'commands' | 'sessions' | 'memory' | 'hooks' | 'plugins'
export type Activity = { kind: Kind; name: string; at: number }

/** Claude Code's own commands, left out of Commands, as the app keeps them. */
export const BUILTIN_COMMANDS: ReadonlySet<string> = new Set([
  '/add-dir', '/agents', '/bashes', '/btw', '/bug', '/clear', '/color', '/compact', '/config', '/context',
  '/cost', '/doctor', '/effort', '/exit', '/export', '/fast', '/feedback', '/fork', '/help', '/hooks',
  '/ide', '/init', '/install-github-app', '/keybindings', '/login', '/logout', '/mcp', '/memory',
  '/migrate-installer', '/model', '/output-style', '/permissions', '/plan', '/plugin', '/plugins',
  '/pr-comments', '/privacy-settings', '/release-notes', '/reload-plugins', '/remote-control',
  '/rename', '/resume', '/rewind', '/sandbox', '/status', '/statusline', '/tasks', '/terminal-setup',
  '/theme', '/todos', '/upgrade', '/usage', '/vim', '/artifacts', '/workflows', '/focus', '/skills',
])

/**
 * The app's MCP row name: `mcp__claude_ai_Figma__x` → `Figma`,
 * `mcp__plugin_paper-desktop_paper__x` → `paper`, `mcp__posthog__exec` → `posthog`.
 */
export function mcpServer(tool: string): string {
  const parts = tool.slice('mcp__'.length).split('__')
  let server = parts[0] ?? ''
  if (server === '') return tool
  if (server.startsWith('claude_ai_')) server = server.slice('claude_ai_'.length)
  if (server.startsWith('plugin_')) server = server.split('_').pop() ?? server
  return server.replace(/_/g, ' ')
}

/** Where one tool call lands: an agent, an MCP server or a plain tool; Skill is counted by skill.prompt. */
export function classifyTool(tool: string, input: { subagent_type?: unknown }): { kind: Kind; name: string } | undefined {
  if (tool === 'Skill') return undefined
  if (tool === 'Agent' || tool === 'Task') {
    const type = typeof input.subagent_type === 'string' && input.subagent_type !== '' ? input.subagent_type : 'general-purpose'
    return { kind: 'agents', name: type }
  }
  if (tool.startsWith('mcp__')) return { kind: 'mcp', name: mcpServer(tool) }
  return { kind: 'tools', name: tool }
}

/** `/brief` from `<command-name>/brief</command-name>`. */
export function commandName(content: string): string | undefined {
  const match = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(content)
  if (!match || !match[1]) return undefined
  return match[1].startsWith('/') ? match[1] : `/${match[1]}`
}

/**
 * Everything one transcript records since `since`: skills (with the router
 * rule of `parseTranscript`), agents, tools, MCP servers and typed commands.
 */
export function parseActivity(text: string, since: number): Activity[] {
  const out: Activity[] = []
  let lastRouter: string | undefined
  let lastRouterLine = -Infinity
  const lines = text.split('\n')

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string
    const head = line.slice(0, 600)
    const isCommand = head.includes('<command-name>') && head.includes('"type":"user"')
    if (!isCommand && !line.includes('"tool_use"')) continue

    let row: { timestamp?: string; type?: string; message?: { content?: unknown } }
    try {
      row = JSON.parse(line) as typeof row
    } catch {
      continue
    }
    const at = Date.parse(row.timestamp ?? '')
    const isInWindow = Number.isFinite(at) && at >= since
    const content: unknown = row.message?.content

    if (isCommand) {
      if (row.type === 'user' && typeof content === 'string' && content.startsWith('<command-')) {
        const name = commandName(content)
        if (name && !BUILTIN_COMMANDS.has(name) && isInWindow) out.push({ kind: 'commands', name, at })
      }
      continue
    }
    if (!Array.isArray(content)) continue

    for (const block of content as Array<{ type?: string; name?: unknown; input?: unknown } | null>) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue
      const input = (block.input ?? {}) as { skill?: unknown; file_path?: unknown; subagent_type?: unknown }
      if (block.name === 'Skill' && typeof input.skill === 'string') {
        const name = bareName(input.skill)
        if (isInWindow) out.push({ kind: 'skills', name, at })
        lastRouter = invokedName(input.skill)
        lastRouterLine = index
        continue
      }
      if (block.name === 'Read' && typeof input.file_path === 'string') {
        const run = skillRead(input.file_path, lastRouter, index - lastRouterLine <= ROUTER_READ_LINE_GAP)
        if (run && isInWindow) out.push({ kind: 'skills', name: run.name, at })
        if (run?.isTop) {
          lastRouter = run.name
          lastRouterLine = index
        }
      }
      const tool = classifyTool(block.name, input)
      if (tool && isInWindow) out.push({ ...tool, at })
    }
  }
  return out
}

export type Charge = { kind: Kind; name: string; at: number; tokens: number }

/**
 * Token charges from one transcript since `since`, as the app makes them: each
 * model call (one message id, its usage counted once) is charged whole to the
 * turn's skill and command, and evenly to the tools whose results it read,
 * the calls of the message before it.
 */
export function parseTokens(text: string, since: number): { charges: Charge[]; totals: Array<{ at: number; tokens: number }> } {
  const out: Charge[] = []
  const totals: Array<{ at: number; tokens: number }> = []
  let skill: string | undefined
  let command: string | undefined
  let pending: Array<{ kind: Kind; name: string }> = []
  let lastId: string | undefined

  for (const line of text.split('\n')) {
    const isUser = line.includes('"type":"user"')
    if (!isUser && !line.includes('"usage"')) continue
    let row: { type?: string; isMeta?: boolean; timestamp?: string; message?: { id?: string; content?: unknown; usage?: Record<string, unknown> } }
    try {
      row = JSON.parse(line) as typeof row
    } catch {
      continue
    }
    const content = row.message?.content

    if (row.type === 'user') {
      // A prompt (or a typed command) starts a turn; a tool result does not.
      if (typeof content === 'string' && !row.isMeta) {
        skill = undefined
        pending = []
        const name = content.startsWith('<command-') ? commandName(content) : undefined
        command = name && !BUILTIN_COMMANDS.has(name) ? name : undefined
      }
      continue
    }
    if (row.type !== 'assistant' || !row.message) continue

    const id = row.message.id
    if (id !== undefined && id !== lastId) {
      lastId = id
      const usage = row.message.usage ?? {}
      const num = (k: string) => (typeof usage[k] === 'number' ? (usage[k] as number) : 0)
      const tokens = num('input_tokens') + num('output_tokens') + num('cache_creation_input_tokens') + num('cache_read_input_tokens')
      const at = Date.parse(row.timestamp ?? '')
      if (tokens > 0 && Number.isFinite(at) && at >= since) {
        totals.push({ at, tokens })
        if (skill) out.push({ kind: 'skills', name: skill, at, tokens })
        if (command) out.push({ kind: 'commands', name: command, at, tokens })
        const share = pending.length > 0 ? Math.round(tokens / pending.length) : 0
        for (const tool of pending) out.push({ ...tool, at, tokens: share })
      }
      pending = []
    }

    if (!Array.isArray(content)) continue
    for (const block of content as Array<{ type?: string; name?: unknown; input?: unknown } | null>) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue
      const input = (block.input ?? {}) as { skill?: unknown; subagent_type?: unknown }
      if (block.name === 'Skill' && typeof input.skill === 'string') skill = bareName(input.skill)
      const tool = classifyTool(block.name, input)
      if (tool) pending.push(tool)
    }
  }
  return { charges: out, totals }
}

export type FileKind = Kind
export type FileCall = { kind: FileKind; name: string; at: number }
export type FileCharge = { kind: FileKind; name: string; at: number; tokens: number }
export type FileModel = { agent?: string; model: string; effort: string; tokens: number; at: number }

/** One transcript, read once for every tab, as the app's scanner reads it. */
export type FileIndex = {
  calls: FileCall[]
  /** Tokens per row; for hooks, milliseconds. */
  charges: FileCharge[]
  /** Every model call's tokens: the Total row. */
  totals: Array<{ at: number; tokens: number }>
  models: FileModel[]
  /** Skills a subagent ran, with the tokens of its calls under them. */
  agentSkills: Array<{ agent: string; skill: string; tokens: number }>
}

/**
 * Where a transcript's reading stopped, so the next read goes on from there:
 * the turn, its skill and command, the calls waiting for the next model call.
 * A skill or command holds for the turn (`promptId`) it ran in, as the app's.
 */
export type FileCarry = {
  prompt?: string
  skill?: string
  skillPlugin?: string
  skillPrompt?: string
  command?: string
  commandPrompt?: string
  pending: Array<{ kind: Kind; name: string; plugin?: string }>
  pendingPrompt?: string
  memory: Array<{ name: string; tokens: number }>
  lastId?: string
  lastRouter?: string
  lastRouterLine: number
  line: number
}

export const NEW_CARRY: FileCarry = { pending: [], memory: [], lastRouterLine: -Infinity, line: 0 }

export type FileContext = {
  since: number
  /** The session row this file counts toward: its title, else `Session <id>`. */
  session: string
  /** The subagent type, for a subagent's own transcript. */
  agent?: string
  isRouter: (name: string) => boolean
}

/** A transcript's title, as Claude Code names the session: `/rename`, else its generated one. */
export function sessionTitle(text: string): string | undefined {
  const custom = [...text.matchAll(/"customTitle":"((?:[^"\\]|\\.)*)"/g)].pop()?.[1]
  const ai = [...text.matchAll(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)].pop()?.[1]
  const raw = custom ?? ai
  if (raw === undefined) return undefined
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
  }
}

/**
 * A memory file as the app labels it: an auto-memory file by its name and project
 * (`MEMORY.md · Brain`), any other by its folder and name (`Brain/CLAUDE.md`).
 */
export function memoryName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const projects = parts.indexOf('projects')
  if (projects >= 0 && parts[projects + 2] === 'memory') {
    const project = (parts[projects + 1] ?? '').split('-').filter(Boolean).pop() ?? ''
    return `${parts[parts.length - 1]} · ${project}`
  }
  return parts.slice(-2).join('/')
}

/** A hook as a row: its script's file name, else its command's first word. */
export function hookName(command: string): string {
  const script = /([^\s/\\]+\.(?:sh|js|mjs|ts|py|rb))\b/.exec(command)
  return script ? (script[1] as string) : (command.trim().split(/\s+/)[0] ?? command).split(/[\\/]/).pop() ?? command
}

/** The plugin an MCP tool ships in: `mcp__plugin_paper-desktop_paper__x` → `paper-desktop`. */
export function mcpPlugin(tool: string): string | undefined {
  const server = tool.slice('mcp__'.length).split('__')[0] ?? ''
  if (!server.startsWith('plugin_')) return undefined
  const rest = server.slice('plugin_'.length)
  const cut = rest.lastIndexOf('_')
  return cut < 0 ? rest : rest.slice(0, cut)
}

export function parseFile(text: string, ctx: FileContext, from: FileCarry = NEW_CARRY): FileIndex & { carry: FileCarry } {
  const out: FileIndex = { calls: [], charges: [], totals: [], models: [], agentSkills: [] }
  const inWindow = (at: number) => Number.isFinite(at) && at >= ctx.since
  let { prompt, skill, skillPlugin, skillPrompt, command, commandPrompt, pendingPrompt, lastId, lastRouter, lastRouterLine } = from
  let pending = [...from.pending]
  let memory = [...from.memory]
  const lines = text.split('\n')
  const base = from.line

  for (let local = 0; local < lines.length; local++) {
    const index = base + local
    const line = lines[local] as string
    const head = line.slice(0, 600)
    const isCommand = head.includes('<command-name>') && head.includes('"type":"user"')
    const isPrompt = head.includes('"type":"user"')
    const isMemory = line.includes('"type":"instructions"')
    const isHook = line.includes('"type":"hook_success"') || line.includes('"type":"hook_cancelled"') || line.includes('"stop_hook_summary"')
    if (!isPrompt && !isMemory && !isHook && !line.includes('"tool_use"') && !line.includes('"usage"')) continue

    let row: {
      type?: string
      subtype?: string
      isMeta?: boolean
      promptId?: string
      timestamp?: string
      effort?: string
      attachment?: { type?: string; files?: Array<{ path?: string; content?: string }>; command?: string; durationMs?: unknown }
      hookInfos?: Array<{ command?: string }>
      message?: { id?: string; model?: string; content?: unknown; usage?: Record<string, unknown> }
    }
    try {
      row = JSON.parse(line) as typeof row
    } catch {
      continue
    }
    const at = Date.parse(row.timestamp ?? '')
    const content: unknown = row.message?.content

    // Memory: the files in context, replaced whole by each `instructions` record.
    if (row.attachment?.type === 'instructions') {
      memory = (row.attachment.files ?? [])
        .filter(f => typeof f.path === 'string')
        .map(f => ({ name: memoryName(f.path as string), tokens: Math.max(1, Math.round((f.content ?? '').length / 4)) }))
      if (inWindow(at)) for (const file of memory) out.calls.push({ kind: 'memory', name: file.name, at })
      continue
    }
    // Hooks: a run each, its time in milliseconds where the record has it.
    if (row.attachment?.type === 'hook_success' || row.attachment?.type === 'hook_cancelled') {
      const name = hookName(row.attachment.command ?? '')
      const ms = Number(row.attachment.durationMs ?? 0)
      if (inWindow(at) && name) {
        out.calls.push({ kind: 'hooks', name, at })
        if (ms > 0) out.charges.push({ kind: 'hooks', name, at, tokens: ms })
      }
      continue
    }
    if (row.subtype === 'stop_hook_summary') {
      if (inWindow(at)) for (const info of row.hookInfos ?? []) if (info.command) out.calls.push({ kind: 'hooks', name: hookName(info.command), at })
      continue
    }

    if (row.type === 'user') {
      // The turn: its promptId. Transcripts before promptId start one at each typed prompt.
      if (typeof row.promptId === 'string') prompt = row.promptId
      else if (typeof content === 'string' && !row.isMeta) prompt = `line ${index}`
      // A typed command starts its turn's command.
      if (typeof content === 'string' && !row.isMeta && isCommand && content.startsWith('<command-')) {
        const name = commandName(content)
        command = name && !BUILTIN_COMMANDS.has(name) ? name : undefined
        commandPrompt = prompt
        if (command && inWindow(at)) {
          out.calls.push({ kind: 'commands', name: command, at })
          const plugin = command.includes(':') ? command.slice(1, command.indexOf(':')) : undefined
          if (plugin) out.calls.push({ kind: 'plugins', name: plugin, at })
        }
      }
      continue
    }
    if (row.type !== 'assistant' || !row.message) continue
    // A skill, a command and waiting calls hold only for their own turn.
    if (skillPrompt !== prompt) {
      skill = undefined
      skillPlugin = undefined
    }
    if (commandPrompt !== prompt) command = undefined
    if (pendingPrompt !== prompt) pending = []

    const id = row.message.id
    if (id !== undefined && id !== lastId) {
      lastId = id
      const usage = row.message.usage ?? {}
      const num = (k: string) => (typeof usage[k] === 'number' ? (usage[k] as number) : 0)
      const tokens = num('input_tokens') + num('output_tokens') + num('cache_creation_input_tokens') + num('cache_read_input_tokens')
      if (tokens > 0 && inWindow(at)) {
        out.totals.push({ at, tokens })
        out.charges.push({ kind: 'sessions', name: ctx.session, at, tokens })
        out.calls.push({ kind: 'sessions', name: ctx.session, at })
        if (ctx.agent) out.charges.push({ kind: 'agents', name: ctx.agent, at, tokens })
        if (skill) {
          out.charges.push({ kind: 'skills', name: skill, at, tokens })
          if (ctx.agent) out.agentSkills.push({ agent: ctx.agent, skill, tokens })
        }
        if (command) out.charges.push({ kind: 'commands', name: command, at, tokens })
        const share = pending.length > 0 ? Math.round(tokens / pending.length) : 0
        for (const tool of pending) out.charges.push({ kind: tool.kind, name: tool.name, at, tokens: share })
        for (const file of memory) out.charges.push({ kind: 'memory', name: file.name, at, tokens: file.tokens })
        const plugins = [...new Set([skillPlugin, command?.includes(':') ? command.slice(1, command.indexOf(':')) : undefined, ...pending.map(p => p.plugin)].filter((p): p is string => !!p))]
        for (const plugin of plugins) out.charges.push({ kind: 'plugins', name: plugin, at, tokens: Math.round(tokens / plugins.length) })
        if (row.message.model) out.models.push({ ...(ctx.agent ? { agent: ctx.agent } : {}), model: row.message.model, effort: row.effort ?? '', tokens, at })
      }
      pending = []
    }

    if (!Array.isArray(content)) continue
    for (const block of content as Array<{ type?: string; name?: unknown; input?: unknown } | null>) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue
      const input = (block.input ?? {}) as { skill?: unknown; file_path?: unknown; subagent_type?: unknown }
      if (block.name === 'Skill' && typeof input.skill === 'string') {
        const name = bareName(input.skill)
        const prefix = input.skill.includes(':') ? input.skill.slice(0, input.skill.indexOf(':')) : undefined
        skillPlugin = prefix && !ctx.isRouter(prefix) ? prefix : undefined
        skill = name
        skillPrompt = prompt
        if (inWindow(at)) {
          out.calls.push({ kind: 'skills', name, at })
          if (skillPlugin) out.calls.push({ kind: 'plugins', name: skillPlugin, at })
        }
        lastRouter = invokedName(input.skill)
        lastRouterLine = index
        continue
      }
      if (block.name === 'Read' && typeof input.file_path === 'string') {
        // A skill read from its file runs too, and holds the turn's tokens, as the app's.
        const run = skillRead(input.file_path, lastRouter, index - lastRouterLine <= ROUTER_READ_LINE_GAP)
        if (run) {
          if (inWindow(at)) out.calls.push({ kind: 'skills', name: run.name, at })
          skill = run.name
          skillPlugin = undefined
          skillPrompt = prompt
          if (run.isTop) {
            lastRouter = run.name
            lastRouterLine = index
          }
        }
      }
      const tool = classifyTool(block.name, input)
      if (!tool) continue
      const plugin = block.name.startsWith('mcp__') ? mcpPlugin(block.name) : undefined
      if (inWindow(at)) {
        out.calls.push({ ...tool, at })
        if (plugin) out.calls.push({ kind: 'plugins', name: plugin, at })
      }
      pending.push({ ...tool, ...(plugin ? { plugin } : {}) })
      pendingPrompt = prompt
    }
  }
  // Lines go on counting across pieces: a piece's closing newline starts no line of its own.
  const carry: FileCarry = { prompt, skill, skillPlugin, skillPrompt, command, commandPrompt, pending, pendingPrompt, memory, lastId, lastRouter, lastRouterLine, line: base + lines.length - (text.endsWith('\n') ? 1 : 0) }
  return { ...out, carry }
}
