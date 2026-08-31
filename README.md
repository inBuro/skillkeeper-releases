# SkillKeeper Releases

Distribution channel for [SkillKeeper](https://skillkeeper.app) auto-updates via [Sparkle](https://sparkle-project.org/).

This repo hosts only build artifacts (`.zip`) and `appcast.xml` — no source code. Source lives in the `inBuro/Brain` monorepo (`skilloptimizer/app/`), kept separate deliberately: `Brain` is **public**, and shipping paid-product release zips from it would let anyone bypass the Gumroad paywall.

## Structure

Flat, matching Sparkle's own `generate_appcast` convention (no per-version subfolders — old archives move to `old_updates/` automatically when a newer one is generated):

- `appcast.xml` — Sparkle feed, referenced by `SUFeedURL` in the app's `Info.plist`.
- `SkillKeeper.zip` (+ future `SkillKeeper 1.1.zip` etc.) — release archives `generate_appcast` finds by scanning this directory.

## Publishing a release

```
swift build -c release   # in app/
scripts/deploy.sh        # installs + re-signs the local .app
ditto -c -k --sequesterRsrc --keepParent ~/Applications/SkillKeeper.app SkillKeeper.zip
generate_appcast .       # Sparkle tool, ships in the SPM artifact bundle — signs with the Keychain EdDSA key
git add -A && git commit && git push
```

Currently ad-hoc signed only, not notarized — first launch after an update still shows the Gatekeeper "unknown developer" warning until Phase 1-2 (Developer ID + notarization, `docs/roadmap_distribution.md`) land. Not a blocker for the update mechanism itself, which is Sparkle's own EdDSA signature, independent of Apple's.
