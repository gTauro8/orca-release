# Release Control (Orca plugin)

A release board for the orca-release skills, inside Orca.

- **Opens from any project.** "Release Control: Open Board", the status bar item and the sidebar button open the board
  inside the project you are working in, already showing it. The board file goes in `.orca/` and is hidden from git
  through `.git/info/exclude` (local only: nobody's `.gitignore` changes). From the data folder it opens there as before.
- **Full-width board** (an editor tab): your projects as a constellation, linked to the technologies they use. A
  coloured ring tells what is waiting: uncommitted, to push, to release, recipe out of date. Only projects with
  release work pending glow. On the right: "Now", commits per week, the project list and the Monday report. Pick a star
  to see its state, skills, a new-task box, its commits and its graphify code map.
- **Project page**: pick a star and its page has four tabs, read from the repo on this machine (no network, no agent):
  - **Overview**: what is waiting, the skills, "At a glance" (documents, endpoints, scripts), state, links, commits per
    week, the latest commits, the code map.
  - **Docs**: every README / CHANGELOG / CLAUDE / `docs/**` markdown file with its title and sections; open one to read it
    right there (with an outline to jump through) or in Orca's editor. Rendering escapes everything: no HTML from a
    document reaches the page.
  - **API**: the endpoints found in OpenAPI/Swagger files and NestJS, Express, FastAPI and Spring code (NestJS
    prefixes and string constants resolved; `≈` marks a path built from code that is not a plain string), a bar per
    HTTP method, filters, and a click opens the handler's file.
  - **Setup**: package.json scripts and Makefile targets with a **Run** button (a terminal, no agent; only scripts the
    project declares), the localhost URLs from the docs, and the environment variable *names* from `.env.example`-like
    files (values are never read; click to copy).
- **Agents that need you**: every agent Orca runs in a project; the ones waiting or blocked go first in "Now", get a pink
  badge on their star and a desktop notification, and **Open** shows their workspace. The status bar says "N agents waiting".
- **Pull requests and CI**: open PRs per project (yours, and the ones asking for your review), changes requested on yours,
  the last CI run (red CI lands in "Now"). GitHub through `gh`; Gitea through its API with the credentials git already
  stores, only if you turn on **Gitea: use git credentials** (never prompts). Updated on startup and with every Fetch.
- **Running**: dev processes listening on a port inside each project (agent CLIs excluded) with links to their ports and a
  **Stop** (SIGTERM, only for a process the board found there, two presses), and the compose services that are up.
- **Your day**: your commits in every project and branch since yesterday, this week or 7 days, with **Copy as text** for
  the standup. No agent.
- **Clean up**: local branches already merged into the default branch and merged worktrees with nothing uncommitted;
  **Delete** / **Remove** after a second press, with git's safe commands (`branch -d`, `worktree remove`).
- **Search** (`/`): one box for every project's names, documents and sections, endpoints, scripts and env names; a result
  opens the right page, tab and document.
- **Environments**: every deploy target with a `- url:` in the recipe: up/down, latency, the version it runs and how far
  behind the default branch it is; one that is down goes into "Now". Turn it off with **Check environments**.
- **Releases and rollback**: the version tags with their dates and commits, what is unreleased, and **Roll back <target>
  to <previous tag>** (two presses): the deploy skill runs the target's own steps for that tag and asks before releasing.
- **Logs**: the last 200 lines of every terminal the board started (services, dev, scripts, pull) and of each running
  compose service, refreshed every 3 s, with an **Errors** filter and **Copy**. No agent.
- **Release animations**: pressing Push or Deploy sends a comet up from the project's star and a dot orbits it while
  the agent works; when the data shows the push or release landed, two waves and a check. With reduced motion: fades
  only, no movement.
- **Sidebar panel**: what is waiting, with the skill button next to each line, and "Open the board".
- **Status bar**: "N need attention"; click it to open the board.

Reading the board costs no model tokens: it runs `git` and the engine's `dashboard.py`, nothing else.

Buttons spend tokens only when a step needs judgement:

| Button | What runs | Agent? |
|---|---|---|
| Status | `status.py` in a terminal of the data folder | no |
| Fetch | `git fetch --all --prune` in every project (4 at a time, never asks for a password), then a refresh; failures say why ("server not reachable (VPN off?)", "login needed"…) | no |
| Pull | `git pull --ff-only` in a terminal: moves the branch forward or stops, never merges or rebases | no |
| Stop services | the recipe's compose `stop` commands in a terminal | no |
| Services | the recipe's `## compose` commands (`compose-cmd.sh … up`) in a "services" terminal | no |
| Dev | services first, then one "dev: …" terminal per `## dev` command, once the services are up | no |
| Push, PR, Deploy, Align, New task | the real skill (`/push`, `/pr`, `/deploy <target>`, `/align`, `/prompt …`) | yes |
| Graphify | `/graphify . --update` when a graph exists (only changed files), `/graphify .` otherwise | yes |

Agents get their skill even when Orca drops it: Orca sends the prompt right after starting the CLI and loses it when the
agent is not up yet (`agent_launch_terminal_not_running_agent` in `orca plugin logs`). The worker then waits for the
agent's screen to settle and types the skill itself, only if it is not already on the input line.

Services and Dev fall back to the `/compose` and `/dev` skills when the recipe has no section for them yet or still has
steps marked `inferred: confirm`: those need an agent to draft or ask. Pressing Dev or Services again while their
terminals are open just shows the workspace. The confirmations are the skills' own: the board never pushes or
releases anything by itself.

## Requirements

- Orca ≥ 1.4.248 with plugins turned on (Settings → Plugins).
- The release skills installed and set up (`~/.config/orca-release/engine` and `root`), with an engine that supports
  `dashboard.py --json` (skills ≥ 1.2.0).
- The data folder (recipes, reports) added to Orca as a project: the board opens as the file
  `dashboard/board.releasecontrol` inside it.
- `python3` and `git`.

## Install

```bash
orca plugin dev load <path>/plugin/release-control --json
```

Orca replies with the list of permissions and an `--approve <fingerprint>` command. Run it after reading the list.
The plugin asks for:

| Permission | Why |
|---|---|
| `trusted-worker` execution | reads git and runs the engine's `dashboard.py` |
| `workspace:read` | finds the repositories and their workspaces, refreshes when one is created |
| `workspace:write` | opens the workspace, the recipe and the board |
| `agent:read` | refreshes when an agent finishes |
| `agent:launch` | starts the skill in the project's workspace |
| `terminal:send` | runs Status, Services and Dev in terminals, without an agent |
| `terminal:read` | waits for the services to be up before starting the dev processes |
| `notifications:show` | tells you when an agent needs you or a push/deploy landed (both can be turned off) |
| `storage:own`, `settings:own` | keeps the last state and the settings |

Settings (Settings → Plugins → Release Control): **Agent to launch** (Claude by default; also Codex, Gemini, Grok and
OpenCode), **Refresh every (minutes)** and **Fetch every (minutes)** (30 by default, 0 turns the background fetch off).

Commands: "Release Control: Open Board", "Release Control: Fetch All Projects", "Release Control: Refresh Data".

A project with commits on its upstream that are not in the branch yet (after a fetch) shows **To pull** (teal ring, a
chip, a "Pull" button in "Now").

## Development

```bash
orca plugin test . --json      # model and worker (fake engine, temporary git repo)
orca plugin check . --json     # sidebar panel in 3 scenarios, static editor check
orca plugin dev reload . --json
orca plugin shot . --editor <data folder>/dashboard/board.releasecontrol --width 1440 --height 900
```

A `.releasecontrol` file may name a project to open, e.g. `{"select": "/path/to/repo"}`. That is how screenshots show
the detail view. The board never writes to the file.

- `src/worker.ts`: data (Orca's workspaces, then `dashboard.py --json`), actions, status bar and events.
- `src/model.ts`: pure rules (states, what is waiting, skill prompts, graphify summary), shared by every surface.
- `src/board.ts`, `src/constellation.ts`, `src/charts.ts`, `src/styles.ts`: the board.
- `src/panel.tsx`: the sidebar panel.

Design: `PRODUCT.md` and `DESIGN.md` at the repo root.
