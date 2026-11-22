---
name: push
description: Push the current branch with the project recipe's pre-push checks, none skipped, confirming before the push. Use for "/push", "push this branch", "fai il push", "pusha".
---

# /push

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
   Read `$E/procedure.md` and follow it for everything below: finding the recipe, the checklist, running steps, confirmations, summary.
2. Before the recipe steps, check the branch state and report it in one block:
   - current branch: `git branch --show-current`
   - if it equals the recipe's `base_branch`: say so and ask whether to really push straight to it
     (default suggestion: create a branch with `git switch -c <name>` first). Do not continue without an answer.
   - uncommitted changes: `git status --short`. If any, show them and ask: commit them first, or push without them
     (they stay in the working tree, untouched). Only if the user explicitly asks to set them aside: the stash stack is
     shared by every Orca worktree of this repo, so use `git stash push -u -m "push-<branch>-<timestamp>"`, record the
     entry's SHA from `git stash list --format='%H %gs'`, and after the push restore with `git stash apply <sha>`, then
     drop that entry (find its current `stash@{n}` by the tag). Never bare `git stash` / `git stash pop`.
   - upstream: `git rev-parse --abbrev-ref @{u}`. Treat it as **no upstream** when it is missing, or when the
     upstream branch name differs from the current branch (e.g. a branch created from `origin/main` tracks `origin/main`):
     a plain `git push` would be rejected or land on the wrong branch.
   - commits to push: `git log --oneline origin/<branch>..HEAD` if `origin/<branch>` exists, else
     `git log --oneline origin/<base_branch>..HEAD`.
3. Show the `## push` checklist from the recipe, then run it per the shared procedure.
4. When every step is done or explicitly skipped, ask for confirmation, stating exactly:
   "push `<branch>` (<n> commits) to `origin`?". On yes:
   - upstream exists with the same name → `git push origin <branch>`
   - no upstream (or upstream branch name differs, see step 2) → `git push -u origin <branch>`
   Never `--force`. If the push is rejected (non-fast-forward), stop and explain; offer `git pull --rebase` and re-running the checks.
5. Summary per shared procedure, plus the pushed range.
