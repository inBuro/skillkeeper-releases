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

The counts go to PostHog (`https://us.i.posthog.com/i/v0/e/`), with a random install ID kept in the mod's own storage. When you enter a license key, the mod also sends the key and a random device ID to `https://fadercraft.com/api/skillkeeper-activate` to check it. Those are the only two addresses the mod contacts; nothing else leaves your machine.

### What the mod reads

- Your session logs in `~/.claude/projects`, to count which skills ran and where tokens went. The counts stay on your machine, in the mod's own storage.
- Skill, command, agent and memory files in `~/.claude` and in the current project, plus any extra folders you add in Settings.
- While you work, it sees each tool call and each prompt in the current session, only to note which skill ran and when. It does not keep or send their text.
- Your limits, by asking Claude Code itself (see `claude -p /usage` below).

### What the mod runs

All of these run on your machine, with fixed arguments and the path of a file the mod already reads:

- `claude -p /usage` – your limits.
- `ps -axww -o args=` – finds running Claude Code sessions.
- `sh -c` with `tail` and `head` – read a session log in chunks.
- `mv -f` (`cmd /c move /y` on Windows) – save the mod's own trial file.
- `open` or `xdg-open` – open a skill file in your editor, or a session in your editor through its `anthropic.claude-code://` link.

**Compact now** runs `/compact` in the current chat, only when you press it.

### What the mod writes

- A skill's own `SKILL.md`, only when you add a trigger or a command in its card (a paid action after the trial). It writes only that file.
- A command file `~/.claude/commands/<name>.md`, only when you add a command to a skill, and never over a file that exists. It does not touch build, start-up or settings files.
- Its own state, index and trial files in the mod's storage.
- Your license key, in the plugin's own option (`/plugin` → SkillKeeper → Configure options), when you type it in Settings.

## License

Every feature is free for 7 days. One key works for the mod and the [macOS app](https://skillkeeper.app)

## Feedback

hello@skillkeeper.app
