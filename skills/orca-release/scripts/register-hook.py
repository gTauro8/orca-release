"""register-hook.py <settings.json> <command>

Add <command> as an extra Claude Code SessionStart hook, tagged by the marker
"orca-release-hint". Other hooks (Orca's own included) are never modified.
Idempotent: an existing tagged entry is replaced, so there is always exactly one.
Writes <settings.json>.orca-release.bak once, before the first change.
Run with: python3 -I register-hook.py ...
"""
import json
import os
import shutil
import sys

MARKER = "orca-release-hint"


def is_ours(group):
    return any(MARKER in h.get("command", "") for h in group.get("hooks", []))


def main(path, command):
    data = {}
    if os.path.exists(path):
        with open(path) as f:
            text = f.read()
        data = json.loads(text) if text.strip() else {}

    # startup only: not on resume, /clear or compaction, so the hint is not repeated.
    ours = {"matcher": "startup", "hooks": [{"type": "command", "command": command, "timeout": 5}]}
    hooks = data.setdefault("hooks", {})
    groups = hooks.get("SessionStart", [])
    kept = [g for g in groups if not is_ours(g)]
    new_groups = kept + [ours]
    if groups == new_groups:
        return  # already registered exactly like this: leave the file untouched

    backup = path + ".orca-release.bak"
    if os.path.exists(path) and not os.path.exists(backup):
        shutil.copy2(path, backup)

    hooks["SessionStart"] = new_groups
    tmp = path + ".orca-release.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    if os.path.exists(path):
        shutil.copymode(path, tmp)  # keep 0600 etc.: settings.json can hold tokens
    os.replace(tmp, path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: register-hook.py <settings.json> <command>")
    main(sys.argv[1], sys.argv[2])
