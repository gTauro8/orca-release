"""## links in recipes: a project's domain and its typed links to other projects or external systems.

  python3 -I links.py check <root>     problems as "<file>: <problem>", one per line (always exit 0)

candidates(recipes) finds mentions of other projects in a repo's docs: proposals that /align confirms.

Section shape:
  ## links
  - domain: shop
  - domain-label: Shop
  - uses-api: shop-api
  - replaces: ext:Legacy CMS
  - follows: other-id <!-- inferred: confirm -->     (pending: proposed, not confirmed)
"""
import glob
import os
import re
import sys

sys.dont_write_bytecode = True

LINK_TYPES = ("uses-api", "follows", "replaces", "related")
_LINE = re.compile(r"^-\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$")
_PENDING = re.compile(r"<!--\s*inferred:\s*confirm\s*-->")


def section_lines(text, name):
    out, inside = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = line.rstrip() == f"## {name}"
            continue
        if inside:
            out.append(line)
    return out


def _entries(text):
    """(key, value, pending) for every '- key: value' line of ## links, comments removed."""
    for line in section_lines(text, "links"):
        pending = bool(_PENDING.search(line))
        clean = re.sub(r"<!--.*?-->", "", line).strip()
        m = _LINE.match(clean)
        if m and m.group(2):
            yield m.group(1), m.group(2), pending


def parse_links(text):
    out = {"domain": None, "domain_label": None, "links": [], "pending": []}
    for key, value, pending in _entries(text):
        if key == "domain":
            out["domain"] = out["domain"] or value
        elif key == "domain-label":
            out["domain_label"] = out["domain_label"] or value
        elif key in LINK_TYPES:
            out["pending" if pending else "links"].append({"type": key, "target": value})
    return out


def recipe_ids(root):
    return {os.path.basename(p)[:-3] for p in glob.glob(os.path.join(root, "recipes", "*.md"))
            if not os.path.basename(p).startswith("_")}


def check(root):
    ids = recipe_ids(root)
    problems = []
    for path in sorted(glob.glob(os.path.join(root, "recipes", "*.md"))):
        name = os.path.basename(path)
        if name.startswith("_"):
            continue
        rid = name[:-3]
        text = open(path, encoding="utf-8", errors="replace").read()
        domains = 0
        for key, value, _pending in _entries(text):
            if key == "domain":
                domains += 1
                continue
            if key == "domain-label":
                continue
            if key not in LINK_TYPES:
                problems.append(f"{name}: unknown link type '{key}'")
                continue
            if value == rid:
                problems.append(f"{name}: links to itself")
            elif not value.startswith("ext:") and value not in ids:
                problems.append(f"{name}: link target '{value}' is not a recipe id (use ext:<Name> for external systems)")
        if domains > 1:
            problems.append(f"{name}: more than one domain")
    return problems


DOC_FILES = ("CLAUDE.md", "AGENTS.md", "README.md", ".env.example")
DOC_GLOBS = ("docs/*.md", "dart_define*.json", "docker-compose*.yml", "docker-compose*.yaml")
MAX_EVIDENCE = 2
MAX_TEXT = 160


def _doc_files(repo):
    seen = []
    for name in DOC_FILES:
        if os.path.isfile(os.path.join(repo, name)):
            seen.append(name)
    for pattern in DOC_GLOBS:
        for p in sorted(glob.glob(os.path.join(repo, pattern))):
            rel = os.path.relpath(p, repo)
            if rel not in seen:
                seen.append(rel)
    return seen


def _doc_lines(repo, rel):
    path = os.path.join(repo, rel)
    if rel == "package.json":
        return []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().splitlines()
    except OSError:
        return []


def _package_description(repo):
    try:
        import json
        with open(os.path.join(repo, "package.json"), encoding="utf-8") as f:
            d = json.load(f)
        desc = d.get("description") if isinstance(d, dict) else None
        return desc if isinstance(desc, str) else ""
    except (OSError, ValueError):
        return ""


def _patterns(recipe):
    """Regexes that mean "this text mentions the project". Names under 4 characters are ordinary words,
    so they only count as owner/name (e.g. team/api)."""
    pats = []
    for name in recipe["names"]:
        if not name:
            continue
        if len(name) >= 4:
            pats.append(re.compile(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", re.I))
    owner_name = recipe.get("owner_name")
    if owner_name:
        pats.append(re.compile(r"(?<![\w-])" + re.escape(owner_name) + r"(?![\w-])", re.I))
    return pats


def candidates(recipes):
    """recipes: [{"id", "dir", "names", "owner_name", "text"}] -> [{"from", "to", "file", "line", "text"}]."""
    out = []
    pats = {r["id"]: _patterns(r) for r in recipes}
    for src in recipes:
        if not src.get("dir"):
            continue
        parsed = parse_links(src["text"])
        linked = {l["target"] for l in parsed["links"] + parsed["pending"]}
        ignored = set()
        for m in re.finditer(r"<!--\s*ignore:\s*(.*?)\s*-->", src["text"]):
            ignored.update(k[5:] for k in m.group(1).split() if k.startswith("link:"))
        docs = [(rel, _doc_lines(src["dir"], rel)) for rel in _doc_files(src["dir"])]
        desc = _package_description(src["dir"])
        if desc:
            docs.append(("package.json", [desc]))
        for dst in recipes:
            if dst["id"] == src["id"] or dst["id"] in linked or dst["id"] in ignored or not pats[dst["id"]]:
                continue
            hits = 0
            for rel, lines in docs:
                for n, line in enumerate(lines, 1):
                    if any(p.search(line) for p in pats[dst["id"]]):
                        out.append({"from": src["id"], "to": dst["id"], "file": rel, "line": n,
                                    "text": line.strip()[:MAX_TEXT]})
                        hits += 1
                        if hits >= MAX_EVIDENCE:
                            break
                if hits >= MAX_EVIDENCE:
                    break
    return out


def main(argv):
    if len(argv) == 2 and argv[0] == "check":
        for p in check(argv[1]):
            print(p)
        return 0
    print("usage: links.py check <root>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
