---
name: updates
description: Read-only check of outdated dependencies plus news and breaking changes for the stacks in tech-watch.md; never upgrades. Use for "/updates", "any updates?", "outdated dependencies", "novità su…", "ci sono aggiornamenti?".
---

# /updates

Read-only. Never run install/upgrade commands, never edit lockfiles or project files.

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
   Read `$D/tech-watch.md` — sections "Using", "Want to try", "Ignore" (older files: "Uso", "Vorrei usare", "Ignora") —
   and skim `$E/procedure.md` for context.
2. **Projects:** in a project repo → that one; otherwise all recipes in `$D/recipes/*.md` (skip names starting
   with `_`) whose `match.paths` exists. For each, run every command printed by
   `bash "$E/scripts/outdated-cmds.sh" <repo dir>` from the repo dir (timeout ~2 min each; a missing tool or
   no `node_modules` → note "could not check" and move on).
   Keep only what matters: major versions behind, packages with known security issues, framework/SDK versions.
3. **News** (web search, current year): for each technology in "Using" and "Want to try" (minus "Ignore"):
   latest stable version and date, breaking changes / deprecations that affect the versions found in step 2,
   security advisories, notable new features. For "Want to try": maturity, how it would fit the user's projects,
   a first small step to try it. Cite sources (links).
4. **Report**, in the user's language, prioritized:
   1. 🔴 Security (advisories affecting versions in use)
   2. 🟠 Breaking changes / end of support coming
   3. 🟡 Recommended updates (per project: package, current → latest, why)
   4. 🟢 Useful news
   5. 🔭 To try ("Want to try")
   Each item: what, which projects, suggested next step (e.g. "open a branch and update X", not doing it).
5. If the user asks to act on an item, that is a separate task in the project (normal workflow, /push afterwards).
