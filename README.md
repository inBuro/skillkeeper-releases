# SkillKeeper releases

Download and auto-update channel for [SkillKeeper](https://skillkeeper.app), a macOS menu bar app that shows which of your Claude Code skills actually fire, how often by day, week and month, and lets you tune their triggers inline without opening an editor.

## Install

- **Direct download:** [SkillKeeper.dmg](https://github.com/inBuro/skillkeeper-releases/raw/main/SkillKeeper.dmg), then drag the app to Applications
- **Homebrew:** `brew install --cask inBuro/apps/skillkeeper` (tap: [inBuro/homebrew-apps](https://github.com/inBuro/homebrew-apps))

Requires macOS 13 Ventura or later. The app is signed with an Apple Developer ID and notarized, so it opens without Gatekeeper warnings.

## Updates

SkillKeeper updates itself through [Sparkle](https://sparkle-project.org/). `appcast.xml` in this repo is the feed the app polls; `SkillKeeper.zip` is the update package it downloads. Updates are signed with Sparkle's EdDSA key on top of Apple's notarization.

## What is here

This repo holds build artifacts only: the disk image, the update package, the appcast, and previous packages under `old_updates/`. Source code is not published.

Made by [Kirill Bush](https://in-buro.com).
