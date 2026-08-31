# SkillKeeper Releases

Distribution channel for [SkillKeeper](https://skillkeeper.app) auto-updates via [Sparkle](https://sparkle-project.org/).

This repo hosts only build artifacts (`.zip`, `.dmg`) and `appcast.xml` — no source code. Source lives in the `inBuro/Brain` monorepo (`skilloptimizer/app/`), kept separate deliberately: `Brain` is **public**, and shipping release artifacts from it would put them in the wrong place to reason about (this repo, not Brain, is the intended public download point — see `docs/app_release_roadmap.md` Stage B: downloading and running the app is free for everyone, only in-app editing needs a license, so there's no paywall being bypassed here).

## Structure

Flat, matching Sparkle's own `generate_appcast` convention (no per-version subfolders — old archives move to `old_updates/` automatically when a newer one is generated):

- `appcast.xml` — Sparkle feed, referenced by `SUFeedURL` in the app's `Info.plist`. Points at `SkillKeeper.zip`.
- `SkillKeeper.zip` (+ future `SkillKeeper 1.1.zip` etc.) — Sparkle's own auto-update enclosure, found by `generate_appcast` scanning this directory. Not meant for humans to click — no volume icon, no "drag to Applications" affordance.
- `SkillKeeper.dmg` — the human-facing first download, linked from the site's "Download" button. Plain disk image (app + `Applications` symlink), no custom background — round-1 scope, see Stage C. Kept in sync with the `.zip` by hand on each release; Sparkle itself never reads this file.

## Publishing a release

```
swift build -c release   # in app/
scripts/deploy.sh        # installs + re-signs the local .app

# Sparkle auto-update artifact:
ditto -c -k --sequesterRsrc --keepParent ~/Applications/SkillKeeper.app SkillKeeper.zip
generate_appcast .       # Sparkle tool, ships in the SPM artifact bundle — signs with the Keychain EdDSA key

# Human-facing download artifact:
rm -rf /tmp/dmg_staging && mkdir /tmp/dmg_staging
cp -R ~/Applications/SkillKeeper.app /tmp/dmg_staging/
ln -s /Applications /tmp/dmg_staging/Applications
hdiutil create -volname "SkillKeeper" -srcfolder /tmp/dmg_staging -ov -format UDZO SkillKeeper.dmg

git add -A && git commit && git push
```

Currently ad-hoc signed only, not notarized — first launch after an update still shows the Gatekeeper "unknown developer" warning until Phase 1-2 (Developer ID + notarization, `docs/roadmap_distribution.md`) land. Not a blocker for the update mechanism itself, which is Sparkle's own EdDSA signature, independent of Apple's.
