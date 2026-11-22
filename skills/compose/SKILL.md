---
name: compose
description: Start, stop, inspect or reset the project's local services (docker compose) from its recipe; never deletes data without a yes. Use for "/compose", "start the services", "bring up the db", "avvia i servizi", "ferma il db".
---

# /compose

Local support services for development only. The app itself is run by the user.

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
   Read `$E/procedure.md` and follow it for finding the recipe, confirmations and the summary.
2. **Action** from the user's words: `up` (default: "start", "bring up"), `stop`, `status` ("what is running"),
   `logs [service]`, `reset` ("wipe the db") — or the Italian equivalents ("avvia", "ferma", "stato", "log", "resetta"). If unclear, ask.
3. **No `## compose` section:**
   - no recipe at all → draft the full recipe (shared §7) and include `## compose` as below;
   - recipe without the section → draft only the section:
     - `file`: `docker-compose.yml`, else `compose.yaml` / `compose.yml` at the repo root. **Never** a `*.dev.yml` / `*.dev.yaml`
       (it may be a file used on a server: ask). If only such a file exists, stop and ask.
     - `services`: services **without** `profiles:` in that file; `oneshot`: those among them with `restart: "no"` / `'no'`.
     - `project`: the name the stack already uses, so data is kept — `docker compose ls -a --format json`, pick the entry whose
       `ConfigFiles` contains this file; otherwise the folder name of the project's main checkout.
     - `note`: published ports per service (from `ports:`).
   Show it, save per shared §8, then continue.
4. **Docker running?** `docker info >/dev/null 2>&1`. If it fails: ask the user to start Docker Desktop and stop.
5. **Commands:** `bash "$E/scripts/compose-cmd.sh" <recipe> <action> [service]` prints the exact commands, one per line.
   Run them in order **from the root of the repo the user is in** (the `root` line of find-recipe.sh). Never edit them.
   For `reset`, do step 7 first: run nothing from the reset output until the user has said yes.
   The `-p <project>` in them means every worktree of this project shares the same containers and data.
6. **After `up`:** run the `status` command, then print the recipe `note` (ports). If a service is not running/healthy:
   show `logs --tail 50` for it (from `compose-cmd.sh <recipe> logs <service>`, swapping 100 for 50 is fine).
   "port is already allocated" → find the owner with `lsof -iTCP:<port> -sTCP:LISTEN -n -P` and show it.
   Never kill a process or stop another stack without an explicit yes.
7. **`reset`:** first run the `volumes` command and list the volumes that will be **deleted**, then say clearly:
   "this deletes the local data of <project>, shared by every worktree of this project". Explicit yes required.
   After reset, offer to run `up` again.
8. **`stop`** keeps containers and data. Say so in the summary.
9. Summary per shared procedure: action, services and their state, ports, anything that failed. Talk to the user in their language.
