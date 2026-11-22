---
name: prompt
description: Turn a rough request into a structured task prompt with the project's real context, agree it, then start it in a new Orca worktree with an agent. Use for "/prompt", "new task", "launch an agent on…", "nuovo task", "prepara un prompt per…".
---

# /prompt

The current session only prepares and launches; it does not do the task itself.

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
2. **Project.** The repo the user is in, or the one they name (match it in `orca repo list`). Run
   `bash "$E/scripts/find-recipe.sh" <repo>` for stack and recipe.
3. **Context (read, don't change anything):** the recipe (format in `$E/procedure.md`; `base_branch`, `## push` checks), CLAUDE.md / AGENTS.md / README,
   `git log --oneline -10`, and the files the request is about (search for the names, routes, screens or errors it mentions;
   open the 3–6 most relevant). Note what exists today and where.
4. **Draft the prompt** in the user's language, in this shape, concrete and short (aim < 40 lines):
   ```
   # <short title>
   ## Goal             — what must be true when done, from the user's point of view
   ## Context          — stack, how it works today, relevant facts found in step 3
   ## Where to look    — files/paths with one line each on why
   ## Constraints      — what not to touch, conventions, compatibility; never push/deploy (use /push /pr /deploy after)
   ## Acceptance criteria — observable checks + the recipe's push checks as commands
   ## Open questions   — only what the code and the user's words don't answer
   ```
   Don't invent requirements: anything you assumed goes under "Open questions" or is marked as an assumption.
5. **Agree it.** Show the draft. Ask the open questions now, one at a time, and fold the answers in until
   "Open questions" is empty or explicitly left to the agent. Apply the user's edits. Then propose, in one block:
   worktree name (kebab-case slug of the title, ≤ 40 chars), base branch (recipe `base_branch`, else the repo default),
   agent (the user's usual one, default `claude`). Wait for an explicit yes.
6. **Save** the final prompt to `$D/prompts/<YYYY-MM-DD>-<slug>.md` (create the folder; history only, no commit needed).
7. **Launch:**
   `orca worktree create --repo "path:<repo main checkout>" --name <slug> --base-branch <base> --no-parent --agent <agent> --prompt "$(cat "$D/prompts/<file>")" --json`
   If it fails, show the error and the saved prompt path; do not retry blindly.
8. **Report:** worktree name and path, branch, agent, where the prompt is saved. Remind: when the work is done, in that
   worktree use `/push` and `/pr`.
