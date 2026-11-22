# Changelog

## 1.3.1 — 2026-11-22

Stability pass on Release Control and the engine scripts it reads. No new features; nothing the board shows changes
meaning.

- **Release Control 0.6.1 (worker):** every read uses its own temporary repo list (two overlapping reads, or an old
  worker after a reload, could delete each other's list and empty the board; this was also the flaky rollback test);
  `deactivate` stops the refresh/fetch timers; a failing script or Orca call answers the press with a message instead of
  an error; agents in a workspace that appears late are picked up, and agents of a removed workspace go away; **Stop**
  checks the process is still the same one in the same folder before sending SIGTERM (pids get reused); the code map
  only reads projects on the board and a half-written `graph.json` no longer errors; cleanup and tags load
  independently; changing "Check environments" or "Gitea: use git credentials" refreshes at once.
- **Board:** the log viewer asks once at a time, pauses while the board is hidden, keeps your scroll and selection, and
  closes when you pick another project or search; slower answers for a previous document, log or standup period no
  longer overwrite the current one; an older snapshot never replaces a newer one; a project opened from the board file
  no longer reopens after you close it; focus, caret and collapsed API groups survive refreshes; the new-task text is
  kept per project; a rollback no longer orbits its star for 20 minutes; the orbit alone redraws at ~15 fps.
- **Sidebar panel:** each button tracks its own press (a second press no longer re-enables the first); refresh failures
  are shown; success notes fade.
- **Engine:** `cleanup` never offers a worktree created for a task that has no commit of its own yet, nor one holding
  ignored files other than rebuilt output (`.env.local`, local databases); a detached HEAD is never listed as a branch;
  Gitea credentials are never sent across a redirect, and only to a server that answers like Gitea (ssh aliases such as
  `github-work` resolve to their real host, http ports are kept); `health` only calls http(s) URLs; `releases` lists
  tags in version order and counts commits only between tags on the same line; standup ignores the stash; git reads
  never take `index.lock` and never prompt; undecodable output (logs, lsof) no longer crashes a command; one odd repo
  or OpenAPI file no longer empties the board or a project page; a markdown heading regex that could take minutes is
  now linear; virtualenvs, minified bundles and files over 1 MB are not scanned for endpoints.

## 1.3.0 — 2026-11-21

First public release as **orca-release** (MIT).

- **Your data stays yours:** `install.sh` no longer turns the clone into the data folder. `--data DIR` picks one; without
  it the folder already configured is kept; a checkout that has `recipes/` is its own data folder (the maintainer's
  setup); otherwise `/release-setup` creates one. The default data folder is now `~/orca-release-data`, and setup refuses
  to put recipes inside a clone of the package.
- `tools/export-public.sh` + `tools/public-files.txt`: build the public tree from an allow-list and refuse private
  content; `LICENSE` (MIT); GitHub Actions run the shell tests on macOS.
- **Release Control 0.6.0:** environments (deploy targets with `- url:` / `- health:` in the recipe: up/down, latency,
  deployed version, commits behind; down → "Now"), releases with a guided **rollback** to the previous tag (through
  `/deploy <target> rollback <tag>`), and a **log viewer** for the terminals the board started and the running compose
  services (errors filter, copy). Engine: `work.py health | releases | logs`.
- Tests use neutral example names; `tests/helpers.sh` resolves the real repo path (macOS `/var` vs `/private/var`).

- **Release Control 0.5.0: the work around the code.** Agents that need you (in "Now", a badge on the star, a
  notification, Open); pull requests and CI for GitHub (`gh`) and Gitea (opt-in, with git's stored credentials); what is
  running (dev processes with ports and Stop, compose services); "Your day" standup with Copy; cleanup of merged branches
  and worktrees (two presses, safe git commands only); search across every project (`/`); desktop notifications for
  agents waiting and pushes/deploys landing. New engine script `work.py` (prs, running, standup, cleanup).

- **Release Control 0.4.0: a page per project.** Tabs Overview, Docs, API and Setup, read by the new engine script
  `project_info.py` (read-only, no network): markdown docs with titles and sections and an in-board reader (safe
  renderer, outline), API endpoints from OpenAPI/Swagger, NestJS (prefixes and constants resolved), Express, FastAPI
  and Spring with a per-method bar and filters, scripts with a Run button (terminal, no agent), local URLs, env variable
  names (never values), the latest commits. A wide layout for Docs and API.
- Push/Deploy animations on the map: launch (pulse and comet), an orbit while the agent works, a landing (waves and a
  check) once the data shows it happened; fades only with reduced motion.
- **Fix: buttons that start an agent now deliver the skill.** Orca's `agent.launch` often dropped the prompt
  (`agent_launch_terminal_not_running_agent`), leaving an idle agent; the worker now types it once the agent is ready.

- **Release Control 0.3.0: daily-work features, all without an agent.**
  - The board opens from any project, focused on it (file in `.orca/`, hidden through `.git/info/exclude`).
  - **Fetch** (button, command, and in the background every 30 minutes by default): `git fetch` in every project,
    4 at a time, never prompting; failures are grouped by cause ("server not reachable (VPN off?)", "login needed").
  - **To pull**: commits on the upstream not in the branch yet, as a state, a filter and a **Pull** button
    (`git pull --ff-only`, never a merge or a rebase).
  - **Stop services**: the recipe's compose `stop` in a terminal.
- `status.py`: new "To pull" column and attention line; `dashboard.py` shows "N to pull".
- Fix: board and sidebar buttons without a target failed with "input: Invalid input" (`undefined` is not JSON).

- **Fewer tokens.** Release Control (0.2.0) runs Status, Services and Dev in Orca terminals with the recipe's own
  commands, without launching an agent; it falls back to the skill only when the recipe has no section yet or has
  steps still marked `inferred: confirm`. Graphify updates an existing graph (`--update`) instead of rebuilding it.
  The plugin now asks for `terminal:send` and `terminal:read`: approve it again after reloading.
- Skill descriptions are less than half as long (6.1k → 2.7k characters). Agents read them at the start of every
  session in every project, so each session starts lighter. The key English and Italian phrases are still there.

- **Project graph.** Recipes get an optional `## links` section: `domain`, `domain-label` and typed links
  (`uses-api`, `follows`, `replaces`, `related`) to other recipes or `ext:` systems, checked by the validator.
  The scanner proposes links it finds in each repo's docs (`+ link? …`, `--json-links`); `/align` turns them into
  lines after your OK. `dashboard.py --json` adds domains, confirmed links and the dependencies shared by 2+ projects.

## 1.2.0 — 2026-11-20

Everything is now in English so the project can be made public. Italian requests keep working.

- **Renamed skills:** `/allinea` → `/align`, `/aggiornamenti` → `/updates`, `/stato` → `/status`,
  `/report-settimanale` → `/weekly-report`, `/configura-rilascio` → `/release-setup`. Their descriptions still list
  the Italian phrases, and every skill answers in the user's language. `install.sh` removes its own links with the old names.
- Messages from the scripts, the dashboard page, Quick Command labels, templates, the example recipe, docs
  (`README.md`, `ONBOARDING.md`, `REPRODUCE.md`, `docs/guide.html`) in English.
- Data formats: `status.py --json` reports the recipe state as `ok` / `update` / `none`. `tech-watch.md` sections are
  "Using", "Want to try", "Ignore" (the Italian ones are still read). The weekly report starts with `## Summary`
  (the dashboard also reads the older `## In breve`).
- **Release Control**, an Orca plugin (`plugin/release-control/`): a full-width board showing the projects as a
  constellation (one ring per state, a glow only for release work), "Now" with the skill button for each item,
  commits per week, the Monday report and the graphify community map; a sidebar panel and a status bar item.
  Buttons launch the skill (`/push`, `/pr`, `/deploy <target>`, `/dev`, `/compose`, `/align`, `/prompt`, `/graphify`,
  `/status`) with the agent chosen in its settings, in the project's workspace.
- `dashboard.py --json`: the board's data (stack, commits per week, dev section, compose, graphify).
- `PRODUCT.md` and `DESIGN.md`: product and visual system of the plugin.

After updating: run the Monday automation with the prompt "Run the weekly-report skill non-interactively", and
rebuild your Quick Commands (`quick_commands.py build` + `guide`): the old entries call the old names.

## 1.1.0 — 2026-11-20

- `/prompt`: restructures a rough request into a prompt (goal, context, where to look, constraints, acceptance
  criteria, open questions) and launches it in a new Orca worktree with an agent; history in `prompts/`.
- `/stato` (now `/status`): overview of every Orca repo (`scripts/status.py`).
- `/dev`: new `## dev` section in recipes; compose services and dev processes in Orca terminals.
- `/dashboard`: local HTML page with releases, uncommitted or unpushed work, recipes, report (`scripts/dashboard.py`);
  "📊 Dashboard" Quick Command without an agent.
- Session-start message: shows `/dev` when the recipe has it. Quick Commands: project status, new task, start dev.

## 1.0.0 — 2026-11-20

First shareable version, distributed as an **Orca skills** bundle (`orca skills share`).

- Shared `orca-release` engine (scripts, procedure, templates) separate from personal data
  (`~/orca-release`: recipes, reports, tech-watch), created by `/configura-rilascio` (now `/release-setup`).
- Skills work with every agent Orca launches (Claude, Codex, Gemini, Grok); the session-start message is Claude Code only.
- Git hosts: `github`, `gitea`, `other` (with `pr_url_template`).
- Scripts are always run with `bash` / `python3 -I`: they work even if the install loses the executable bits.
- After every bundle update: run the setup skill again (it re-records the engine path and the hook without touching
  recipes). From the development repo: `./install.sh`.
- `/push`, `/pr`, `/deploy`: per-project checklist and commands from a recipe, confirmation before anything
  irreversible; PRs on GitHub (`gh`) or the compare page on Gitea and similar hosts.
- `/compose`: local services (up waiting for healthy, stop, status, logs, reset with confirmation),
  one stack per project shared by its worktrees, "oneshot" services.
- Session-start message (SessionStart hook): stack, useful skills, a warning when the recipe has drifted.
- `/allinea` (now `/align`) + `scripts/scan-recipes.sh`: recipes compared with the real state of the repos;
  `<!-- ignore: … -->` markers.
- `/aggiornamenti` (now `/updates`): outdated dependencies (read-only) and news on the technologies in `tech-watch.md`.
- `/report-settimanale` (now `/weekly-report`): non-interactive report, meant for a Monday Orca automation.
- Orca Quick Commands: `scripts/quick_commands.py build|guide`.
- `ONBOARDING.md` (guided setup for a person), `REPRODUCE.md` (rebuild from scratch, for an agent),
  `docs/guide.html` (illustrated guide).
