# SkillKeeper Releases

Distribution channel for [SkillKeeper](https://skillkeeper.app) auto-updates via [Sparkle](https://sparkle-project.org/).

This repo hosts only build artifacts (`.zip` per version) and `appcast.xml` — no source code. Source lives in the private `inBuro/Brain` monorepo (`skilloptimizer/app/`), kept separate deliberately: `Brain` is public, and shipping paid-product release zips from it would let anyone bypass the Gumroad paywall.

## Structure

- `appcast.xml` — Sparkle feed, referenced by `SUFeedURL` in the app's `Info.plist`.
- `v<version>/SkillKeeper.zip` — one folder per released version.

## Publishing a release

Generated via Sparkle's `generate_appcast` tool against this repo's release folders — see `docs/roadmap_distribution.md` Phase 4 in the main repo for the full pipeline (Developer ID signing → notarization → `generate_appcast` → push here).

Not yet populated — first release lands once app packaging (Stage C) and notarization (Phase 1-2) are done.
