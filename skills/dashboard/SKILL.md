---
name: dashboard
description: Build and open the local, read-only project dashboard page (releases, unsaved or unpushed work, worktrees, recipe drift, Monday report). Use for "/dashboard", "show me the dashboard", "fammi vedere la dashboard".
---

# /dashboard

1. Locate the engine: `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` (if empty or gone, use the `orca-release`
   folder next to this skill's folder). If `~/.config/orca-release/root` is missing, tell the user to run the
   `release-setup` skill and stop. (Recipe terms, if asked: `$E/procedure.md`.)
2. Run `python3 -I "$E/scripts/dashboard.py"` (Orca must be open: it reads `orca repo list`). Add `--online` if the user
   wants CI status from GitHub (uses `gh`; slower). It writes `<data folder>/dashboard/index.html` and opens it.
3. Reply with the path and the 3 most important things from the page ("To do" first). Don't repeat the whole page.
   The page is local only: never upload or publish it, it contains the user's (and possibly their employer's) project data.
