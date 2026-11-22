"""Overview of every Orca repo: branch, uncommitted changes, unpushed commits, local-only branches, worktrees, recipe.
Read-only, no network (no fetch: "to push" is relative to the last fetch).

  python3 -I status.py [--repo-list FILE] [--json]
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


# reads only: never prompt, never take index.lock (an agent committing in the same repo would trip on it)
GIT_ENV = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"}


def git(repo, *args, timeout=30):
    try:
        r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout, env=GIT_ENV)
    except (OSError, subprocess.SubprocessError):
        return None  # a hung network mount or a broken repo: that repo shows less, the others still show
    return r.stdout.strip() if r.returncode == 0 else None


def parse_repo_list(text):
    out = []
    for line in text.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            out.append(parts)
    return out


def recipe_status(path):
    r = subprocess.run(["bash", os.path.join(HERE, "find-recipe.sh"), path], capture_output=True, text=True)
    found = [l[7:] for l in r.stdout.splitlines() if l.startswith("recipe ")]
    if r.returncode != 0 or not found or found[0] == "none":
        return "none"
    s = subprocess.run(["python3", "-I", os.path.join(HERE, "scan_recipes.py"), "--repo", path, "--status"],
                       capture_output=True, text=True).stdout.strip()
    return s if s in ("ok", "update") else "?"


def repo_info(name, path):
    if not os.path.isdir(path) or git(path, "rev-parse", "--git-dir") is None:
        return {"name": name, "path": path, "missing": True}
    branch = git(path, "branch", "--show-current") or "(detached)"
    porcelain = git(path, "status", "--porcelain") or ""
    dirty = len([l for l in porcelain.splitlines() if l.strip()])
    ahead, behind, no_upstream = 0, 0, False
    if git(path, "rev-parse", "--abbrev-ref", "@{u}"):
        ahead = int(git(path, "rev-list", "--count", "@{u}..HEAD") or 0)
        behind = int(git(path, "rev-list", "--count", "HEAD..@{u}") or 0)  # as of the last fetch
    elif branch != "(detached)" and git(path, "config", "--get", "remote.origin.url"):
        ahead = int(git(path, "rev-list", "--count", "HEAD", "--not", "--remotes") or 0)
        no_upstream = ahead > 0
    local_only = 0
    for b in (git(path, "for-each-ref", "--format=%(refname:short)|%(upstream:short)", "refs/heads") or "").splitlines():
        name_b, _, up = b.partition("|")
        if not up:
            local_only += 1
    wt_paths = [l[9:] for l in (git(path, "worktree", "list", "--porcelain") or "").splitlines() if l.startswith("worktree ")]
    dirty_wts = []
    top = os.path.realpath(git(path, "rev-parse", "--show-toplevel") or path)
    for wt in wt_paths:
        if os.path.realpath(wt) == top or not os.path.isdir(wt):
            continue
        n = len([l for l in (git(wt, "status", "--porcelain") or "").splitlines() if l.strip()])
        if n:
            dirty_wts.append({"path": wt, "branch": git(wt, "branch", "--show-current") or os.path.basename(wt), "dirty": n})
    return {"name": name, "path": path, "missing": False, "branch": branch, "dirty": dirty, "ahead": ahead,
            "behind": behind, "no_upstream": no_upstream, "local_only": local_only, "worktrees": len(wt_paths),
            "dirty_worktrees": dirty_wts, "recipe": recipe_status(path)}


def cell(s):
    return str(s).replace("|", "\\|")


def dash(n):
    return "—" if not n else str(n)


def render(rows):
    out = ["| Project | Branch | Changes | To push | To pull | Local-only branches | Worktrees | Recipe |",
           "|---|---|---|---|---|---|---|---|"]
    attention = []
    for r in rows:
        if r["missing"]:
            out.append(f"| {r['name']} | — | folder not found |")
            continue
        out.append(f"| {cell(r['name'])} | {cell(r['branch'])} | {dash(r['dirty'])} | {dash(r['ahead'])} | {dash(r.get('behind'))} | {r['local_only']} | "
                   f"{r['worktrees']} | {r['recipe']} |")
        if r["dirty"]:
            attention.append(f"{r['name']}: {r['dirty']} " + ("uncommitted file" if r["dirty"] == 1 else "uncommitted files"))
        for w in r.get("dirty_worktrees", []):
            attention.append(f"{r['name']}: {w['dirty']} " + ("uncommitted file" if w["dirty"] == 1 else "uncommitted files")
                             + f" in worktree {w['branch']}")
        if r["ahead"] and r.get("no_upstream"):
            attention.append(f"{r['name']}: {r['ahead']} commits never pushed on {r['branch']} (no upstream)")
        elif r["ahead"]:
            attention.append(f"{r['name']}: {r['ahead']} commits to push on {r['branch']}")
        if r.get("behind"):
            attention.append(f"{r['name']}: {r['behind']} " + ("commit" if r["behind"] == 1 else "commits")
                             + f" to pull on {r['branch']} (git pull --ff-only)")
        if r["recipe"] == "update":
            attention.append(f"{r['name']}: recipe out of date (/align)")
    out.append("")
    out.append("## Needs attention")
    out.extend(f"- {a}" for a in attention) if attention else out.append("- nothing: all clean")
    return "\n".join(out)


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--repo-list")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    if a.repo_list:
        with open(a.repo_list) as f:
            text = f.read()
    else:
        r = subprocess.run(["orca", "repo", "list"], capture_output=True, text=True)
        if r.returncode != 0:
            print("`orca repo list` failed: is Orca open?", file=sys.stderr)
            return 1
        text = r.stdout
    rows = [repo_info(name, path) for _id, name, path in parse_repo_list(text)]
    if a.json:
        json.dump(rows, sys.stdout, ensure_ascii=False, indent=2)
        print()
    else:
        print(render(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
