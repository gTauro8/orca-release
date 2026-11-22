"""Orca Quick Commands for the release skills.

  python3 -I scripts/quick_commands.py build [--root R] [--repo-list FILE] > quick-commands.json
      Run while Orca is open (uses `orca repo list` for repo ids). Prints our entries as JSON.

  python3 -I scripts/quick_commands.py guide quick-commands.json [--repo-list FILE]
      Prints step-by-step instructions to add the entries in Orca > Settings > Quick Commands.
      (No automatic write: Orca keeps settings in a SQLite store with revisions and content hashes.)
"""
import argparse
import shlex
import json
import os
import subprocess
import sys

PREFIX = "quick-command-orca-release-"
HERE = os.path.dirname(os.path.abspath(__file__))
GLOBALS = [
    ("push", "Guided push", "/push"),
    ("pr", "Open PR", "/pr"),
    ("deploy", "Deploy", "/deploy"),
    ("compose", "Local services", "/compose"),
    ("align", "Align recipes", "/align"),
    ("updates", "Updates", "/updates"),
    ("status", "Project status", "/status"),
    ("prompt", "New task", "/prompt"),
    ("dev", "Start dev", "/dev"),
]
REPO_ACTIONS = [("up", "▶ Start services"), ("stop", "■ Stop services"), ("status", "Services status")]


def default_root():
    try:
        with open(os.path.expanduser("~/.config/orca-release/root")) as f:
            return f.read().strip() or None
    except OSError:
        return None


def parse_repo_list(text):
    """`orca repo list` lines: <id>  <name>  <path> (path may contain spaces)."""
    repos = []
    for line in text.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            repos.append((parts[0], parts[1], parts[2]))
    return repos


def find_recipe(root, path):
    env = dict(os.environ, ORCA_RELEASE_ROOT=root)
    r = subprocess.run(["bash", os.path.join(HERE, "find-recipe.sh"), path],
                       capture_output=True, text=True, env=env)
    if r.returncode != 0:
        return None
    for line in r.stdout.splitlines():
        if line.startswith("recipe "):
            value = line[len("recipe "):]
            return None if value == "none" else value
    return None


def compose_cmd(root, recipe, action):
    r = subprocess.run(["bash", os.path.join(HERE, "compose-cmd.sh"), recipe, action],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    lines = [l for l in r.stdout.splitlines() if l.strip()]
    return " && ".join(lines) if lines else None


def build(root, repo_list_text, agent="claude"):
    entries = [
        {"id": PREFIX + slug, "label": label, "action": "agent-prompt", "agent": agent,
         "prompt": prompt, "scope": {"type": "global"}}
        for slug, label, prompt in GLOBALS
    ]
    entries.append({"id": PREFIX + "dashboard", "label": "📊 Dashboard", "action": "terminal-command",
                    "command": "python3 -I " + shlex.quote(os.path.join(HERE, "dashboard.py")), "appendEnter": True,
                    "scope": {"type": "global"}})
    for repo_id, _name, path in parse_repo_list(repo_list_text):
        if not os.path.isdir(path):
            continue
        recipe = find_recipe(root, path)
        if not recipe:
            continue
        for action, label in REPO_ACTIONS:
            cmd = compose_cmd(root, recipe, action)
            if not cmd:
                break  # no compose section
            cmd = 'cd "$(git rev-parse --show-toplevel)" && ' + cmd
            entries.append({"id": f"{PREFIX}{action}-{repo_id}", "label": label, "action": "terminal-command", "command": cmd,
                            "appendEnter": True, "scope": {"type": "repo", "repoId": repo_id}})
    return entries


def guide(entries, repo_list_text):
    names = {rid: name for rid, name, _ in parse_repo_list(repo_list_text)}
    out = ["# Orca Quick Commands to add", "",
           "In Orca: Settings → Quick Commands → **Add Command**, once for each entry below.", ""]
    for i, e in enumerate(entries, 1):
        scope = e["scope"]
        where = "Global" if scope["type"] == "global" else f"Project: {names.get(scope['repoId'], scope['repoId'])}"
        out.append(f"## {i}. {e['label']}")
        out.append(f"- Label: `{e['label']}`")
        out.append(f"- Scope: {where}")
        if e.get("action") == "agent-prompt":
            out.append(f"- Type: Agent prompt · {e.get('agent', 'claude').capitalize()} · {e['prompt']}")
        else:
            out.append("- Type: Terminal command")
            out.append(f"- Command: `{e['command']}`")
            out.append(f"- Append Enter: {'on' if e.get('appendEnter', True) else 'off'}")
        out.append("")
    return "\n".join(out)


def repo_list_text_or_none(path):
    if path:
        with open(path) as f:
            return f.read()
    r = subprocess.run(["orca", "repo", "list"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def main(argv):
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--root", default=None)
    b.add_argument("--repo-list", default=None)
    b.add_argument("--agent", default="claude")
    g = sub.add_parser("guide")
    g.add_argument("entries")
    g.add_argument("--repo-list", default=None)
    args = p.parse_args(argv)

    text = repo_list_text_or_none(args.repo_list)
    if text is None:
        print("`orca repo list` failed: is Orca open?", file=sys.stderr)
        return 1
    if args.cmd == "build":
        root = args.root or default_root()
        if not root:
            print("orca-release is not configured: run the release-setup skill", file=sys.stderr)
            return 3
        json.dump(build(root, text, args.agent), sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0
    with open(args.entries, encoding="utf-8") as f:
        print(guide(json.load(f), text))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
