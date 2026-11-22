"""Everything worth knowing about one project at a glance (read-only, no network).

  python3 -I project_info.py <repo>              -> JSON: docs, api, scripts, env, urls, commits
  python3 -I project_info.py <repo> --doc <rel>  -> the text of one markdown document of the repo

docs:    README / CHANGELOG / CONTRIBUTING / CLAUDE / AGENTS at the top, then docs/**.md and other .md files
         (no vendored or generated folders), each with its title and section headings.
api:     endpoints found statically: OpenAPI/Swagger files (JSON, or YAML read line by line), NestJS
         controllers (@Controller + @Get/@Post/...; string constants and setGlobalPrefix resolved),
         Express routers (app.get / router.post ...), FastAPI (@app.get / @router.post), Spring (@GetMapping ...).
         A path that could not be resolved keeps the source expression and has "approx": true.
scripts: package.json scripts, Makefile targets.
env:     variable NAMES from .env.example-like files (never values, never real .env files).
urls:    http(s)://localhost URLs mentioned in the README, docs and compose files.
commits: the last 8 commits (hash, subject, author, relative date).
"""
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True

SKIP_DIRS = {"node_modules", ".git", "dist", "build", "coverage", "graphify-out", ".dart_tool", "vendor", ".next",
             ".nuxt", "out", "target", ".venv", "venv", "__pycache__", ".idea", ".vscode", "Pods", ".gradle",
             ".orca", ".claude", ".superpowers", "tmp", "site-packages", "bower_components", "jspm_packages",
             ".svelte-kit", ".expo", ".turbo", ".cache", "public/assets"}
MAX_WALK = 20_000  # files looked at per scan: a huge or vendored tree must not stall the page
TOP_DOCS = ("README", "CHANGELOG", "CONTRIBUTING", "ARCHITECTURE", "CLAUDE", "AGENTS")
MAX_DOCS = 80
MAX_FILE = 400_000
METHODS = ("get", "post", "put", "patch", "delete", "head", "options")


def walk(repo, exts, max_depth=6):
    """Relative paths of files with the given extensions, skipping vendored and generated folders."""
    out, seen = [], 0
    base_depth = repo.rstrip(os.sep).count(os.sep)
    for root, dirs, files in os.walk(repo):
        rel_root = os.path.relpath(root, repo)
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")
                         and os.path.join(rel_root, d).lstrip("./") not in SKIP_DIRS
                         and not os.path.exists(os.path.join(root, d, "pyvenv.cfg")))  # a virtualenv by any name
        if root.count(os.sep) - base_depth >= max_depth:
            dirs[:] = []
        for f in sorted(files):
            seen += 1
            if seen > MAX_WALK:
                return out
            low = f.lower()
            if low.endswith(exts) and not low.endswith((".min.js", ".bundle.js", ".map")):
                full = os.path.join(root, f)
                try:
                    if os.path.getsize(full) > 1_000_000:  # bundles and dumps, not source
                        continue
                except OSError:
                    continue
                out.append(os.path.relpath(full, repo))
    return out


def read(path, limit=MAX_FILE):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read(limit)
    except OSError:
        return ""


# ---------- docs ----------

def doc_entry(repo, rel):
    text = read(os.path.join(repo, rel), 200_000)
    title, heads = None, []
    in_code = False
    for line in text.splitlines():
        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        # linear: the old lazy pattern with trailing \s*#*\s* backtracked for seconds on long lines of spaces
        m = re.match(r"^(#{1,3})[ \t]+(.*)$", line)
        if not m:
            continue
        text_h = m.group(2).rstrip().rstrip("#").rstrip()
        if not text_h:
            continue
        if len(m.group(1)) == 1 and title is None:
            title = text_h
        elif len(heads) < 14:
            heads.append({"level": len(m.group(1)), "text": text_h})
    words = len(re.findall(r"\w+", text))
    return {"path": rel, "title": title or os.path.splitext(os.path.basename(rel))[0], "headings": heads,
            "words": words, "group": doc_group(rel)}


def doc_group(rel):
    top = rel.split(os.sep)[0]
    if os.sep not in rel:
        return "Project"
    if top == "docs":
        parts = rel.split(os.sep)
        return "Docs" if len(parts) == 2 else "Docs · " + parts[1]
    return top


def docs(repo):
    files = walk(repo, (".md", ".mdx"), max_depth=4)

    def rank(rel):
        name = os.path.splitext(os.path.basename(rel))[0].upper()
        if os.sep not in rel and name in TOP_DOCS:
            return (0, TOP_DOCS.index(name), rel)
        if rel.startswith("docs" + os.sep):
            return (1, rel.count(os.sep), rel)
        return (2, rel.count(os.sep), rel)
    return [doc_entry(repo, rel) for rel in sorted(files, key=rank)[:MAX_DOCS]]


def doc_text(repo, rel):
    """The text of one .md file inside the repo; None when the path leaves it or is not markdown."""
    full = os.path.realpath(os.path.join(repo, rel))
    root = os.path.realpath(repo)
    if not full.startswith(root + os.sep) or not full.lower().endswith((".md", ".mdx")) or not os.path.isfile(full):
        return None
    return read(full, 400_000)


# ---------- api ----------

def join_path(*parts):
    segs = [p.strip("/") for p in parts if p and p.strip("/")]
    return "/" + "/".join(segs)


def string_constants(repo, files):
    consts = {}
    for rel in files:
        for m in re.finditer(r"""(?:export\s+)?const\s+([A-Z_a-z][\w]*)\s*(?::\s*string\s*)?=\s*(['"`])([^'"`$]*)\2""",
                             read(os.path.join(repo, rel))):
            consts.setdefault(m.group(1), m.group(3))
    return consts


def resolve_expr(expr, consts):
    """'x' / "x" / `${A}/x` / A -> (path, exact)."""
    expr = (expr or "").strip()
    if not expr:
        return "", True
    m = re.fullmatch(r"""(['"])(.*)\1""", expr, re.S)
    if m:
        return m.group(2), True
    m = re.fullmatch(r"`(.*)`", expr, re.S)
    if m:
        exact = True

        def sub(mm):
            nonlocal exact
            if mm.group(1) in consts:
                return consts[mm.group(1)]
            exact = False
            return "{" + mm.group(1) + "}"
        return re.sub(r"\$\{\s*([\w.]+)\s*\}", sub, m.group(1)), exact
    if re.fullmatch(r"[\w.]+", expr) and expr in consts:
        return consts[expr], True
    # a call or anything else: keep a quoted path inside it if any, flagged as approximate
    q = re.search(r"""(['"`])(/?[\w\-/:{}.]*)\1""", expr)
    return (q.group(2) if q else expr), False


def first_arg(s):
    """The first argument text of a decorator/call body (up to a top-level comma or the end)."""
    depth, out = 0, []
    quote = None
    for ch in s:
        if quote:
            out.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "'\"`":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif ch == "," and depth == 0:
            break
        out.append(ch)
    return "".join(out).strip()


def nest_endpoints(repo, ts_files):
    controllers = [f for f in ts_files if f.endswith((".controller.ts", ".controller.js"))]
    if not controllers:
        return []
    consts = string_constants(repo, ts_files)
    prefix = ""
    for rel in ts_files:
        m = re.search(r"setGlobalPrefix\(\s*(['\"`])([^'\"`]*)\1", read(os.path.join(repo, rel)))
        if m and ".spec." not in rel and "test" not in rel.split(os.sep)[0]:
            prefix = m.group(2)
            break
    out = []
    for rel in controllers:
        text = read(os.path.join(repo, rel))
        lines = text.splitlines()
        base, base_exact, name = "", True, None
        for i, line in enumerate(lines):
            m = re.search(r"@Controller\((.*)", line)
            if m:
                arg = first_arg(m.group(1))
                if arg.startswith("{"):
                    pm = re.search(r"path\s*:\s*(['\"`][^'\"`]*['\"`])", arg)
                    arg = pm.group(1) if pm else ""
                base, base_exact = resolve_expr(arg, consts)
                cm = re.search(r"class\s+(\w+)", "\n".join(lines[i:i + 6]))
                name = cm.group(1) if cm else os.path.basename(rel)
                continue
            m = re.search(r"@(Get|Post|Put|Patch|Delete|Head|Options|All)\((.*)", line)
            if m and name:
                sub, exact = resolve_expr(first_arg(m.group(2)), consts)
                handler = None
                for nxt in lines[i + 1:i + 12]:
                    hm = re.match(r"\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(", nxt)
                    if hm and not nxt.strip().startswith("@"):
                        handler = hm.group(1)
                        break
                ep = {"method": m.group(1).upper(), "path": join_path(prefix, base, sub), "group": name,
                      "file": rel, "line": i + 1, "handler": handler}
                if not (exact and base_exact):
                    ep["approx"] = True
                out.append(ep)
    return out


ROUTE_CALL = re.compile(r"""\b(app|router|api|routes?|server)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\3""")


def express_endpoints(repo, js_files):
    out = []
    for rel in js_files:
        if rel.endswith((".controller.ts", ".spec.ts", ".test.ts", ".spec.js", ".test.js")):
            continue
        for i, line in enumerate(read(os.path.join(repo, rel)).splitlines()):
            for m in ROUTE_CALL.finditer(line):
                out.append({"method": m.group(2).upper(), "path": m.group(4), "group": rel, "file": rel, "line": i + 1})
    return out


def python_endpoints(repo, py_files):
    out = []
    for rel in py_files:
        for i, line in enumerate(read(os.path.join(repo, rel)).splitlines()):
            m = re.match(r"""\s*@(\w+)\.(get|post|put|patch|delete)\(\s*(['"])([^'"]+)\3""", line)
            if m:
                out.append({"method": m.group(2).upper(), "path": m.group(4), "group": rel, "file": rel, "line": i + 1})
    return out


def spring_endpoints(repo, java_files):
    out = []
    for rel in java_files:
        base = ""
        for i, line in enumerate(read(os.path.join(repo, rel)).splitlines()):
            m = re.search(r"""@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)\"""", line)
            if m and not out_method(line):
                base = m.group(1)
                continue
            m = re.search(r"""@(Get|Post|Put|Patch|Delete)Mapping(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)")?""", line)
            if m:
                out.append({"method": m.group(1).upper(), "path": join_path(base, m.group(2) or ""),
                            "group": os.path.basename(rel), "file": rel, "line": i + 1})
    return out


def out_method(line):
    return "method" in line


def openapi_endpoints(repo):
    out = []
    for rel in walk(repo, (".json", ".yaml", ".yml"), max_depth=4):
        low = os.path.basename(rel).lower()
        if not any(k in low for k in ("openapi", "swagger", "api-spec", "apispec")):
            continue
        text = read(os.path.join(repo, rel))
        if rel.endswith(".json"):
            try:
                spec = json.loads(text)
            except ValueError:
                continue
            paths = spec.get("paths") if isinstance(spec, dict) else None
            for p, ops in (paths if isinstance(paths, dict) else {}).items():
                for meth, op in (ops if isinstance(ops, dict) else {}).items():
                    if meth in METHODS:
                        op = op if isinstance(op, dict) else {}
                        tags = op.get("tags") if isinstance(op.get("tags"), list) and op.get("tags") else [rel]
                        out.append({"method": meth.upper(), "path": str(p), "group": str(tags[0]),
                                    "summary": op.get("summary") if isinstance(op.get("summary"), str) else None, "file": rel})
        else:
            in_paths, path, path_indent = False, None, 0
            for line in text.splitlines():
                if re.match(r"^paths:\s*$", line):
                    in_paths = True
                    continue
                if in_paths and re.match(r"^\S", line):
                    in_paths = False
                if not in_paths:
                    continue
                m = re.match(r"^(\s+)(['\"]?)(/[^'\":]*)\2:\s*$", line)
                if m:
                    path, path_indent = m.group(3), len(m.group(1))
                    continue
                m = re.match(r"^(\s+)(\w+):\s*$", line)
                if m and path and len(m.group(1)) > path_indent and m.group(2) in METHODS:
                    out.append({"method": m.group(2).upper(), "path": path, "group": rel, "file": rel})
    return out


def safe(fn, *args, default=None):
    """One odd file must not empty the whole project page: a failing scanner gives nothing, the rest still shows."""
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001
        print(f"project_info: {getattr(fn, '__name__', fn)}: {type(e).__name__}: {e}", file=sys.stderr)
        return [] if default is None else default


def api(repo):
    ts = walk(repo, (".ts", ".js", ".mjs"))
    found = safe(openapi_endpoints, repo) or []
    nest = safe(nest_endpoints, repo, ts)
    found += nest if nest else safe(express_endpoints, repo, ts)
    found += safe(python_endpoints, repo, walk(repo, (".py",)))
    found += safe(spring_endpoints, repo, walk(repo, (".java", ".kt")))
    seen, out = set(), []
    for e in found:
        k = (e["method"], e["path"])
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out[:600]


# ---------- the rest ----------

def scripts(repo):
    out = []
    try:
        with open(os.path.join(repo, "package.json"), encoding="utf-8") as f:
            pkg = json.load(f)
        for k, v in (pkg.get("scripts") or {}).items():
            out.append({"source": "npm", "name": k, "run": f"npm run {k}", "command": v})
    except (OSError, ValueError, AttributeError):
        pass
    mk = read(os.path.join(repo, "Makefile"))
    for m in re.finditer(r"^([A-Za-z0-9][\w.-]*):(?!=)", mk, re.M):
        out.append({"source": "make", "name": m.group(1), "run": f"make {m.group(1)}", "command": ""})
    return out


def env_vars(repo):
    out = {}
    candidates = [rel for rel in walk(repo, (".example", ".sample", ".template", ".dist"), max_depth=3)
                  if "env" in os.path.basename(rel).lower()]
    for name in (".env.example", ".env.sample", ".env.template"):
        if os.path.isfile(os.path.join(repo, name)):
            candidates.insert(0, name)
    for rel in candidates:
        for line in read(os.path.join(repo, rel), 100_000).splitlines():
            m = re.match(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=", line)
            if m:
                out.setdefault(m.group(1), rel)
    return [{"name": k, "file": v} for k, v in out.items()][:200]


def urls(repo, doc_list):
    found = []
    sources = [d["path"] for d in doc_list[:20]] + [f for f in os.listdir(repo) if f.startswith(("docker-compose", "compose"))]
    for rel in sources:
        for m in re.finditer(r"https?://(?:localhost|127\.0\.0\.1)(?::\d+)?[\w/\-.?=&%#]*", read(os.path.join(repo, rel), 200_000)):
            u = m.group(0).rstrip(".,)")
            if u not in found:
                found.append(u)
    return found[:20]


def commits(repo):
    try:
        out = subprocess.run(["git", "-C", repo, "log", "-8", "--pretty=format:%h\x1f%s\x1f%an\x1f%ar"],
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
                             env={**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"}).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    rows = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 4:
            rows.append({"hash": parts[0], "subject": parts[1], "author": parts[2], "when": parts[3]})
    return rows


def info(repo):
    d = safe(docs, repo)
    return {"path": repo, "docs": d, "api": safe(api, repo), "scripts": safe(scripts, repo), "env": safe(env_vars, repo),
            "urls": safe(urls, repo, d), "commits": safe(commits, repo)}


def main(argv):
    if not argv or not os.path.isdir(argv[0]):
        print("usage: project_info.py <repo> [--doc <relative path>]", file=sys.stderr)
        return 2
    repo = os.path.realpath(argv[0])
    if len(argv) >= 3 and argv[1] == "--doc":
        text = doc_text(repo, argv[2])
        if text is None:
            print("not a markdown file of this project", file=sys.stderr)
            return 3
        sys.stdout.write(text)
        return 0
    json.dump(info(repo), sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
