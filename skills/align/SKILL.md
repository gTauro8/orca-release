---
name: align
description: Compare the release recipes with how each repo looks today and propose fixes. Use for "/align", "align the recipes", "⚠ recipe out of date", "allinea le ricette", "cosa devo aggiornare".
---

# /align

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
   Read `$E/procedure.md` (recipe format, step syntax, §8 how to save).
2. **Scope:** inside a project repo → only that project (`bash "$E/scripts/scan-recipes.sh" --repo "$PWD"`);
   otherwise, or if the user says "all" → every project (`bash "$E/scripts/scan-recipes.sh"`).
3. Show the report as it is: per project `ok` / `out of date` / `repo not found`, with
   `✗` broken (a command the recipe runs no longer works), `+` new (something in the repo the recipe doesn't use),
   `?` steps still marked `inferred: confirm`.
4. For each project "out of date", one at a time:
   - read what changed in the repo (Makefile, package.json scripts, workflow files and their `on:` triggers,
     compose file services, `git log --oneline -15`), and the recipe;
   - propose concrete edits as a before/after of the recipe lines, with one line of reason each.
     `+` items are suggestions: the user may reply "ignore". To stop the scanner from reporting it again, add to the
     recipe one line `<!-- ignore: KEY … -->` (space-separated keys, plus a short reason on the line above if useful):
     `npm:<script>` (e.g. `npm:build`), `make:<target>`, `wf:<file.yml>`, `compose` (root compose file is not for local dev);
   - on OK, save per §8 (validate, commit only that recipe, no push).
5. `repo not found`: ask whether the project moved (update `match.paths`) or is gone (move the recipe to `recipes/_examples/`).
6. Then offer to go through the `?` steps: for each, show it and ask "confirm / change / remove". Remove the
   `<!-- inferred: confirm -->` marker on confirmation.
7. **Links between projects** (`+ link?` lines). Get them all with
   `python3 -I "$E/scripts/scan_recipes.py" --json-links` (`[{from, to, file, line, text}]`). Group by project; for each
   candidate read the evidence line (and the file around it if needed) and propose one type, with a one-line reason:
   `uses-api` (calls the target's API), `follows` (follows its stack and conventions), `replaces` (takes over its role),
   `related` (anything else) — or propose to ignore it when the mention is incidental. External systems named in the
   evidence (a legacy app, a CMS) can be proposed as `ext:<Name>` targets. When two or more projects end up linked,
   propose a shared `domain` id (kebab-case) and a `domain-label`. On the user's OK, write the lines into each affected
   recipe's `## links` section (create it if missing; format in `$E/procedure.md`) and save per §8. A rejected candidate
   becomes `<!-- ignore: link:<id> -->` in that recipe, so it is not proposed again.
8. Never touch the project repos themselves. Summary: per project what changed in its recipe, what is still open.
   Talk to the user in their language.
