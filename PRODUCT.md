# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Orca plugin (`trusted-worker`), no build step: TypeScript loaded as written by Orca, the dashboard as a full-width custom editor (HTML/TS, hand-written SVG and canvas charts, no npm dependencies), a sidebar panel, and a Node worker that reads local data and drives Orca (agents, terminals, workspaces). Lives in `plugin/release-control/` of this repo. The release skills themselves are Markdown skills plus Python/bash engine scripts in `skills/`.

## Users

- **Primary:** a developer who runs many projects (Flutter apps, NestJS/Go APIs, sites) through Orca and its agents. The control panel stays open all day beside their work: they glance at it to see what is unsaved, unpushed or unreleased, and press a button to start the right skill instead of typing it.
- **Secondary:** anyone who installs the same skills and plugin through the share link or the public repo. Their projects, recipes and habits are different, so nothing may assume the author's repos, paths or stacks.

## Product Purpose

Release skills (`/push`, `/pr`, `/deploy`, `/compose`, `/dev`, `/align`, `/updates`, `/status`, `/prompt`, `/dashboard`) that make every agent Orca launches follow each project's own release recipe, never skipping a step. Release Control is their cockpit inside Orca: one place that shows the state of every project and starts any skill in the right workspace with one press. Success: nobody forgets unpushed work or a stale recipe, and a release flow starts without typing.

## Positioning

It is driven by the person's own recipes (`recipes/*.md`, one per project) and Orca's own workspaces and agents. Every button runs the same skill an agent would run by hand, with the same confirmations, rather than a separate CI or deploy tool.

## Operating Context

- Runs inside the Orca desktop app (version 1.4.250 at the time of writing), themed by Orca (light or dark) through its `--orca-*` variables.
- Data comes from local reads: `orca repo list`, git, `skills/orca-release/scripts/status.py --json` and `dashboard.py`, recipes in the data folder, `reports/YYYY-MM-DD.md` (Monday report), and `<repo>/graphify-out/graph.json` when a project has a graphify knowledge graph.
- Actions go through Orca: launch an agent (Claude by default, configurable in settings) in the project's workspace with a skill prompt; open a terminal for `/dev` and compose; open a workspace or file.
- Language of the interface: English. Skills also accept Italian requests and answer in the user's language.

## Capabilities and Constraints

- Nothing irreversible runs from the panel by itself: push, deploy and reset always go through the skill, which asks for confirmation in the agent.
- Read-only on repositories; no network except what a skill does in its own agent.
- Nothing personal is hardcoded: projects, paths and recipes are discovered at runtime.
- Orca plugin limits apply: no network, no npm packages at runtime, worker answers ≤ 1 MiB, posts ≤ 256 KiB.
- Graphify graphs can be large (3,000+ nodes), so the worker sends a summary at the community level.

## Evidence on Hand

- Real data on the author's machine: about 10 Orca repos, 8 recipes, weekly reports, two projects with graphify graphs. Screenshots of it stay private.
- The existing static dashboard (`skills/orca-release/scripts/dashboard.py`) shows what is already computed: branch, unsaved files, unpushed commits, local-only branches, worktrees, recipe status, last tag and commits since, deploy targets, last CI run.
- No screenshots, logos or brand assets exist.

## Product Principles

1. Glance first: what needs attention is readable in two seconds, without scrolling.
2. Every action is the real skill: same confirmations, same recipe, no shortcuts around them.
3. Works for someone else's projects: discover everything, assume nothing.
4. Quiet when all is clean; loud only where something is waiting.
5. Native to Orca: its theme, its workspaces and agents, its conventions.
