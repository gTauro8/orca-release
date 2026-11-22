# Release recipes — shared procedure for the release skills

Every release skill follows this procedure. Two folders:
`E=$(cat ~/.config/orca-release/engine 2>/dev/null)` is this `orca-release` skill (scripts, templates — shared, never edit);
`D=$(cat ~/.config/orca-release/root 2>/dev/null)` is the user's own data folder (`recipes/`, `reports/`, `tech-watch.md`,
a git repo). If either is empty, tell the user to run `/release-setup` first and stop.
Speak to the user in their language. These instructions work for any agent Orca launches (Claude, Codex, Gemini…):
"`/push`" means the skill named `push`, however the agent invokes skills.

## 1. Find the recipe

Run `bash "$E/scripts/find-recipe.sh"` from the user's repo. It prints:

```
root <repo toplevel>
remote <host/org/repo or ->
recipe <path | none>
stack <markers or ->
```

- `error multiple …` (exit 2): two recipes claim this repo. Stop, show both paths, ask which to keep. Do not guess.
- `error no-release-root` (exit 4): tell the user to run `/release-setup`. Stop.
- `error not-a-git-repo` (exit 3): stop.
- `recipe none`: go to **Draft a recipe** (section 7), then continue.

Read the recipe file. Front matter gives `id`, `host`, `base_branch`,
`pr_url_template`. Sections `## push`, `## pr`, `## deploy` give the steps. Optional sections: `## compose`, `## dev`,
and `## links` — `- domain: <id>`, `- domain-label: <name>`, then `- <type>: <target>` lines with type `uses-api`,
`follows`, `replaces` or `related` and target a recipe id or `ext:<Name>`. A `## links` line ending with
`<!-- inferred: confirm -->` is only a proposal.

## 2. Show the checklist first

Before doing anything, print the full list of steps for this activity, numbered,
each tagged **[auto]** or **[manual]**:

- a step whose entire text is one backticked command (optionally followed by an
  HTML comment) is **[auto]**: you run that exact command.
- anything else is **[manual]**: the user does it.

A step marked `inferred: confirm` is a guess: say so when you reach it.

## 3. Run the steps in order

- **[auto]**: run the command exactly as written from the repo root. Show the tail of the output.
  Never run a command that is not written in the recipe; never "improve" it.
- **[manual]**: tell the user what to do and wait for their explicit OK.
  You may do a manual step yourself only if the user asks you to in this session; then show what you changed.
- **On failure** (non-zero exit, or the user says it's not OK): stop and offer
  three choices — fix it now, skip it (ask for a one-line reason), or abort.
  Never move on silently.

## 4. Confirm before anything irreversible

Ask for an explicit yes immediately before: `git push`, opening a PR,
any deploy/release/upload command, and before starting any deploy target marked
`(confirm)`. Say exactly what will happen ("push `feature/login` to origin").

## 5. Summary

End with: steps done, steps skipped (with reason), and links (PR URL, workflow run, etc.).

## 6. Recipe drift

If the user did something different from the recipe this time ("also run X",
"that step is obsolete"), offer to update the recipe. If they accept, go to section 8.

## 7. Draft a recipe (no recipe found)

Build a draft from what the repo actually contains, then show it in full:

- `stack` markers from find-recipe.sh;
- `Makefile` targets, `package.json` scripts, `.github/workflows/*` / `.gitea/workflows/*` names and their `on:` triggers, CLAUDE.md/README release notes;
- default branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`), else ask.

Use `$E/templates/recipe.md` as the shape. `id` = repo folder name in kebab-case.
`match.remotes` = the `remote` value; `host`: `github.com` → `github`; a Gitea/Forgejo server → `gitea`
(look at the web page or ask); anything else (GitLab, Gogs, Bitbucket, self-hosted…) → `other`, and ask the user for
the "new pull request" URL shape to put in `pr_url_template` (`{remote}` `{base}` `{branch}`).
Mark every step you did not literally find in the repo with `<!-- inferred: confirm -->`.
Mobile apps without CI: deploy = local build + manual upload checklist (no fastlane, no store keys).
Save only after the user approves (section 8).

## 8. Save a recipe

1. Write `$D/recipes/<id>.md` (never a worktree copy).
2. Run `bash "$E/scripts/validate-recipes.sh" "$D"`; fix and repeat until it exits 0.
3. Commit only that file — the pathspec keeps anything else already staged in D out of the commit:
   `git -C "$D" add "recipes/<id>.md" && git -C "$D" commit -m "recipes: update <id>" -- "recipes/<id>.md"`.
   No push.
