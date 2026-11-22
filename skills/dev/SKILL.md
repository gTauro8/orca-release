---
name: dev
description: Start local development the way the recipe says — compose services first, then each dev process in its own Orca terminal. Use for "/dev", "start dev", "run the app locally", "avvia lo sviluppo", "tira su l'ambiente".
---

# /dev

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
   Read `$E/procedure.md` (finding the recipe, drafting, saving).
2. **No `## dev` section:** draft one from the repo (`package.json` scripts like `start:dev` / `dev`, `Makefile` targets like
   `run` / `dev-*`, `flutter run`, `go run ./cmd/...`), one `- [ ] \`command\`` per long-running process plus manual
   steps such as "open http://localhost:3000"; mark guesses `<!-- inferred: confirm -->`; show the draft and
   wait for an explicit yes before saving or running anything; then save per §8.
3. **Services first:** if the recipe has `## compose`, follow the `compose` skill's `up` (read `$E/../compose/SKILL.md`):
   Docker running, `bash "$E/scripts/compose-cmd.sh" <recipe> up`, wait for healthy. Stop here if it fails.
4. **Dev processes:** for each line of `bash "$E/scripts/dev-cmds.sh" <recipe>` — but never auto-run a step marked
   `inferred: confirm` (list it and ask first), and check `orca terminal list --json` so a "dev: …" terminal that is
   already running is not started twice — start it in its own Orca terminal in the current worktree, without blocking this session:
   `orca terminal create --worktree current --title "dev: <short name>" --command '<command>' --json`
   (single-quote the command; write a `'` inside it as `'\''`, so nothing expands in this shell).
   (Outside Orca, or if that fails: tell the user to run the command in a terminal; don't start long-running
   processes inside this session.)
5. After ~10 s read each terminal (`orca terminal read --terminal <handle> --json`, last lines) and report
   started / failed with the error. Port in use → show the owner (`lsof -iTCP:<port> -sTCP:LISTEN -n -P`), never kill without a yes.
6. Show the manual steps of `## dev` (URLs to open, logins) and the recipe compose `note` (ports).
   To stop: close those terminals in Orca; `/compose` stop for the services.
