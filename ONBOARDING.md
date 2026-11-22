# Release skills for Orca: getting started

These skills give anyone working in Orca (with Claude, Codex or another agent):

- `push`, `pr`, `deploy`: the right checklist and commands for **each** project, never skipping a step, and a
  confirmation before anything irreversible;
- `compose` and `dev`: start, stop or reset the local services (db, mocks) with the right compose file, then the
  project's dev processes, each in its own Orca terminal;
- `status`: every project at a glance — uncommitted work, unpushed commits, worktrees, recipes to fix;
- `align`: tells you when a recipe no longer matches its project, and updates it;
- `updates`: outdated dependencies and news on the technologies you use or want to try;
- `prompt`: turns a rough request into a structured prompt and starts it in a new worktree;
- `weekly-report`: a report ready every Monday (optional Orca automation);
- `dashboard`: a local HTML page with the state of every project.

Each project is described by a **recipe** built on your own habits, in a folder of yours (`~/orca-release-data`).

## 1. Install the skills in Orca

Open the link you received (bundle "Orca release skills") and install it in Orca. The bundle contains the shared
engine `orca-release` and the skills above, plus `release-setup`. It contains nobody's projects.

## 2. Set up

Open a session in Orca (in any project) and write:

```text
set up the release skills for me
```

(or `/release-setup`; Italian works too: "configura le skill di rilascio"). The agent:

1. creates `~/orca-release-data` (a git repo of yours for recipes and reports);
2. reads your projects from Orca and asks which ones you work on;
3. for each project reads the repo and asks only what the repo doesn't answer
   (PR branch, checks before a push, how you release, what you tend to forget, docker compose…);
4. writes one recipe per project, shows it to you and saves it only after your OK;
5. offers, asking each time: a one-line hint when a session starts (Claude Code only), Orca Quick Commands,
   the Monday report.

During setup nothing is pushed, deployed or started, and your projects are only read.

## 3. Use

Inside a project: `/push`, `/pr`, `/deploy`, `/compose`, `/dev` (or just say "push this branch", "open a PR",
"deploy to staging", "start the services"). From time to time: `/status`, `/align` and `/updates`.

- New project: run `/push` there; the skill drafts the recipe.
- A step changed: say so during `/push` or `/deploy`; the skill offers to update the recipe.
- Updating the skills: install the new link; your recipes in `~/orca-release-data` are left untouched.

## 4. Optional: the Release Control board

The Orca plugin in `plugin/release-control/` shows every project as a constellation lit by its release state, with a
button for each skill. See its README for installation.
