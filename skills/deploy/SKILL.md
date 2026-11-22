---
name: deploy
description: Guided deploy/release with the project recipe — pick the target, run its steps in order, confirm before releasing. Use for "/deploy", "deploy to production", "ship it", "rilascia", "fai il deploy".
---

# /deploy

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
   Read `$E/procedure.md` and follow it for everything below.
2. Targets are the `### <name>` headings under `## deploy`. If there is more than one, list them and ask which
   (the user may name it directly: "/deploy android"). A heading ending in `(confirm)` needs an explicit yes before its first step.
3. Pre-flight, reported in one block before the checklist:
   - current branch and `git status --short` (uncommitted changes → ask before continuing);
   - whether HEAD is pushed (`git log --oneline @{u}..HEAD`); unpushed commits → say so and ask.
4. Show the target's checklist, then run it per the shared procedure. Additionally:
   - Before **every** [auto] step that releases, uploads, publishes, migrates or triggers a pipeline
     (e.g. `gh workflow run`, `docker compose … up` on a server, `make deploy`), ask for a yes for that step.
     Build and test steps don't need a separate yes.
   - After `gh workflow run …`: wait a few seconds, then `gh run list --limit 1 --json url,status` and show the run URL.
   - Mobile apps: the recipe builds locally and you guide the upload; never try to upload to App Store / Play yourself.
     After a build, show where the artifact is (`build/ios/ipa/`, `build/app/outputs/bundle/release/`).
   - Lines `- url: …` and `- health: …` under a target are its address and health path, not steps: after the last
     step, if the target has a url, check it (`python3 -I "$E/scripts/work.py" health .`) and report up/down and the version.
5. **Rollback** ("/deploy staging rollback v1.2.0", "go back to the previous release"): say plainly it is a rollback,
   show `python3 -I "$E/scripts/work.py" releases .` and confirm the tag (default: the one before the newest). Run the same
   target's steps for **that tag** instead of HEAD — e.g. trigger the workflow on the tag (`gh workflow run <wf> --ref <tag>`)
   or build from `git worktree add <tmp> <tag>`, never by resetting the user's branch. Ask before the releasing step as
   always; if the recipe's steps cannot target a tag, stop and say what is missing instead of improvising.
6. Summary per shared procedure: target, what ran, what was skipped and why, artifact paths, run/release links,
   and any manual follow-ups still open (tag, release notes).
