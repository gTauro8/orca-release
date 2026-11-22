"""Local HTML dashboard of all Orca projects: work not saved or not pushed, releases, recipe drift, Monday report.
Self-contained page (no external resources, no JavaScript), written to <data>/dashboard/index.html and opened.
Read-only on the repos. --online adds the last GitHub Actions run per GitHub repo (needs `gh`).

  python3 -I dashboard.py [--repo-list FILE] [--out PATH] [--online] [--no-open]
  python3 -I dashboard.py [--repo-list FILE] [--online] --json   # data only, for the Release Control plugin
"""
import argparse
import datetime as dt
import glob
import html
import importlib.util
import json
import os
import re
import subprocess
import sys
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # never write __pycache__ into the shared engine
_spec = importlib.util.spec_from_file_location("orca_status", os.path.join(HERE, "status.py"))
status = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(status)


def _load(name):
    spec = importlib.util.spec_from_file_location(f"orca_{name}", os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


links = _load("links")
deps = _load("deps")
E = html.escape


def data_root():
    if os.environ.get("ORCA_RELEASE_ROOT"):
        return os.environ["ORCA_RELEASE_ROOT"]
    try:
        with open(os.path.expanduser("~/.config/orca-release/root")) as f:
            return f.read().strip() or None
    except OSError:
        return None


def git(repo, *args):
    return status.git(repo, *args)


def find_info(path):
    r = subprocess.run(["bash", os.path.join(HERE, "find-recipe.sh"), path], capture_output=True, text=True)
    info = {}
    for line in r.stdout.splitlines():
        key, _, val = line.partition(" ")
        info[key] = val.strip()
    return info


def recipe_path(path):
    rec = find_info(path).get("recipe")
    return rec if rec and rec != "none" else None


WEEKS = 12


def weekly_commits(path, now=None):
    """Commits on HEAD per 7-day bucket over the last WEEKS weeks, oldest first."""
    now = now or dt.datetime.now().timestamp()
    out = git(path, "log", f"--since={WEEKS * 7}.days", "--format=%ct") or ""
    weeks = [0] * WEEKS
    for line in out.splitlines():
        try:
            age = int((now - int(line)) // (7 * 86400))
        except ValueError:
            continue
        if 0 <= age < WEEKS:
            weeks[WEEKS - 1 - age] += 1
    return weeks


def deploy_targets(recipe):
    if not recipe:
        return []
    try:
        text = open(recipe, encoding="utf-8", errors="replace").read()
    except OSError:
        return []
    out, inside = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = line.rstrip() == "## deploy"
        elif inside and line.startswith("### "):
            out.append(re.sub(r"\s*\(confirm\)\s*$", "", line[4:]).strip())
    return out


def has_dev_section(recipe):
    try:
        text = open(recipe, encoding="utf-8", errors="replace").read()
    except OSError:
        return False
    return re.search(r"^## dev[ \t]*$", text, re.M) is not None


def release_info(path):
    tag = git(path, "describe", "--tags", "--abbrev=0")
    info = {"tag": tag, "tag_date": None, "since": None,
            "last_commit": git(path, "log", "-1", "--format=%cs")}
    if tag:
        info["tag_date"] = git(path, "log", "-1", "--format=%cs", tag)
        info["since"] = int(git(path, "rev-list", "--count", f"{tag}..HEAD") or 0)
    return info


def gh_last_run(path):
    try:
        r = subprocess.run(["gh", "run", "list", "--limit", "1", "--json", "workflowName,status,conclusion,createdAt"],
                           cwd=path, capture_output=True, text=True, timeout=15)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    if r.returncode != 0:
        return None
    try:
        runs = json.loads(r.stdout)
    except ValueError:
        return None
    return runs[0] if runs else None


def latest_report(root):
    files = sorted(glob.glob(os.path.join(root, "reports", "*.md")))
    if not files:
        return None, []
    text = open(files[-1], encoding="utf-8", errors="replace").read()
    m = re.search(r"^## (?:Summary|In breve)\s*$(.*?)(?=^## |\Z)", text, re.S | re.M)
    items = []
    for line in (m.group(1) if m else "").splitlines():
        line = re.sub(r"^\s*(\d+\.|-)\s*", "", line).strip()
        if line:
            items.append(line)
    return os.path.basename(files[-1])[:-3], items[:6]


def inline_md(s):
    s = E(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])", r"<em>\1</em>", s)
    return s


def days_ago(date_s, today):
    try:
        return (today - dt.date.fromisoformat(date_s)).days
    except (TypeError, ValueError):
        return None


def collect(repo_list_text, online):
    rows = []
    for _id, name, path in status.parse_repo_list(repo_list_text):
        try:
            r = status.repo_info(name, path)
        except Exception as e:  # noqa: BLE001 (one odd repo must not empty the whole board)
            print(f"dashboard: {name}: {type(e).__name__}: {e}", file=sys.stderr)
            rows.append({"name": name, "path": path, "missing": False, "error": str(e)[:200]})
            continue
        if not r["missing"]:
            try:
                info = find_info(path)
                rec = info.get("recipe") if info.get("recipe") not in (None, "none") else None
                r.update(release_info(path))
                r["targets"] = deploy_targets(rec)
                r["recipe_file"] = rec
                r["stack"] = [s for s in (info.get("stack") or "").split() if s != "-"]
                r["compose"] = info.get("compose") not in (None, "", "none")
                r["has_dev"] = bool(rec) and has_dev_section(rec)
                r["remote"] = info.get("remote") or None
                r["graphify"] = os.path.isfile(os.path.join(path, "graphify-out", "graph.json"))
                r["weeks"] = weekly_commits(path)
                parsed = links.parse_links(open(rec, encoding="utf-8", errors="replace").read()) if rec else links.parse_links("")
                r["domain"], r["domain_label"] = parsed["domain"], parsed["domain_label"]
                r["links"] = parsed["links"]
                r["deps"] = deps.direct_deps(path)
                r["ci"] = gh_last_run(path) if online and (git(path, "config", "--get", "remote.origin.url") or "").find("github.com") >= 0 else None
            except Exception as e:  # noqa: BLE001 (keep what was read; the rest of the board still shows)
                print(f"dashboard: {name}: {type(e).__name__}: {e}", file=sys.stderr)
                r["error"] = str(e)[:200]
        rows.append(r)
    return rows


CSS = """
:root{--bg:#f5f6f8;--panel:#fff;--fg:#17202b;--muted:#5b6675;--line:#e1e5ea;--accent:#2f6fde;--accent-soft:#e8f0fd;
--ok:#1f8a5b;--ok-soft:#e5f4ec;--warn:#b26a00;--warn-soft:#fdf1df;--bad:#c23b3b;--bad-soft:#fbe8e8;
--font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;--mono:"SF Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0f141a;--panel:#161d25;--fg:#e6ebf1;--muted:#93a0b0;--line:#26303b;
--accent:#6aa0ff;--accent-soft:#1a2a44;--ok:#4cc38a;--ok-soft:#14302a;--warn:#f0b04f;--warn-soft:#3a2c14;--bad:#f07171;--bad-soft:#3a1c1e;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 var(--font)}
.wrap{max-width:1240px;margin:0 auto;padding:32px max(16px,env(safe-area-inset-left)) 56px;display:flex;flex-direction:column;gap:24px}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
h1{margin:0;font-size:24px;letter-spacing:-.01em}h2{margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
.sub{color:var(--muted);font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.kpi b{display:block;font-size:28px;font-variant-numeric:tabular-nums;line-height:1.1}
.kpi span{color:var(--muted);font-size:12.5px}
.kpi.warn b{color:var(--warn)}.kpi.bad b{color:var(--bad)}.kpi.acc b{color:var(--accent)}
.grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:24px}
@media (max-width:900px){.grid{grid-template-columns:1fr}}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.card h3{margin:0;font-size:15px;display:flex;justify-content:space-between;gap:8px;align-items:center}
.branch{font:12px var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pills{display:flex;flex-wrap:wrap;gap:6px}
.pill{font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--line);color:var(--fg);white-space:nowrap}
.pill.ok{background:var(--ok-soft);color:var(--ok)}.pill.warn{background:var(--warn-soft);color:var(--warn)}
.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.acc{background:var(--accent-soft);color:var(--accent)}
.rel{font-size:13px;border-top:1px solid var(--line);padding-top:10px;display:flex;flex-direction:column;gap:4px}
.rel .tag{font:600 13px var(--mono)}.muted{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
ol,ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
code{font:12px var(--mono);background:var(--bg);padding:1px 5px;border-radius:4px}
.side{display:flex;flex-direction:column;gap:16px}
.tl{display:flex;flex-direction:column;gap:8px}
.tl-row{display:grid;grid-template-columns:150px 1fr 70px;gap:10px;align-items:center;font-size:13px}
.tl-row .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;background:var(--accent);border-radius:4px}
.tl-row .age{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.missing{opacity:.6}
"""


def card(r, today):
    if r["missing"]:
        return f'<article class="card missing"><h3>{E(r["name"])}</h3><div class="muted">folder not found</div></article>'
    pills = []
    n = r["dirty"]
    pills.append(f'<span class="pill warn">{n} {"uncommitted change" if n == 1 else "uncommitted changes"}</span>'
                 if n else '<span class="pill ok">clean</span>')
    if r["ahead"]:
        pills.append(f'<span class="pill acc">{r["ahead"]} to push</span>')
    if r.get("behind"):
        pills.append(f'<span class="pill warn">{r["behind"]} to pull</span>')
    if r["local_only"]:
        pills.append(f'<span class="pill">{r["local_only"]} local-only branches</span>')
    if r["worktrees"] > 1:
        pills.append(f'<span class="pill">{r["worktrees"]} worktrees</span>')
    rec = {"ok": '<span class="pill ok">recipe ok</span>', "update": '<span class="pill bad">recipe out of date</span>'}
    pills.append(rec.get(r["recipe"], '<span class="pill">no recipe</span>'))
    if r.get("tag"):
        rel = (f'<div><span class="tag">{E(r["tag"])}</span> <span class="muted">· {E(r["tag_date"] or "")}</span></div>'
               f'<div class="muted">{r["since"]} commits since the last release</div>')
    else:
        rel = f'<div class="muted">no tag · last commit {E(r.get("last_commit") or "—")}</div>'
    if r.get("targets"):
        rel += '<div class="pills">' + "".join(f'<span class="pill">{E(t)}</span>' for t in r["targets"]) + "</div>"
    ci = r.get("ci")
    if ci:
        state = ci.get("conclusion") or ci.get("status") or ""
        cls = "ok" if state == "success" else "bad" if state in ("failure", "cancelled") else "warn"
        rel += f'<div><span class="pill {cls}">CI {E(state)}</span> <span class="muted">{E(ci.get("workflowName", ""))} · {E((ci.get("createdAt") or "")[:10])}</span></div>'
    return (f'<article class="card"><h3>{E(r["name"])}</h3><div class="branch">⎇ {E(r["branch"])}</div>'
            f'<div class="pills">{"".join(pills)}</div><div class="rel">{rel}</div></article>')


def render(rows, report_name, report_items, now):
    today = now.date()
    live = [r for r in rows if not r["missing"]]
    k_dirty = sum(1 for r in live if r["dirty"])
    k_push = sum(r["ahead"] for r in live)
    k_unrel = sum(r.get("since") or 0 for r in live)
    k_recipe = sum(1 for r in live if r["recipe"] == "update")
    todo = []
    for r in live:
        if r["dirty"]:
            todo.append(f'<strong>{E(r["name"])}</strong>: {r["dirty"]} {"uncommitted file" if r["dirty"] == 1 else "uncommitted files"} on <code>{E(r["branch"])}</code>')
        if r["ahead"]:
            todo.append(f'<strong>{E(r["name"])}</strong>: {r["ahead"]} commits to push → <code>/push</code>')
        if r.get("behind"):
            todo.append(f'<strong>{E(r["name"])}</strong>: {r["behind"]} commits to pull → <code>git pull --ff-only</code>')
        if r["recipe"] == "update":
            todo.append(f'<strong>{E(r["name"])}</strong>: recipe out of date → <code>/align</code>')
        if (r.get("since") or 0) >= 10:
            todo.append(f'<strong>{E(r["name"])}</strong>: {r["since"]} commits not released since {E(r["tag"])} → <code>/deploy</code>')
    tl = []
    for r in sorted(live, key=lambda r: r.get("tag_date") or "", reverse=True):
        if not r.get("tag_date"):
            continue
        age = days_ago(r["tag_date"], today)
        width = 100 - min(age or 0, 180) / 180 * 100
        tl.append(f'<div class="tl-row"><span class="name">{E(r["name"])} <span class="muted">{E(r["tag"])}</span></span>'
                  f'<span class="bar"><i style="width:{max(width, 3):.0f}%"></i></span><span class="age">{age} days ago</span></div>')
    kpi = lambda key, val, label, cls="": f'<div class="kpi {cls}"><b data-kpi="{key}">{val}</b><span>{label}</span></div>'
    report = ""
    if report_name:
        report = (f'<section class="panel"><h2>Monday report · {E(report_name)}</h2><ol>'
                  + "".join(f"<li>{inline_md(i)}</li>" for i in report_items) + "</ol></section>")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project status</title><style>{CSS}</style></head><body><div class="wrap">
<header><div><h1>Project status</h1><div class="sub">Updated {now.strftime("%Y-%m-%d %H:%M")} · {len(rows)} projects in Orca</div></div>
<div class="sub">refresh: Quick Command “Dashboard” or the <code>dashboard</code> skill</div></header>
<section class="kpis">
{kpi("projects", len(rows), "projects")}
{kpi("dirty", k_dirty, "with uncommitted changes", "warn" if k_dirty else "")}
{kpi("push", k_push, "commits to push", "acc" if k_push else "")}
{kpi("unreleased", k_unrel, "commits not yet released")}
{kpi("recipes", k_recipe, "recipes out of date", "bad" if k_recipe else "")}
</section>
<div class="grid">
<section><h2>Projects</h2><div class="cards">{"".join(card(r, today) for r in live)}</div>
{('<p class="sub">Not found on disk: ' + ", ".join(E(r["name"]) for r in rows if r["missing"]) + ' — folder not found (remove them from Orca or relink them).</p>') if len(live) < len(rows) else ""}</section>
<div class="side">
<section class="panel"><h2>To do</h2>{"<ul>" + "".join(f"<li>{t}</li>" for t in todo) + "</ul>" if todo else '<div class="muted">Nothing pending.</div>'}</section>
{report}
<section class="panel"><h2>Latest releases</h2><div class="tl">{"".join(tl) or '<div class="muted">No project has version tags, so there is no release history here. Add a “tag v&lt;version&gt;” step to the recipes’ deploy (or use <code>--online</code> for CI status).</div>'}</div></section>
</div></div></div></body></html>
"""


def graph_data(rows):
    """Drop links to unknown recipes, keep only dependencies shared by 2+ live projects; returns shared_deps."""
    live = [r for r in rows if not r["missing"]]
    ids = {os.path.basename(r["recipe_file"])[:-3] for r in live if r.get("recipe_file")}
    for r in live:
        r["links"] = [l for l in r.get("links", []) if l["target"].startswith("ext:") or l["target"] in ids]
    users = {}
    for r in live:
        for name in r.get("deps", {}):
            users.setdefault(name, []).append(r)
    shared = {name: {r["path"]: r["deps"][name] for r in rs} for name, rs in sorted(users.items()) if len(rs) >= 2}
    for r in live:
        r["deps"] = {k: v for k, v in r.get("deps", {}).items() if k in shared}
    return shared


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--repo-list")
    p.add_argument("--out")
    p.add_argument("--online", action="store_true")
    p.add_argument("--no-open", action="store_true")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    root = data_root()
    if not root:
        print("orca-release is not configured: run the release-setup skill", file=sys.stderr)
        return 3
    if a.repo_list:
        text = open(a.repo_list).read()
    else:
        r = subprocess.run(["orca", "repo", "list"], capture_output=True, text=True)
        if r.returncode != 0:
            print("`orca repo list` failed: is Orca open?", file=sys.stderr)
            return 1
        text = r.stdout
    rows = collect(text, a.online)
    name, items = latest_report(root)
    if a.json:
        shared = graph_data(rows)
        json.dump({"generated": dt.datetime.now().isoformat(timespec="seconds"), "root": root,
                   "report": {"name": name, "items": items}, "projects": rows, "shared_deps": shared},
                  sys.stdout, ensure_ascii=False)
        print()
        return 0
    out = a.out or os.path.join(root, "dashboard", "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(render(rows, name, items, dt.datetime.now()))
    print(out)
    if not a.no_open:
        webbrowser.open("file://" + out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
