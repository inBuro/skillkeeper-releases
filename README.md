# SkillKeeper Releases

Distribution channel for [SkillKeeper](https://skillkeeper.app) auto-updates via [Sparkle](https://sparkle-project.org/).

This repo hosts only build artifacts (`.zip`, `.dmg`) and `appcast.xml` — no source code. Source lives in the `inBuro/Brain` monorepo (`skilloptimizer/app/`), kept separate deliberately: `Brain` is **public**, and shipping release artifacts from it would put them in the wrong place to reason about (this repo, not Brain, is the intended public download point — see `docs/app_release_roadmap.md` Stage B: downloading and running the app is free for everyone, only in-app editing needs a license, so there's no paywall being bypassed here).

## Structure

Flat, matching Sparkle's own `generate_appcast` convention (no per-version subfolders — old archives move to `old_updates/` automatically when a newer one is generated):

- `appcast.xml` — Sparkle feed, referenced by `SUFeedURL` in the app's `Info.plist`. Points at `SkillKeeper.zip`.
- `SkillKeeper.zip` (+ future `SkillKeeper 1.1.zip` etc.) — Sparkle's own auto-update enclosure, found by `generate_appcast` scanning this directory. Not meant for humans to click — no volume icon, no "drag to Applications" affordance.
- `SkillKeeper.dmg` — the human-facing first download, linked from the site's "Download" button. Disk image (app + `Applications` symlink + arrow item) with a pinned icon layout — see Stage C. Kept in sync with the `.zip` by hand on each release; Sparkle itself never reads this file.

## Publishing a release

```
scripts/release.sh       # in skilloptimizer/ — build, sign with Developer ID, notarize, staple;
                          # writes skilloptimizer/raw/SkillKeeper-<version>.zip, does NOT touch this repo

cp skilloptimizer/raw/SkillKeeper-<version>.zip SkillKeeper.zip

# generate_appcast errors on "duplicate bundle version" if SkillKeeper.dmg sits in this directory
# at the same time (both would contain the same version) — move it out first, back in after.
mv SkillKeeper.dmg /tmp/
generate_appcast .       # Sparkle tool, ships in the SPM artifact bundle — signs with the Keychain EdDSA key

# Human-facing download artifact — rebuilt from the same notarized .app inside the zip just copied in,
# not a separate build. The script pins the Finder layout (app left, arrow, Applications right, 128 px
# icons, 600x400 window, no toolbar) via a .DS_Store; the arrow is a blank-named file whose custom icon
# is rendered by scripts/dmg_arrow_icon.py from the Figma asset — not a window background: Finder paints
# labels black whenever a background picture or colour is set, so the window keeps Finder's default
# field (dark in dark mode, white in light) and its own label colour.
# A bare `hdiutil create -srcfolder` ships none of this, and Finder then sorts the two items alphabetically — Applications first, app second (how 1.0–1.1 looked).
# Eject any mounted SkillKeeper volume first — the script refuses to run over one.
../skilloptimizer/scripts/make-dmg.sh SkillKeeper.zip SkillKeeper.dmg

git add -A && git commit && git push
```

**Signed with a real Developer ID certificate and notarized since 2026-09-02** (`docs/roadmap_distribution.md`
Фаза 2) — no more Gatekeeper "unknown developer" warning on first launch, `spctl` reports
`source=Notarized Developer ID`. Sparkle's own EdDSA signature (independent of Apple's notarization) still
covers the update mechanism itself, as before.
