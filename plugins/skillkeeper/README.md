# SkillKeeper for Claude Code

The [SkillKeeper](https://skillkeeper.app) popup inside Claude Code: which skills fire, which never do, which Claude can't see, and where your tokens go.

## Install

In Claude Code:

```
/plugin marketplace add inBuro/skillkeeper-releases
/plugin install skillkeeper@skillkeeper
```

Then run `/skillkeeper`.

**Early access.** The mod runs on Claude Code's function hooks, which are still rolling out. If `/skillkeeper` is unknown after the install, add this to `~/.claude/settings.json` and restart Claude Code:

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

## Use

- `All / Skills / Agents ▾` – what the list counts. The dropdown adds Sessions, Tools, MCP, Commands, Memory, Hooks and Plugins.
- `5h · 24h · Week · Month` – the period. The pill on the right sorts: 321, Usage, ABC, Last.
- `↑ ↓` pick a row and open its card. The wheel scrolls the list; scrolling past the top opens search.
- 🔔 in the footer – notifications: when this chat should compact (**Compact now** runs `/compact` here), limits about to run out, skills Claude may skip, agents on an older model.
- Above the prompt – a line when this chat should compact, with **Compact now**.
- Settings, in the footer – license key and extra skill folders.

## Privacy

The mod reads your local Claude Code history (`~/.claude/projects`) and skill files. It edits a skill only when you add a trigger in its card. For your limits it asks Claude Code itself (`claude -p /usage`).

It sends anonymous usage counts – the panel opened, a tab or period picked – as the macOS app does. Never a skill's name, its text or your files. To send nothing, set **Anonymous usage counts** to `off` in `/plugin` → SkillKeeper → Configure options.

## License

Every feature is free for 7 days. One key works for the mod and the [macOS app](https://skillkeeper.app)

## Feedback

hello@skillkeeper.app
