---
name: release-setup
description: First-time setup of the release skills — interview, data folder, one recipe per project, optional hint, Quick Commands and Monday report. Use for "/release-setup", "set up the release skills", "configura le skill", or when another release skill finds no configuration.
---

# /release-setup

Rules for the whole setup: talk in the user's language, **one question at a time**; never push, open PRs, deploy,
start or delete containers; only **read** the user's project repos (never edit or commit there); ask before touching
any settings file or creating automations. Works with any agent Orca launches.

1. **Engine.** Find the `orca-release` skill folder: the folder next to this skill's folder
   (`<this skill dir>/../orca-release`), else `~/.agents/skills/orca-release`, else `~/.claude/skills/orca-release`.
   Call it `E`; check `$E/scripts/find-recipe.sh` exists. Read `$E/procedure.md`, `$E/templates/recipe.md`,
   `$E/examples/example-node-api.md`.
2. **Data folder.** If `~/.config/orca-release/root` exists, set `D=$(cat ~/.config/orca-release/root)`, tell the user
   it is already configured there, and still run `bash "$E/scripts/setup.sh" "$D"` (idempotent: records this engine,
   never overwrites). Otherwise propose `~/orca-release-data` (their own git repo for recipes and reports; never the folder the skills were cloned into), confirm, run
   `bash "$E/scripts/setup.sh" <folder>` and set `D` to it. If setup warns about a git commit, help them set
   `git config --global user.name/user.email`. Then continue with step 3 (already configured: offer to add projects).
3. **Projects.** Run `orca repo list` (if Orca's CLI is missing, ask for the project folders). Show the list; ask which
   ones they actually work on and whether there are others outside Orca.
4. **Interview, one project at a time.** First read the repo (README, CLAUDE.md/AGENTS.md, Makefile, package.json,
   pubspec.yaml, go.mod, compose files, `.github/workflows`, `.gitea/workflows`, remote branches,
   `bash "$E/scripts/find-recipe.sh" <repo>` for the stack). Then ask only what the repo doesn't say:
   - PR target branch and conventions (title, description, reviewers);
   - what they run (or should run) before a push;
   - how they release: environments or stores, what CI does, what is manual;
   - which steps they forget most often;
   - whether they use docker compose locally — which file and services (a `*.dev.yml` may be a **server** file: always ask);
   - mobile apps: local build + manual upload, or automated tools?
   Once overall: which git servers (GitHub, Gitea, GitLab, other — for "other" ask the new-PR URL shape for
   `pr_url_template`), editor/IDE, which agents they use in Orca.
5. **Recipes.** For each project draft `$D/recipes/<id>.md` from the template: `[auto]` steps are a single backticked
   command; everything else is manual; mark every step not read in the repo or heard from the user with
   `<!-- inferred: confirm -->`; `## compose` only for local compose (file, `project` = the name the stack already
   uses — see `docker compose ls -a` — services, oneshot, note with ports). Show each recipe, fix it together, then
   save per `$E/procedure.md` §8 (validate, commit only that file in `D`, no push).
   Fill `$D/tech-watch.md` "Using" from the stacks; ask what they would like to try for "Want to try".
6. **Check.** `bash "$E/scripts/find-recipe.sh" <repo>` on two projects must print the right recipe;
   `bash "$E/scripts/scan-recipes.sh"` shows the overview.
7. **Optional extras — ask for each:**
   - *Session hint* (Claude Code only): one line at session start with stack and useful skills.
     Explain it edits `~/.claude/settings.json` and Orca's Claude profile settings (backup first, Orca's own hook untouched).
     On yes: `bash "$E/scripts/register-hint.sh"`.
   - *Orca Quick Commands*: `python3 -I "$E/scripts/quick_commands.py" build --agent <their agent id, e.g. claude or codex> > ~/orca-quick-commands.json`, then
     `python3 -I "$E/scripts/quick_commands.py" guide ~/orca-quick-commands.json` and walk them through adding each entry
     in Orca → Settings → Quick Commands → Add Command (Orca has no CLI for this; never edit Orca's files).
   - *Monday report*: `orca automations create --name "Weekly release report" --trigger weekly --day 1 --time 09:00
     --timezone <their tz> --provider <their agent> --workspace "path:$D" --prompt "Run the weekly-report skill non-interactively" --enabled`
     (D must be added to Orca first: `orca repo add --path "$D"` if `orca repo list` doesn't show it).
8. **Wrap up**, short and personal: configured projects, what `/push /pr /deploy /compose /dev /align /updates /status` do for
   them, which steps are still "to confirm", how to add a project later (run `/push` there: it drafts the recipe).
