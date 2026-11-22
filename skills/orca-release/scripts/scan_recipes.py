"""Scan release recipes against their repos and report what to update. No network, read-only.

  python3 -I scripts/scan_recipes.py [--root R] [--repo DIR] [--status] [--json-links]
"""
import argparse
import importlib.util
import glob
import json
import os
import re
import subprocess
import sys

NPM_INTERESTING = ["lint", "test", "build", "check", "typecheck", "format:check"]
MAKE_INTERESTING = ["lint", "test", "build", "check"]
sys.dont_write_bytecode = True  # never write __pycache__ into the shared engine
_spec = importlib.util.spec_from_file_location("orca_links", os.path.join(os.path.dirname(os.path.abspath(__file__)), "links.py"))
links = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(links)
AUTO_STEP = re.compile(r"^- \[ \] `([^`]+)`\s*(<!--.*-->)?\s*$")


def release_root(cli_root):
    if cli_root:
        return cli_root
    if os.environ.get("ORCA_RELEASE_ROOT"):
        return os.environ["ORCA_RELEASE_ROOT"]
    try:
        with open(os.path.expanduser("~/.config/orca-release/root")) as f:
            return f.read().strip() or None
    except OSError:
        return None


def frontmatter(text):
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        return {}
    fm = {}
    for line in lines[1:]:
        if line == "---":
            break
        m = re.match(r"^(\s*)([A-Za-z_]+):\s*(.*)$", line)
        if not m:
            continue
        value = re.sub(r"\s+#.*$", "", m.group(3)).strip()
        if value.startswith("["):
            fm[m.group(2)] = [v.strip().strip('"') for v in value.strip("[]").split(",") if v.strip().strip('"')]
        else:
            fm[m.group(2)] = value.strip('"')
    return fm


def section(text, name):
    out, inside = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = line.rstrip() == "## " + name
            continue
        if inside:
            out.append(line)
    return out


def section_get(lines, key):
    for line in lines:
        if line.startswith(f"- {key}:"):
            v = line[len(key) + 3:]
            v = re.sub(r"<!--.*?-->", "", v)
            v = re.sub(r"\s+#.*$", "", v).strip()
            if re.fullmatch(r"`[^`]+`", v):
                v = v[1:-1]
            return v
    return ""


def git_ok(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True).returncode == 0


def compose_services(path):
    names, inside = [], False
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if re.match(r"^services:\s*$", line):
                inside = True
                continue
            if inside and re.match(r"^\S", line):
                inside = False
            m = re.match(r"^  ([A-Za-z0-9_.-]+):\s*$", line) if inside else None
            if m:
                names.append(m.group(1))
    return names


def repo_dir(fm, only_dir):
    if only_dir:
        return only_dir
    for p in fm.get("paths", []):
        p = os.path.expanduser(p)
        if os.path.isdir(p):
            return p
    return None


def scan_one(recipe_path, only_dir=None):
    with open(recipe_path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    fm = frontmatter(text)
    rid = fm.get("id") or os.path.basename(recipe_path)[:-3]
    repo = repo_dir(fm, only_dir)
    if not repo:
        return rid, "missing", [], 0
    issues = []

    makefile = os.path.join(repo, "Makefile")
    make_targets = set()
    if os.path.isfile(makefile):
        with open(makefile, encoding="utf-8", errors="replace") as f:
            make_targets = {m.group(1) for m in re.finditer(r"^([A-Za-z0-9_.-]+):", f.read(), re.M)}
    scripts = {}
    pkg = os.path.join(repo, "package.json")
    if os.path.isfile(pkg):
        try:
            with open(pkg, encoding="utf-8", errors="replace") as f:
                data = json.load(f)
            scripts = (data.get("scripts") or {}) if isinstance(data, dict) else {}
            if not isinstance(data, dict):
                issues.append("✗ package.json is not a JSON object")
        except ValueError:
            issues.append("✗ package.json is not readable")
    wf_dir = os.path.join(repo, ".github", "workflows")

    commands = [m.group(1) for line in text.splitlines() if (m := AUTO_STEP.match(line))]
    compose_lines = section(text, "compose")
    for key in ("up", "stop", "reset"):
        v = section_get(compose_lines, key)
        if v:
            commands.append(v)
    for cmd in commands:
        if re.search(r"(^|\s|&&|;)cd\s", cmd):
            continue
        toks = cmd.split()
        if toks[:1] == ["make"] and len(toks) > 1 and not toks[1].startswith("-"):
            if toks[1] not in make_targets:
                issues.append(f"✗ `{cmd}`: target not in the Makefile")
        elif toks[:2] == ["npm", "test"]:
            if "test" not in scripts:
                issues.append(f"✗ `{cmd}`: script not in package.json")
        elif toks[:2] == ["npm", "run"] and len(toks) > 2:
            if toks[2] not in scripts:
                issues.append(f"✗ `{cmd}`: script not in package.json")
        elif toks[:3] == ["gh", "workflow", "run"] and len(toks) > 3:
            if not os.path.isfile(os.path.join(wf_dir, toks[3])):
                issues.append(f"✗ `{cmd}`: workflow not found")

    if compose_lines:
        cfile = section_get(compose_lines, "file")
        cpath = os.path.join(repo, cfile) if cfile else ""
        if cfile and not os.path.isfile(cpath):
            issues.append(f"✗ compose: file `{cfile}` not found")
        elif cfile:
            known = compose_services(cpath)
            for key in ("services", "oneshot"):
                for s in section_get(compose_lines, key).split():
                    if s not in known:
                        issues.append(f"✗ compose: service `{s}` not in {cfile}")

    base = fm.get("base_branch", "")
    if base and git_ok(repo, "config", "--get", "remote.origin.url") and \
            not git_ok(repo, "rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{base}"):
        issues.append(f"✗ base_branch `{base}` does not exist on origin")

    ignored = set()
    for m in re.finditer(r"<!--\s*ignore:\s*(.*?)\s*-->", text):
        ignored.update(m.group(1).split())

    for s in NPM_INTERESTING:
        if f"npm:{s}" in ignored:
            continue
        if s in scripts:
            used = re.search(rf"npm run {re.escape(s)}\b", text) or (s == "test" and re.search(r"npm test\b", text))
            if not used:
                issues.append(f"+ script npm `{s}` not used in the recipe")
    for t in MAKE_INTERESTING:
        if f"make:{t}" in ignored:
            continue
        if t in make_targets and not re.search(rf"make {re.escape(t)}\b", text):
            issues.append(f"+ target make `{t}` not used in the recipe")
    for wf in sorted(glob.glob(os.path.join(wf_dir, "*.yml")) + glob.glob(os.path.join(wf_dir, "*.yaml"))):
        name = os.path.basename(wf)
        if f"wf:{name}" in ignored:
            continue
        if name not in text:
            issues.append(f"+ workflow `{name}` not mentioned in the recipe")
    if not compose_lines and "compose" not in ignored:
        for c in ["docker-compose.yml", "docker-compose.yaml", "compose.yaml", "compose.yml"]:
            if os.path.isfile(os.path.join(repo, c)):
                issues.append(f"+ file compose `{c}` without a ## compose section")
                break

    confirm = len(re.findall(r"<!--\s*inferred: confirm\s*-->", text))
    return rid, ("update" if issues else "ok"), issues, confirm


def link_candidates(recipe_paths):
    """Mentions of other projects in each repo's docs (proposals for /align), never fatal."""
    recipes = []
    for path in recipe_paths:
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        fm = frontmatter(text)
        rid = fm.get("id") or os.path.basename(path)[:-3]
        repo = repo_dir(fm, None)
        names, owner_name = [rid], None
        if repo:
            names.append(os.path.basename(os.path.normpath(repo)))
        for r in fm.get("remotes", []):
            parts = r.rstrip("/").split("/")
            seg = re.sub(r"\.git$", "", parts[-1])
            names.append(seg)
            if len(parts) >= 2:
                owner_name = f"{parts[-2]}/{seg}"
        recipes.append({"id": rid, "dir": repo, "names": sorted(set(names)), "owner_name": owner_name, "text": text})
    try:
        return links.candidates(recipes)
    except Exception:  # proposals are a bonus: never break the scan
        return []


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--root")
    p.add_argument("--repo")
    p.add_argument("--status", action="store_true")
    p.add_argument("--json-links", action="store_true")
    a = p.parse_args(argv)
    root = release_root(a.root)
    if not root:
        print("orca-release is not configured: run the release-setup skill", file=sys.stderr)
        return 3
    recipes = sorted(r for r in glob.glob(os.path.join(root, "recipes", "*.md"))
                     if not os.path.basename(r).startswith("_"))

    cands = [] if a.status else link_candidates(recipes)
    if a.json_links:
        print(json.dumps(cands, ensure_ascii=False))
        return 0
    by_from = {}
    for c in cands:
        by_from.setdefault(c["from"], []).append(c)

    if a.repo:
        here = os.path.dirname(os.path.abspath(__file__))
        r = subprocess.run(["bash", os.path.join(here, "find-recipe.sh"), a.repo], capture_output=True,
                           text=True, env=dict(os.environ, ORCA_RELEASE_ROOT=root))
        found = [l[len("recipe "):] for l in r.stdout.splitlines() if l.startswith("recipe ")]
        top = [l[len("root "):] for l in r.stdout.splitlines() if l.startswith("root ")]
        if not found or found[0] == "none":
            print("none" if a.status else "no recipe for this repo")
            return 0
        targets = [(found[0], top[0] if top else a.repo)]
    else:
        targets = [(r, None) for r in recipes]

    for recipe, only_dir in targets:
        try:
            rid, status, issues, confirm = scan_one(recipe, only_dir)
        except Exception as e:  # one broken recipe or repo file must not stop the scan
            rid = os.path.basename(recipe)[:-3]
            if a.status:
                print("ok")
            else:
                print(f"## {rid} — scanner error: {type(e).__name__}: {e}\n")
            continue
        if a.status:
            print(status)
            continue
        if status == "missing":
            print(f"## {rid} — repo not found\n")
            continue
        head = f"## {rid} — " + ("out of date (%d)" % len(issues) if issues else "ok")
        if not issues and confirm:
            head += f" ({confirm} to confirm)"
        print(head)
        for i in issues:
            print(f"- {i}")
        if issues and confirm:
            print(f"- ? {confirm} steps to confirm")
        for c in by_from.get(rid, []):
            print(f'- + link? {c["to"]} — "{c["text"]}" ({c["file"]}:{c["line"]})')
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
