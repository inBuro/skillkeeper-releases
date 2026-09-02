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
scripts/release.sh       # in skilloptimizer/ — build, sign with Developer ID, notarize, staple;
                          # writes skilloptimizer/raw/SkillKeeper-<version>.zip, does NOT touch this repo

cp skilloptimizer/raw/SkillKeeper-<version>.zip SkillKeeper.zip

# generate_appcast errors on "duplicate bundle version" if SkillKeeper.dmg sits in this directory
# at the same time (both would contain the same version) — move it out first, back in after.
mv SkillKeeper.dmg /tmp/
generate_appcast .       # Sparkle tool, ships in the SPM artifact bundle — signs with the Keychain EdDSA key

# Human-facing download artifact — rebuild from the same notarized .app inside the zip just copied in,
# not a separate build (`scripts/release.sh` doesn't produce a .app on disk — it stages in a temp dir
# that's deleted on exit — so extract it back out of the zip):
rm -rf /tmp/dmg_staging && mkdir /tmp/dmg_staging
ditto -x -k SkillKeeper.zip /tmp/dmg_staging
ln -s /Applications /tmp/dmg_staging/Applications
hdiutil create -volname "SkillKeeper" -srcfolder /tmp/dmg_staging -ov -format UDZO SkillKeeper.dmg

git add -A && git commit && git push
```

**Signed with a real Developer ID certificate and notarized since 2026-09-02** (`docs/roadmap_distribution.md`
Фаза 2) — no more Gatekeeper "unknown developer" warning on first launch, `spctl` reports
`source=Notarized Developer ID`. Sparkle's own EdDSA signature (independent of Apple's notarization) still
covers the update mechanism itself, as before.
