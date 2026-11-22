---
name: orca-release
description: Shared engine of the release skills (push, pr, deploy, compose, dev, align, updates, status, weekly-report, prompt, dashboard, release-setup) — scripts, procedure, templates. Load when one of them points here or to run its scripts.
---

# orca-release (engine)

Not a workflow by itself: the other skills read files from this folder.

- `procedure.md` — the common procedure every release skill follows (find recipe → checklist → steps → confirmations → summary → save).
- `templates/recipe.md` — recipe template; `examples/` — a filled example; `templates/tech-watch.md`.
- `scripts/` — deterministic helpers: `find-recipe.sh`, `validate-recipes.sh`, `compose-cmd.sh`, `pr-url.sh`,
  `scan-recipes.sh`, `outdated-cmds.sh`, `session-hint.sh`, `register-hint.sh`, `quick_commands.py`, `setup.sh`.

Two folders, recorded in `~/.config/orca-release/`:
- `engine` → this folder (installed by Orca; never edit, it is replaced on update);
- `root` → the user's data folder (`recipes/`, `reports/`, `tech-watch.md`, a git repo of their own).

If `~/.config/orca-release/root` is missing, the user has not configured anything yet: run the `release-setup` skill.
