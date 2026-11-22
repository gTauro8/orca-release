---
name: weekly-report
description: Build the weekly (Monday) report — recipe drift plus updates — into reports/YYYY-MM-DD.md; changes nothing else. Use for "/weekly-report", "weekly report", "report settimanale".
---

# /weekly-report

Runs unattended (Orca automation): never ask questions, never wait for input, never modify recipes, project repos,
dependencies or settings. The only write is the report file and its commit.

1. Locate the two folders (re-read them in every shell call): `E=$(cat ~/.config/orca-release/engine 2>/dev/null)` — the
   `orca-release` engine skill (if empty or gone, use the `orca-release` folder next to this skill's folder);
   `D=$(cat ~/.config/orca-release/root 2>/dev/null)` — the user's data folder (`recipes/`, `reports/`, `tech-watch.md`).
   If D is empty, tell the user to run the `release-setup` skill and stop. Run engine scripts as
   `bash "$E/scripts/<name>.sh"` / `python3 -I "$E/scripts/<name>.py"`.
   Read `$E/procedure.md` (context only), `$E/../align/SKILL.md` and `$E/../updates/SKILL.md`.
2. **Recipes:** run `bash "$E/scripts/scan-recipes.sh"` (all projects). Copy the result; for each "out of date"
   add one line on what /align would propose. Do not edit recipes.
3. **Updates:** follow `updates` steps 2–4 for all projects, unattended (skip anything that would need input).
4. `mkdir -p "$D/reports"`, then write `$D/reports/<YYYY-MM-DD>.md`. Keep these headings in English (tools read them);
   write the content in the language `$D/tech-watch.md` is written in:
   ```
   # Weekly report — <date>
   ## Summary            (max 5 lines: what to do this week, in order)
   ## Recipes            (scanner output + proposals)
   ## Security and breaking changes
   ## Recommended updates
   ## News and things to try
   ## Not checked        (failed commands, missing tools)
   ```
5. `git -C "$D" add "reports/<date>.md" && git -C "$D" commit -m "report: <date>" -- "reports/<date>.md"`. No push.
6. Final message: the "Summary" section and the report path.
