"""Direct dependencies of a repo with resolved versions, read from manifests and lockfiles (read-only).

  direct_deps(repo) -> {name: version}

npm: package.json dependencies + devDependencies, versions from package-lock.json (v2/v3 "packages",
v1 "dependencies"), else the declared range. Dart: pubspec.lock "direct main"/"direct dev". Go: go.mod
require lines without // indirect. Unreadable files contribute nothing.
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _npm(repo):
    pkg = _read_json(os.path.join(repo, "package.json"))
    declared = {}
    for key in ("dependencies", "devDependencies"):
        section = pkg.get(key)
        if isinstance(section, dict):
            declared.update({k: str(v) for k, v in section.items()})
    if not declared:
        return {}
    lock = _read_json(os.path.join(repo, "package-lock.json"))
    packages = lock.get("packages") if isinstance(lock.get("packages"), dict) else {}
    legacy = lock.get("dependencies") if isinstance(lock.get("dependencies"), dict) else {}
    out = {}
    for name, rng in declared.items():
        entry = packages.get(f"node_modules/{name}") or legacy.get(name) or {}
        version = entry.get("version") if isinstance(entry, dict) else None
        out[name] = version or rng
    return out


def _pub(repo):
    path = os.path.join(repo, "pubspec.lock")
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return {}
    out, name, direct, inside = {}, None, False, False
    for line in lines:
        if line.startswith("packages:"):
            inside = True
            continue
        if inside and line and not line.startswith(" "):
            break
        m = re.match(r"^  ([A-Za-z0-9_]+):\s*$", line)
        if inside and m:
            name, direct = m.group(1), False
            continue
        m = re.match(r'^    dependency:\s*"?([^"]+)"?\s*$', line)
        if inside and name and m:
            direct = m.group(1).startswith("direct")
            continue
        m = re.match(r'^    version:\s*"?([^"]+)"?\s*$', line)
        if inside and name and direct and m:
            out[name] = m.group(1)
    return out


def _go(repo):
    path = os.path.join(repo, "go.mod")
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return {}
    out, block = {}, False
    for line in lines:
        s = line.strip()
        if s.startswith("require ("):
            block = True
            continue
        if block and s == ")":
            block = False
            continue
        if s.startswith("require "):
            s = s[len("require "):]
        elif not block:
            continue
        if "// indirect" in s:
            continue
        parts = s.split()
        if len(parts) >= 2:
            out[parts[0]] = parts[1]
    return out


def direct_deps(repo):
    out = {}
    for reader in (_npm, _pub, _go):
        out.update(reader(repo))
    return out
