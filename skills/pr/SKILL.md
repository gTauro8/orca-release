---
name: pr
description: Open a pull request the way the project recipe says (pushes first if needed; GitHub via gh, Gitea/others via browser). Use for "/pr", "open a PR", "apri la PR", "fai la pull request".
---

# /pr

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
   Read `$E/procedure.md` and follow it for everything below.
2. From the recipe take `host`, `base_branch`, `pr_url_template` and the `## pr` section
   (title convention, body sections, reviewers, any checklist steps).
3. Make sure the branch is on the remote: if `origin/<branch>` does not exist, or `git log --oneline origin/<branch>..HEAD` is not empty,
   run the full /push flow first (read `$E/../push/SKILL.md` and follow it). If the user declines, stop.
4. Run any checklist steps in `## pr` per the shared procedure.
5. Draft the PR from real data:
   - `git fetch origin <base_branch>` then `git log --oneline origin/<base_branch>..HEAD`
     and `git diff --stat origin/<base_branch>...HEAD`
   - title following the recipe convention; body with the sections the recipe asks for
     (default: what changed, why, how it was tested). Do not invent testing that did not happen.
   Show title and body; let the user edit. Write the body to `${CLAUDE_JOB_DIR:-${TMPDIR:-/tmp}}/pr-body.md`.
6. Confirm "open PR `<branch>` → `<base_branch>` on <host>?". On yes:
   - **github**: `gh pr create --base <base_branch> --head <branch> --title "<title>" --body-file <body file>`
     (add `--reviewer` if the recipe lists them). Print the URL gh returns.
   - **gitea / other**: `pbcopy < <body file>`, then
     `open "$(bash "$E/scripts/pr-url.sh" <host> <remote> <base_branch> <branch> "<pr_url_template>")"`
     where `<remote>` is the `remote` line from find-recipe.sh. Tell the user: title to paste, body is in the clipboard,
     and (other host without `pr_url_template`) that they must click "New pull request" on the repo page.
7. Summary per shared procedure, with the PR URL (or the opened page URL).
