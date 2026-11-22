# REPRODUCE.md — rebuild the Orca release skills from scratch

> **For the agent reading this.** This file alone is enough to rebuild, on another machine, the system that lives in
> this repo: skills for the agents Orca launches (Claude Code, Codex…) that guide push, PR, deploy and local services
> for each project, keep the projects' "recipes" aligned, check for updates and produce a weekly report, plus the
> Release Control board (an Orca plugin).
> If the repo is already available and only needs setting up for a person, use `ONBOARDING.md` instead.
>
> Rules while rebuilding: work in a dedicated worktree or branch; tests before code; no push, deploy or
> `docker compose up/down` on the user's projects; the user's projects are only read; ask before touching settings
> files (`~/.claude/settings.json`, Orca profiles).

## 1. Why it exists

- The user works on many repos (Flutter, NestJS+Prisma+Docker, Go, Astro, Swift) on several git servers
  (GitHub, a company Gitea, another Gitea-like server behind a VPN) and **forgets steps** and **mixes up the commands**
  of each project.
- Goal: short commands (`/push`, `/pr`, `/deploy`, `/compose`) that know "how it's done" in **that** project,
  show the checklist, run the steps in order and ask for confirmation before anything irreversible.
- Non-goals: an agent that invents commands; push/deploy/data deletion without an explicit yes; using a server
  compose file locally; ~50 near-identical skills (one per project × activity).

## 2. Architecture

Two separate folders, recorded in `~/.config/orca-release/`:
- **engine** (`engine`): the `orca-release` skill — shared code, installed by Orca, never edited by hand;
- **data** (`root`): the user's own folder, a git repo of theirs — `recipes/`, `reports/`, `tech-watch.md`.
This way the shared bundle (`orca skills share`) can never contain anybody's projects.

```
development repo (= also its author's data folder)
├── install.sh                   developer install: skill symlinks, config, hook (refuses worktrees)
├── skills/                      ← ONLY this folder is shared as Orca skills
│   ├── orca-release/            engine
│   │   ├── SKILL.md  procedure.md        common procedure: find recipe → checklist → steps → confirmations → summary → save
│   │   ├── templates/recipe.md  templates/tech-watch.md  examples/example-node-api.md
│   │   └── scripts/             lib.sh find-recipe.sh validate-recipes.sh pr-url.sh compose-cmd.sh
│   │                            scan_recipes.py(+.sh) outdated-cmds.sh session-hint.sh register-hook.py
│   │                            register-hint.sh quick_commands.py setup.sh status.py dev-cmds.sh dashboard.py
│   ├── release-setup/           guided setup for a person (interview → setup.sh → recipes → extras)
│   └── push/ pr/ deploy/ compose/ align/ updates/ weekly-report/ prompt/ status/ dev/ dashboard/
├── plugin/release-control/      Orca plugin: full-width board, sidebar panel, status bar item
├── recipes/<id>.md              data: one recipe per project
├── reports/  tech-watch.md      data
├── tests/                       bash: run.sh runs every test_* function in a subshell (not shared)
└── ONBOARDING.md, REPRODUCE.md, README.md, CHANGELOG.md, VERSION, PRODUCT.md, DESIGN.md, docs/guide.html
```

Every skill starts with `E=$(cat ~/.config/orca-release/engine); D=$(cat ~/.config/orca-release/root)`; if they are
missing, it points to `release-setup`. Skills work with every agent Orca launches (Orca reads them from
`~/.agents/skills`; the install also links them into `~/.claude`, `~/.gemini`, `~/.grok`); the hint is Claude Code only.
Skill names and texts are in English; descriptions also list Italian trigger phrases, and skills answer in the
user's language.
Principle: **generic engine + per-project data**. Skills contain no project commands; they read them from the recipe.

## 3. Recipe format (contract)

```markdown
---
id: my-app                        # = file name
match:
  remotes: ["gitea.example.com/org/my-app"]   # any URL form, compared after normalization
  paths: ["~/Development/my-app"]             # used when there is no remote
host: gitea                       # github | gitea | other
base_branch: main
pr_url_template: ""               # optional (other): {remote} {base} {branch}
---
## push
- [ ] `flutter analyze`                         ← [auto]: ONE backticked command → the agent runs it
- [ ] no debug prints in the diff               ← [manual]: anything else → the user confirms
- [ ] `flutter test` <!-- inferred: confirm --> ← guessed, to confirm
## pr
- title: `<type>: <summary>`
## deploy
### ios (confirm)                               ← target; (confirm) = yes before starting
- [ ] `flutter build ipa --release`
## compose                                      ← optional
- file: `docker-compose.yml`
- project: my-app                               ← compose project name the stack ALREADY uses (keep the data)
- services: postgres mock                       ← absent = every service without a profile
- oneshot: create-bucket                        ← services that start and exit
- note: Postgres 5433
- up: `make dev-up`                             ← optional overrides up/stop/reset (one backticked command)
## dev                                          ← optional: long-running dev processes, one per Orca terminal
- [ ] `npm run start:dev`
## links                                        ← optional: domain and typed links (proposed by /align, confirmed)
- domain: shop
- uses-api: shop-api                            ← uses-api | follows | replaces | related → recipe id or ext:<Name>
```

Rules: `step_kind` = `command` only if the whole text is a single backticked span (+ optional HTML comment);
mixed text → `manual`. The validator enforces: id = file name; valid host; base_branch; at least one match;
push/pr/deploy sections; no remote duplicated across recipes; in `## compose`, `file` and `project` required,
no `*.dev.yml` without `<!-- local: confirmed -->`, overrides = a backticked command.

## 4. Components: contracts

- **normalize_remote**: `git@h:o/r.git`, `https://u:tok@h/o/r.git`, `ssh://git@h:2222/o/r`, trailing slash → `h/o/r`
  lowercase, without credentials (never print them).
- **find-recipe.sh [dir]** → lines `root`, `remote`, `recipe <path|none>`, `stack <marker…>`, `compose <file|none>`.
  Match by remote, then by path (including a worktree's main checkout). Exit 2 if several recipes match
  (an error, not "first wins"), 3 not a git repo, 4 root not configured. Files starting with `_` are ignored.
  Stack markers: flutter ios android go node python docker make gh-actions gitea-actions.
- **compose-cmd.sh <recipe> <action> [service]**, `C = docker compose -p <project> -f <file>`:
  up = `C up -d <oneshot>` then `C up -d --wait <services − oneshot>`; stop = `C stop <services>`; status = `C ps -a`;
  logs = `C logs --tail 100 …`; reset = `C down -v`; volumes = `C config --volumes`. No trailing spaces.
- **scan_recipes.py** (`scan-recipes.sh` is a wrapper; read-only, no network, **always exit 0**).
  Options: `--root R` (else `ORCA_RELEASE_ROOT`, then `~/.config/orca-release/root`, then the script's folder),
  `--repo DIR` (only the recipe `find-recipe.sh DIR` finds; repo folder = toplevel of DIR),
  `--status` (prints only `ok` | `update` | `missing`, or `none` if `--repo` finds no recipe).
  Without `--repo`: every non-`_*` recipe; repo folder = first existing `match.paths`, else `missing`.
  Output per project: `## <id> — ok`, `## <id> — ok (N to confirm)`, `## <id> — out of date (N)` + lines,
  `## <id> — repo not found`, `## <id> — scanner error: <exception>` (one error doesn't stop the other recipes;
  with `--status` it counts as `ok`). Files read with `errors="replace"`.
  Lines: **✗** broken commands — in [auto] steps and compose overrides `up/stop/reset`, skipping commands that
  contain `cd `: `make t` with no target in the `Makefile`, `npm run s`/`npm test` with no script in `package.json`,
  `gh workflow run f` with no `.github/workflows/f`; missing compose file; a `services`/`oneshot` service missing from the file;
  `base_branch` missing as `refs/remotes/origin/<b>` (only if `origin` exists); `package.json` unreadable or not an object.
  **+** new things — npm scripts `lint test build check typecheck format:check` and make targets `lint test build check`
  not mentioned (`npm run s`, `npm test`, `make t`), `*.yml|*.yaml` workflows whose file name doesn't appear in the recipe,
  a root compose file without `## compose`. A line `<!-- ignore: npm:<s> make:<t> wf:<file> compose -->` in the
  recipe silences the matching items. **?** = number of `<!-- inferred: confirm -->` comments (does not make it "out of date").
  **+ link? <id>** — another project's id, folder name or remote segment (names under 4 characters only as
  `owner/name`) found as a whole word in `CLAUDE.md`, `AGENTS.md`, `README.md`, `.env.example`, `docs/*.md`,
  `dart_define*.json`, `docker-compose*.yml` or the `package.json` description; at most 2 evidence lines per pair; skipped
  when already in `## links` or ignored with `<!-- ignore: link:<id> -->`; never makes a recipe out of date.
  `--json-links` prints them as JSON for `/align`. `links.py check` validates `## links` (called by `validate-recipes.sh`).
  The hint adds `⚠ recipe out of date: /align` exactly when `--repo <root> --status` prints `update`.
- **outdated-cmds.sh DIR** (exit 0; commands to run inside DIR, one per line, never install/upgrade):
  `package.json` → `npm outdated`; `pubspec.yaml` **and** `pubspec.lock` → `flutter pub outdated` on a temporary copy
  of both files (run in the repo it can rewrite `pubspec.lock`/`.dart_tool`); `go.mod` → `go list -u -m all`;
  `requirements.txt`/`pyproject.toml` with `.venv/bin/python` → `.venv/bin/python -m pip list --outdated`.
- **session-hint.sh**: JSON `{"systemMessage": L, "hookSpecificOutput": {"hookEventName": "SessionStart",
  "additionalContext": L}}` with L = `📦 <repo> · <stack> · skill: /compose /dev /push /pr /deploy[ · no recipe: /push creates one][ · ⚠ recipe out of date: /align]`.
  Silent (no output, exit 0) outside a git repo, without a root, or when there is neither a recipe nor a compose file.
  Always exit 0, < 1 s, no network or docker.
- **register-hook.py <settings.json> <cmd>**: adds `{"matcher": "startup", "hooks": [{"type": "command",
  "command": cmd, "timeout": 5}]}` to `hooks.SessionStart`; the command contains the marker `orca-release-hint`;
  removes only entries with that marker; no write if already identical; `.orca-release.bak` backup once;
  atomic write keeping permissions; broken JSON → error, file untouched.
- **install.sh** (main checkout only: refuses if `git-dir ≠ git-common-dir`): checks every destination first
  (refuses folders/links it doesn't own, never a half install); removes its own links with the pre-1.2.0 Italian names
  (`allinea`, `aggiornamenti`, `report-settimanale`, `configura-rilascio`, `stato`); symlinks every skill into
  `~/.claude/skills` and `~/.agents/skills` (Codex); writes `~/.config/orca-release/root` and `engine`; registers the hook in
  `~/.claude/settings.json` **and** every `~/Library/Application Support/orca/claude-profiles/*/home/settings.json`.
- **quick_commands.py build|guide**: global "agent prompt" entries for `/push /pr /deploy /compose /align /updates
  /status /prompt /dev`; per project with compose, terminal commands `▶ Start services`/`■ Stop services`/`Services status`
  (`cd "$(git rev-parse --show-toplevel)" && …`, `action: terminal-command`, `appendEnter: true`). Never the reset.
  Also the global terminal command "📊 Dashboard" (`python3 -I "<engine>/scripts/dashboard.py"`). `guide` prints the
  list to add by hand. `--agent` picks the agent.
- **status.py [--repo-list F] [--json]** (read-only, no fetch): for each repo in `orca repo list` → branch,
  `git status --porcelain` count, commits ahead of `@{u}` (or never pushed, without upstream), local-only branches,
  worktrees with uncommitted files, recipe state (`ok` / `update` / `none`); markdown table + "Needs attention";
  missing repo → "folder not found".
- **dev-cmds.sh <recipe>**: the [auto] commands of `## dev` in order (long-running processes, one per Orca terminal); exit 2 without the section.
- **dashboard.py [--repo-list F] [--out P] [--online] [--no-open] [--json]**: self-contained HTML (no external resources,
  no JS, all text escaped) in `<data>/dashboard/index.html` (ignored by git): KPIs (`data-kpi=projects|dirty|push|unreleased|recipes`),
  one card per project (state, last tag + date, commits since the tag, deploy targets, CI with `--online` via `gh run list`),
  "To do", the "Summary" of the latest report (older reports: "In breve"), tag timeline; missing projects last. Never published.
  `--json` prints the same data for the plugin, plus per project `stack`, `weeks` (commits per week, 12 weeks, oldest first),
  `has_dev`, `compose`, `graphify` (has `graphify-out/graph.json`), `recipe_file`, `remote`, `domain`, `domain_label`,
  `links` (confirmed only, targets that are not recipe ids or `ext:` dropped), `deps` (direct dependencies via `deps.py`,
  reduced to the shared ones), and top-level `shared_deps: {name: {path: version}}` for names used by 2+ projects.

## 5. The skills (what they must enforce)

Common procedure (`orca-release/procedure.md`): find the recipe (errors → clear stop) → without a recipe: draft from the repo
(markers, Makefile, package.json, workflows, CLAUDE.md), shown and saved only after an OK → full checklist with
[auto]/[manual] → steps in order, never unwritten commands, on failure "fix / skip with reason / abort" →
explicit confirmation before push, PR, deploy, `(confirm)` targets → summary → offer to update the recipe →
saving: write in ROOT, validate, `git commit -m "recipes: update <id>" -- recipes/<id>.md` (pathspec!), no push.

- `/push`: branch = base → ask; uncommitted changes → commit or leave them (stash only on request, tagged, with its
  SHA, `stash apply <sha>`: the stash is shared across worktrees); upstream with a different name = no upstream →
  `git push -u origin <branch>`; never `--force`.
- `/pr`: push first if needed; title/body from `git log/diff origin/<base>...HEAD`; GitHub `gh pr create`;
  Gitea/other: body to the clipboard (`pbcopy`) + `open` the compare page.
- `/deploy`: targets from `### …`; confirmation for every step that releases; mobile = local build + manual upload.
- `/compose`: action from the user's words; Docker running?; commands from `compose-cmd.sh`; for `reset` show the volumes,
  warn that the data is shared by every worktree and ask for a yes **before** running; busy ports → show who holds them.
- `/align`: scanner → before/after proposal per project → save after OK; then resolve the "to confirm" steps.
- `/updates`: read-only; `outdated-cmds.sh` per project + web search on the technologies in `tech-watch.md`
  ("Using", "Want to try", "Ignore"; older Italian headings accepted); report 🔴 security / 🟠 breaking / 🟡 recommended /
  🟢 news / 🔭 to try; never upgrades.
- `/prompt`: reads real context (recipe, CLAUDE.md, files mentioned) → prompt Goal/Context/Where to look/Constraints/
  Acceptance criteria/Open questions → resolves the questions with the user → explicit yes → saves in `<data>/prompts/` →
  `orca worktree create --repo path:<repo> --name <slug> --base-branch <base> --no-parent --agent <agent> --prompt "…"`. Does not do the task.
- `/status`: `status.py` + open PRs (`gh pr list`, GitHub only) + `orca worktree ps`; ends with "Do now" (max 5), offers without doing.
- `/dev`: compose up (if any), then each line of `dev-cmds.sh` with `orca terminal create --worktree current --title "dev: …" --command …`;
  reads the terminals after ~10 s; never long-running processes in the agent's session.
- `/dashboard`: runs `dashboard.py` and summarizes "To do"; the page stays local.
- `/weekly-report`: non-interactive; scanner + updates → `reports/<date>.md` with English headings (`## Summary` first),
  content in the language of `tech-watch.md`; commits that file only.

## 6. Release Control (Orca plugin)

`plugin/release-control/`, `trusted-worker`, no build step. The worker lists Orca's workspaces (`workspace.list`), finds
each repository's main checkout with `git rev-parse --git-common-dir`, writes a repo list and runs
`dashboard.py --json --repo-list …`; it maps each project to its workspace and launches skills with
`agent.launch({ workspaceId, agent, prompt: "/push" })` then `workspace.open`. The board is a custom editor for
`<data>/dashboard/board.releasecontrol` (opened with `editor.open`, path **relative** to the workspace); the sidebar
panel is a components panel; a status bar item keeps the worker alive and shows "N need attention". Events
`workspace.created/removed` and `agent.status.changed` (done) trigger a refresh. Design: `PRODUCT.md`, `DESIGN.md`.
Tests: `orca plugin test`, `orca plugin check`.

## 7. Pitfalls found (don't repeat them)

1. **Orca and Quick Commands**: settings live in `~/Library/Application Support/orca/profiles/<id>/profile-state.db`
   (SQLite, table `profile_state_documents`, with `revision` and `content_hash`); `orca-data.json` is no longer read.
   No CLI command edits them → they are added by hand (Settings → Quick Commands). Entry shapes:
   terminal `{id,label,action:"terminal-command",command,appendEnter,scope}`, agent
   `{id,label,action:"agent-prompt",agent:"claude",prompt,scope}`, scope `{"type":"global"}` or `{"type":"repo","repoId"}`
   (id from `orca repo list`).
2. **Orca copies `~/.claude/settings.json` into each profile** and adds its own SessionStart hook
   (`ORCA_AGENT_HOOK_*`): don't touch it, register yours in every file.
3. **SessionStart hook**: without `matcher: "startup"` it fires again on resume, `/clear` and compaction.
4. **Permissions**: rewriting `settings.json` through a temp file makes it 0644 → `copymode`.
5. **Worktrees**: Orca sessions often run in worktrees. Recipes, install and writes go to the main checkout;
   path matching must accept a worktree's main checkout.
6. **docker compose `up --wait`** fails (exit 1) if a service is a container that exits with 0
   (e.g. bucket creation): start it separately (`oneshot`).
7. **Server compose files**: in some projects `docker-compose.dev.yml` is the file the release workflow uses on the
   server (`/srv/...`), not for local development.
8. **Shared compose project**: fixed ports and `container_name` → one stack per project, `-p <name already in use>`
   to reuse existing volumes; two projects can use the same host port (e.g. 5433): note it.
9. **`git commit -m …` without a pathspec** includes everything already staged: use `-- <file>`.
10. **bash 3.2 on macOS**, BSD sed/awk; `zsh` doesn't split `$VAR` into words (use `bash -c` or arrays).
11. **Tests that pass vacuously**: `a && b || fail` across lines hides failures; a test that passes before the
    implementation must be rewritten.
12. **Bytecode in the shared engine**: importing `status.py` from `dashboard.py` writes `__pycache__` with absolute
    paths → `sys.dont_write_bytecode = True`, `*.pyc` ignored, a test checks `skills/` has none.
13. **Orca plugins**: `editor.open` wants a workspace-relative path; `orca plugin shot --act` refuses while Orca's window
    is visible; `--theme` only applies with the window hidden.

## 8. Build order (each step: red tests → code → green tests → commit)

1. `tests/helpers.sh` + `tests/run.sh`; `lib.sh` + `find-recipe.sh`.
2. `install.sh` (links + root, refuses worktrees and foreign folders).
3. `templates/recipe.md`, `step_kind`, `validate-recipes.sh`, `procedure.md`.
4. `pr-url.sh`; skills `push`, `pr`, `deploy`.
5. Initial recipes by reading the user's repos (`orca repo list`), guessed steps marked `inferred: confirm`.
6. `section_get` + `compose-cmd.sh` + compose rules in the validator; skill `compose`; check `--wait` on a test compose file.
7. `session-hint.sh` + `register-hook.py` + registration in `install.sh`.
8. `quick_commands.py` (build/guide).
9. `scan_recipes.py`, `outdated-cmds.sh`, `tech-watch.md`; skills `align`, `updates`, `weekly-report`; ⚠ in the hint.
10. Monday Orca automation:
    `orca automations create --name "Weekly release report" --trigger weekly --day 1 --time 09:00 --timezone <tz> --provider claude --workspace <main checkout> --prompt "Run the weekly-report skill non-interactively" --enabled`
11. Independent review of the whole branch, fixes with tests, merge, `./install.sh`, try `session-hint.sh` in a project.
12. `setup.sh` + skill `release-setup`; test that `skills/` contains no personal names; share with
    `orca skills share --skill … --bundle-name "Orca release skills"` (needs Settings → Share Skills).
13. `status.py`, `dev-cmds.sh`, `dashboard.py`; skills `status`, `dev`, `prompt`, `dashboard`.
14. The Release Control plugin (section 6).

## 9. Final check

- `bash tests/run.sh` all green; `skills/orca-release/scripts/validate-recipes.sh .` exit 0; `scan-recipes.sh` readable;
  `orca skills installed` lists every skill.
- `grep -c orca-release-hint ~/.claude/settings.json` = 1 (and in every Orca profile), Orca's hook intact, valid JSON.
- In a project with compose, a new session shows `📦 … · skill: /compose /push /pr /deploy`.
- Quick Commands added following `quick_commands.py guide`.
- `orca plugin test plugin/release-control` and `orca plugin check plugin/release-control` green.
