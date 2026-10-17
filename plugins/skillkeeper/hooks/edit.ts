/**
 * Writes trigger phrases into a skill's own `description:` frontmatter, as the macOS
 * app's SkillFileEditor does, so both edit a SKILL.md the same way: the phrases join
 * the `Триггеры:` section (made at the end when there is none), duplicates dropped,
 * the value quoted whenever it would not parse bare.
 */

const TRIGGER_VARIANTS = ['Триггерные фразы:', 'Триггеры (RU):', 'Триггеры:']
const COMMAND_VARIANTS = ['Команды:']
const ALL_MARKERS = [...TRIGGER_VARIANTS, ...COMMAND_VARIANTS]
const CANONICAL = 'Триггеры:'
const COMMAND_CANONICAL = 'Команды:'

export type EditResult = { text: string } | { error: 'frontmatter' | 'description' | 'nothing' }

/** The file with `phrases` (comma-separated) added to the skill's triggers. */
export function appendTriggers(file: string, phrases: string): EditResult {
  return rewrite(file, current => merged(current, phrases, CANONICAL, TRIGGER_VARIANTS))
}

/** One trigger phrase out; the section goes when it was the last. */
export function removeTrigger(file: string, phrase: string): EditResult {
  return rewrite(file, current => removing(current, phrase, CANONICAL, TRIGGER_VARIANTS))
}

/** One trigger phrase renamed in place. */
export function renameTrigger(file: string, from: string, to: string): EditResult {
  return rewrite(file, current => renaming(current, from, to.trim(), CANONICAL, TRIGGER_VARIANTS))
}

/** One slash command added: only the first of a comma list, as the app's Add (a second /command is routing noise). */
export function appendCommand(file: string, command: string): EditResult {
  return rewrite(file, current => merged(current, firstPhrase(command), COMMAND_CANONICAL, COMMAND_VARIANTS))
}

export function removeCommand(file: string, command: string): EditResult {
  return rewrite(file, current => removing(current, command, COMMAND_CANONICAL, COMMAND_VARIANTS))
}

/** The command file the app registers with an added command: `~/.claude/commands/<name>.md`, invoking the skill. */
export function commandFile(command: string, skill: string): { name: string; text: string } | undefined {
  const name = firstPhrase(command).replace(/\.$/, '').replace(/^\//, '')
  if (name === '') return undefined
  return { name, text: `Use the Skill tool to invoke "${skill}", then follow its instructions for this request: $ARGUMENTS\n` }
}

function firstPhrase(text: string): string {
  return (text.split(',')[0] ?? text).trim()
}

function rewrite(file: string, transform: (current: string) => string | undefined): EditResult {
  // A BOM and CRLF would fail the frontmatter guard; the write-back is LF, BOM-less.
  const raw = file.startsWith('\uFEFF') ? file.slice(1) : file
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '---') return { error: 'frontmatter' }
  const closing = lines.indexOf('---', 1)
  if (closing < 0) return { error: 'frontmatter' }
  let at = -1
  for (let i = 1; i < closing; i++) if ((lines[i] as string).startsWith('description:')) { at = i; break }
  if (at < 0) return { error: 'description' }

  const afterColon = (lines[at] as string).slice('description:'.length).trim()
  // `>` or `|` (with any chomp or indent indicator) heads a block scalar.
  const wasBlock = afterColon === '' || afterColon.startsWith('>') || afterColon.startsWith('|')
  let end = at
  let current: string
  if (wasBlock) {
    const collected: string[] = []
    for (let i = at + 1; i < closing && (lines[i] as string).startsWith(' '); i++) {
      collected.push((lines[i] as string).trim())
      end = i
    }
    current = collected.join(' ')
  } else {
    current = scalarValue(afterColon)
  }

  const next = transform(current)
  if (next === undefined) return { error: 'nothing' }
  const replacement = wasBlock ? ['description: >-', `  ${next}`] : isSafePlain(next) ? [`description: ${next}`] : [`description: ${doubleQuoted(next)}`]
  lines.splice(at, end - at + 1, ...replacement)
  return { text: lines.join('\n') }
}

function firstMarker(current: string, variants: readonly string[]): { variant: string; index: number } | undefined {
  return variants
    .map(variant => ({ variant, index: current.indexOf(variant) }))
    .filter(m => m.index >= 0)
    .sort((a, b) => a.index - b.index)[0]
}

function merged(current: string, adding: string, canonical: string, variants: readonly string[]): string | undefined {
  const target = firstMarker(current, variants)
  if (!target) {
    const fresh = deduped(adding, '')
    if (fresh === undefined) return undefined
    let base = current.trim()
    if (base !== '' && !base.endsWith('.')) base += '.'
    return `${base === '' ? '' : `${base} `}${canonical} ${fresh}.`
  }
  const { content, before, after } = section(current, target.index, target.variant)
  const fresh = deduped(adding, content)
  if (fresh === undefined) return undefined
  const joined = `${canonical} ${content}, ${fresh}.`
  return after === '' ? `${before}${joined}` : `${before}${joined} ${after}`
}

function removing(current: string, phrase: string, canonical: string, variants: readonly string[]): string | undefined {
  const target = firstMarker(current, variants)
  if (!target) return undefined
  const { content, before, after } = section(current, target.index, target.variant)
  const all = content.split(',').map(p => p.trim()).filter(p => p !== '')
  const remaining = all.filter(p => p !== phrase)
  if (remaining.length === all.length) return undefined
  if (remaining.length === 0) {
    // The whole section goes rather than leave "Триггеры: .".
    const head = before.trim()
    if (head === '') return after
    return after === '' ? head : `${head} ${after}`
  }
  const joined = `${canonical} ${remaining.join(', ')}.`
  return after === '' ? `${before}${joined}` : `${before}${joined} ${after}`
}

function renaming(current: string, from: string, to: string, canonical: string, variants: readonly string[]): string | undefined {
  const target = firstMarker(current, variants)
  if (!target || to === '' || to === from) return undefined
  const { content, before, after } = section(current, target.index, target.variant)
  const all = content.split(',').map(p => p.trim())
  if (!all.includes(from)) return undefined
  const joined = `${canonical} ${all.map(p => (p === from ? to : p)).filter(p => p !== '').join(', ')}.`
  return after === '' ? `${before}${joined}` : `${before}${joined} ${after}`
}

/** The new phrases less those already there or repeated (case-insensitive); undefined when none is left. */
function deduped(adding: string, existing: string): string | undefined {
  const seen = new Set(existing.split(',').map(p => p.trim().toLowerCase()))
  const out: string[] = []
  for (const raw of adding.split(',')) {
    const phrase = raw.trim()
    if (phrase === '' || seen.has(phrase.toLowerCase())) continue
    seen.add(phrase.toLowerCase())
    out.push(phrase)
  }
  return out.length > 0 ? out.join(', ') : undefined
}

function section(text: string, index: number, variant: string): { content: string; before: string; after: string } {
  const start = index + variant.length
  const next = ALL_MARKERS.filter(m => m !== variant)
    .map(m => text.indexOf(m, start))
    .filter(i => i >= 0)
  const boundary = next.length > 0 ? Math.min(...next) : text.length
  let content = text.slice(start, boundary).trim()
  if (content.endsWith('.')) content = content.slice(0, -1)
  return { content, before: text.slice(0, index), after: text.slice(boundary).trim() }
}

/** Not full YAML: what separates a description that still parses bare from one that would break. */
function isSafePlain(text: string): boolean {
  const first = text[0]
  if (first === undefined) return true
  if ('"\'{[&*!|>%@`#-?:,'.includes(first)) return false
  if (text.includes(': ') || text.includes(' #') || text.endsWith(':') || text.endsWith(' ')) return false
  return !text.includes('\n') && !text.includes('\r')
}

function doubleQuoted(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  return `"${escaped}"`
}

/** A one-line YAML scalar as a reader sees it: quotes and escapes undone. */
function scalarValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    let out = ''
    let escaping = false
    for (const ch of value.slice(1, -1)) {
      if (escaping) {
        out += ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch === '"' || ch === '\\' ? ch : `\\${ch}`
        escaping = false
      } else if (ch === '\\') escaping = true
      else out += ch
    }
    return escaping ? `${out}\\` : out
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  return value
}
