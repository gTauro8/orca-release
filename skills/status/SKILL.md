---
name: status
description: Read-only overview of every Orca repo — branch, uncommitted, unpushed, worktrees, recipe drift, open PRs, and what to do first. Use for "/status", "project status", "what did I leave around", "stato dei progetti", "cosa devo pushare".
---

# /status

Read-only: never commit, push, fetch-and-merge, or clean anything.

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
2. Run `python3 -I "$E/scripts/status.py"` (uses `orca repo list`; needs Orca open). Show its table as is.
   "To push" is relative to the last fetch; say so if it matters. (Recipe terms: `$E/procedure.md`.)
3. Open PRs (optional, network): for repos whose recipe has `host: github`, `gh pr list --author @me --state open
   --json number,title,headRefName,url,reviewDecision` from the repo folder. Add a short list. Skip silently if `gh` is
   missing or not logged in; for other hosts mention that PRs aren't checked.
4. Also `orca worktree ps --limit 20` for Orca worktrees with agents waiting or idle, if useful.
5. End with **"Do now"**: at most 5 lines, most urgent first (uncommitted work in worktrees about to be lost,
   unpushed commits, PRs waiting for the user, recipes to align), each with the skill that handles it
   (`/push`, `/pr`, `/align`…). Offer, don't do. Talk to the user in their language.
