# SkillKeeper releases

Download and auto-update channel for [SkillKeeper](https://skillkeeper.app), a macOS menu bar app that shows which of your Claude Code skills actually fire, how often by day, week and month, and lets you tune their triggers inline without opening an editor.

## Install

- **Direct download:** [SkillKeeper.dmg](https://github.com/inBuro/skillkeeper-releases/raw/main/SkillKeeper.dmg), then drag the app to Applications
- **Homebrew:** `brew install --cask inBuro/apps/skillkeeper` (tap: [inBuro/homebrew-apps](https://github.com/inBuro/homebrew-apps))

Requires macOS 13 Ventura or later. The app is signed with an Apple Developer ID and notarized, so it opens without Gatekeeper warnings.

## Claude Code mod (early access)

The same popup inside Claude Code, on any OS. In Claude Code:

```
/plugin marketplace add inBuro/skillkeeper-releases
/plugin install skillkeeper@skillkeeper
```

Then run `/skillkeeper`. The mod runs on Claude Code's function hooks, which are still rolling out: if `/skillkeeper` is unknown, add `{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }` to `~/.claude/settings.json` and restart Claude Code. More in [plugins/skillkeeper](plugins/skillkeeper/README.md).

## Updates

SkillKeeper updates itself through [Sparkle](https://sparkle-project.org/). `appcast.xml` in this repo is the feed the app polls; `SkillKeeper.zip` is the update package it downloads. Updates are signed with Sparkle's EdDSA key on top of Apple's notarization.

## What is here

This repo holds the app's build artifacts – the disk image, the update package, the appcast, and previous packages under `old_updates/` – and the Claude Code mod under `plugins/skillkeeper`, with its marketplace catalogue in `.claude-plugin/`. The app's source code is not published; the mod is, since Claude Code runs it from source.

Made by [Kirill Bush](https://in-buro.com).
