"""Day-to-day work facts across projects (read-only unless --apply is given).

  python3 -I work.py prs <repo> [--gitea-auth]       open PRs (mine / waiting for my review) and the last CI state
  python3 -I work.py running --repo-list FILE        docker compose services and processes listening on a port, per project
  python3 -I work.py standup --repo-list FILE [--since "yesterday 00:00"]   my commits per project, all branches
  python3 -I work.py cleanup <repo>                  merged local branches, merged clean worktrees, gone upstreams
  python3 -I work.py cleanup <repo> --apply branches|worktrees  delete exactly what `cleanup` lists, safely
  python3 -I work.py health <repo>                   each deploy target's url: up/down, latency, deployed version, commits behind
  python3 -I work.py releases <repo>                 version tags, newest first: date, subject, commits in each
  python3 -I work.py logs <repo> <service> [--lines N]   the last lines of one compose service of the project

Everything prints JSON. Network is used only by `prs` (gh for GitHub; the Gitea REST API for Gitea hosts, with the
credentials git already stores for that host only when --gitea-auth is given — never prompting).
Deleting uses the safe git forms only: `git branch -d` (refuses unmerged work) and `git worktree remove` (refuses
dirty worktrees); the current branch and the default branch are never touched.
"""
import base64
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import status  # noqa: E402  (parse_repo_list, git)

# never prompt, and never take index.lock for a read: agents committing in the same repo must not trip on us
QUIET_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "GIT_ASKPASS": "", "SSH_ASKPASS": "",
             "GIT_OPTIONAL_LOCKS": "0"}


def git(repo, *args, timeout=15):
    try:
        r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=timeout, env=QUIET_ENV)
        return r.stdout.strip() if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def run(cmd, timeout=20, cwd=None):
    try:
        # logs and lsof may print anything: undecodable bytes become U+FFFD instead of crashing the whole command
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, cwd=cwd,
                           env=QUIET_ENV)
        return r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.SubprocessError) as e:
        return 1, "", str(e)


def repos_from(path):
    with open(path) as f:
        return [(name, p) for _id, name, p in status.parse_repo_list(f.read())]


# ---------- PRs and CI ----------

def ssh_hostname(alias):
    """The real host behind an ssh alias (`Host github-work` in ~/.ssh/config), as ssh itself resolves it."""
    if not re.fullmatch(r"[\w.-]+", alias or "") or alias.startswith("-"):
        return alias
    code, out, _ = run(["ssh", "-G", alias], timeout=5)
    for line in out.splitlines() if code == 0 else []:
        if line.startswith("hostname "):
            return line[9:].strip() or alias
    return alias


def remote_info(repo):
    url = git(repo, "config", "--get", "remote.origin.url") or ""
    m = re.match(r"^(https?://|ssh://)?(?:[^@/]+@)?([^/:]+)(?::(\d+))?[:/](.+?)(?:\.git)?/?$", url)
    if not m:
        return None
    scheme, host, port, full = m.group(1), m.group(2), m.group(3), m.group(4)
    parts = full.split("/")
    if len(parts) < 2:
        return None
    web = scheme in ("http://", "https://")
    if not web:
        host = ssh_hostname(host)
    # the API lives where the web server is: keep an http(s) remote's port, an ssh port says nothing about it
    api_host = f"{host}:{port}" if web and port else host
    return {"host": host, "api_host": api_host, "owner": parts[-2], "repo": parts[-1], "url": url}


def github_prs(repo):
    fields = "number,title,url,author,isDraft,reviewDecision,headRefName,updatedAt"
    code, out, err = run(["gh", "pr", "list", "--state", "open", "--limit", "30", "--json", fields], cwd=repo)
    if code != 0:
        return None, ("gh is not logged in" if "auth" in err.lower() else "gh failed")
    code2, me, _ = run(["gh", "api", "user", "--jq", ".login"], cwd=repo, timeout=10)
    me = me.strip() if code2 == 0 else ""
    code3, req, _ = run(["gh", "pr", "list", "--state", "open", "--search", "review-requested:@me", "--json", "number"], cwd=repo)
    asked = {p["number"] for p in json.loads(req or "[]")} if code3 == 0 else set()
    prs = []
    for p in json.loads(out or "[]"):
        login = (p.get("author") or {}).get("login", "")
        prs.append({"number": p["number"], "title": p["title"], "url": p["url"], "author": login, "branch": p.get("headRefName"),
                    "draft": p.get("isDraft", False), "review": (p.get("reviewDecision") or "").lower() or None,
                    "mine": bool(me) and login == me, "review_requested": p["number"] in asked, "updated": p.get("updatedAt")})
    ci = None
    code4, runs, _ = run(["gh", "run", "list", "--limit", "1", "--json", "status,conclusion,url,workflowName,headBranch"], cwd=repo)
    if code4 == 0 and runs.strip() not in ("", "[]"):
        r = json.loads(runs)[0]
        ci = {"state": r.get("conclusion") or r.get("status"), "url": r.get("url"), "name": r.get("workflowName"), "branch": r.get("headBranch")}
    return {"prs": prs, "ci": ci}, None


def git_credentials(host):
    """The username/secret git already stores for https://host, without ever prompting."""
    try:
        r = subprocess.run(["git", "credential", "fill"], input=f"protocol=https\nhost={host}\n\n", capture_output=True,
                           text=True, timeout=10, env=QUIET_ENV)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    vals = dict(line.split("=", 1) for line in r.stdout.splitlines() if "=" in line)
    return (vals.get("username"), vals.get("password")) if vals.get("password") else None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """urllib copies Authorization to wherever a redirect points (another host, plain http): never follow one."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, f"redirect refused ({code})", headers, fp)


_API = urllib.request.build_opener(_NoRedirect)


def gitea_get(host, path, auth):
    req = urllib.request.Request(f"https://{host}/api/v1{path}", headers={"Accept": "application/json"})
    if auth:
        token = base64.b64encode(f"{auth[0] or ''}:{auth[1]}".encode()).decode()
        req.add_header("Authorization", f"Basic {token}")
    with _API.open(req, timeout=12) as resp:  # https only, host from the repo's own remote
        return json.loads(resp.read().decode("utf-8", "replace") or "null")


def is_gitea(host):
    """Only a server that answers like Gitea (or Forgejo) gets Gitea calls, and git's stored credentials."""
    try:
        v = gitea_get(host, "/version", None)
    except Exception:  # noqa: BLE001 (not reachable, not Gitea, TLS…)
        return None
    return isinstance(v, dict) and isinstance(v.get("version"), str)


def gitea_prs(repo, info, use_auth):
    host = info["api_host"]
    auth = git_credentials(host) if use_auth else None
    try:
        me = (gitea_get(host, "/user", auth) or {}).get("login") if auth else None
        pulls = gitea_get(host, f"/repos/{info['owner']}/{info['repo']}/pulls?state=open&limit=30", auth) or []
        if not isinstance(pulls, list):
            pulls = []
    except Exception as e:  # noqa: BLE001 (network, TLS, 401/404: all reported the same way)
        msg = str(e)
        if "401" in msg or "403" in msg or "404" in msg:
            return None, "login needed (turn on “Gitea: use git credentials”)" if not use_auth else "login refused"
        return None, "server not reachable (VPN off?)"
    prs = []
    for p in pulls:
        login = (p.get("user") or {}).get("login", "")
        reviewers = [r.get("login") for r in (p.get("requested_reviewers") or []) if r]
        prs.append({"number": p.get("number"), "title": p.get("title"), "url": p.get("html_url"), "author": login,
                    "branch": (p.get("head") or {}).get("ref"), "draft": bool(p.get("draft")), "review": None,
                    "mine": bool(me) and login == me, "review_requested": bool(me) and me in reviewers, "updated": p.get("updated_at")})
    ci = None
    branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    sha = git(repo, "rev-parse", "@{u}") or git(repo, "rev-parse", "HEAD")
    try:
        st = gitea_get(host, f"/repos/{info['owner']}/{info['repo']}/commits/{sha}/status", auth)
        if isinstance(st, dict) and st.get("state") and st.get("total_count", 1):
            ci = {"state": st["state"], "url": None, "name": None, "branch": branch}
    except Exception:  # noqa: BLE001
        pass
    return {"prs": prs, "ci": ci}, None


def prs(repo, gitea_auth=False):
    info = remote_info(repo)
    if not info:
        return {"host": None, "prs": [], "ci": None, "error": "no remote"}
    if info["host"] == "github.com":
        data, err = github_prs(repo)
        kind = "github"
    else:
        gitea = is_gitea(info["api_host"])
        if gitea is None:
            # GitLab, Bitbucket, a server off the VPN…: no Gitea calls, and no credentials sent to it
            return {"host": None, "prs": [], "ci": None, "error": "not a Gitea server, or not reachable (VPN off?)"}
        data, err = gitea_prs(repo, info, gitea_auth)
        kind = "gitea"
    out = {"host": kind, "prs": [], "ci": None, **(data or {})}
    if err:
        out["error"] = err
    return out


# ---------- running ----------

def listeners():
    code, out, _ = run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], timeout=10)
    procs, pid, cmd = {}, None, None
    for line in out.splitlines() if code == 0 else []:
        if line.startswith("p"):
            pid = int(line[1:])
        elif line.startswith("c"):
            cmd = line[1:]
        elif line.startswith("n") and pid:
            m = re.search(r":(\d+)$", line)
            if m:
                procs.setdefault(pid, {"pid": pid, "command": cmd, "ports": set()})["ports"].add(int(m.group(1)))
    if not procs:
        return []
    code, out, _ = run(["lsof", "-a", "-d", "cwd", "-p", ",".join(str(p) for p in procs), "-Fpn"], timeout=10)
    pid = None
    for line in out.splitlines() if out else []:
        if line.startswith("p"):
            pid = int(line[1:])
        elif line.startswith("n") and pid in procs:
            procs[pid]["cwd"] = line[1:]
    return [{**v, "ports": sorted(v["ports"])} for v in procs.values() if v.get("cwd") and not is_agent(v["command"])]


AGENT_NAMES = {"claude", "codex", "gemini", "grok", "opencode", "orca", "Orca", "orcad"}


def is_agent(command):
    """Agent CLIs and Orca itself also listen on ports; they are not the project's dev processes."""
    c = (command or "").strip()
    return c in AGENT_NAMES or bool(re.fullmatch(r"\d+\.\d+\.\d+", c))


def compose_project(repo):
    """The compose project name the recipe uses (falls back to the folder name, as docker compose does)."""
    code, out, _ = run(["bash", os.path.join(HERE, "find-recipe.sh"), repo], timeout=10)
    recipe = None
    for line in out.splitlines() if code == 0 else []:
        if line.startswith("recipe ") and line[7:] != "none":
            recipe = line[7:]
    if recipe:
        code, out, _ = run(["bash", "-c", '. "$1/lib.sh"; section_get "$2" compose project', "_", HERE, recipe], timeout=10)
        if out.strip():
            return out.strip()
    return None


def compose_services(project):
    code, out, _ = run(["docker", "compose", "-p", project, "ps", "-a", "--format", "json"], timeout=15)
    if code != 0:
        return None
    rows = []
    text = out.strip()
    try:
        items = json.loads(text) if text.startswith("[") else [json.loads(l) for l in text.splitlines() if l.strip()]
    except ValueError:
        return None  # an older or odd docker: no services rather than no "running" for every project
    for s in items if isinstance(items, list) else []:
        if not isinstance(s, dict):
            continue
        ports = sorted({p.get("PublishedPort") for p in (s.get("Publishers") or []) if p.get("PublishedPort")})
        rows.append({"name": s.get("Service"), "state": s.get("State"), "health": s.get("Health") or None, "ports": ports})
    return rows


def running(repo_list):
    procs = listeners()
    docker_ok = run(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=8)[0] == 0
    out = {}
    repos = repos_from(repo_list)
    roots = []  # (root, repo): the main checkout and every worktree of each project
    for name, repo in repos:
        roots.append((os.path.realpath(repo), repo))
        for l in (git(repo, "worktree", "list", "--porcelain") or "").splitlines():
            if l.startswith("worktree "):
                roots.append((os.path.realpath(l[9:]), repo))
    owner = {}
    for p in procs:
        cwd = os.path.realpath(p["cwd"])
        hits = [(r, repo) for r, repo in roots if cwd == r or cwd.startswith(r + os.sep)]
        if hits:  # a repo nested in another one: the process belongs to the inner (longest) root only
            owner[p["pid"]] = max(hits, key=lambda h: len(h[0]))[1]
    for name, repo in repos:
        mine = [p for p in procs if owner.get(p["pid"]) == repo]
        proj = compose_project(repo) if docker_ok else None
        services = compose_services(proj) if proj else None
        out[repo] = {"name": name, "processes": mine, "services": services or [], "compose_project": proj, "docker": docker_ok}
    return out


# ---------- standup ----------

def standup(repo_list, since):
    out = []
    for name, repo in repos_from(repo_list):
        email = git(repo, "config", "user.email")
        if not email:
            continue
        log = git(repo, "log", "--exclude=refs/stash", "--all", f"--since={since}", f"--author={email}", "--no-merges",
                  "--pretty=format:%h\x1f%s\x1f%cI", timeout=20) or ""
        commits = []
        for line in log.splitlines():
            p = line.split("\x1f")
            if len(p) == 3:  # the last field is never empty: str.strip() treats \x1f as whitespace
                commits.append({"hash": p[0], "subject": p[1], "date": p[2]})
        if commits:
            out.append({"name": name, "path": repo, "commits": commits})
    return out


# ---------- cleanup ----------

def default_branch(repo):
    ref = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if ref:
        return ref, ref.split("/", 1)[1]
    for b in ("main", "master", "develop"):
        if git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{b}"):
            up = f"origin/{b}" if git(repo, "rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{b}") else b
            return up, b
    return None, None


# Ignored folders that are only rebuilt output: a worktree holding just these can go. Anything else ignored
# (.env.local, a local database, notes) is somebody's file and keeps the worktree.
REBUILDABLE = {"node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", "coverage", "target",
               "__pycache__", ".venv", "venv", ".dart_tool", ".gradle", ".pytest_cache", ".mypy_cache", ".parcel-cache",
               "vendor", "Pods", ".expo", ".svelte-kit", "graphify-out", ".DS_Store"}


def fresh_branch(repo, b):
    """A branch that never moved since it was created (reflog: one entry): new work about to start, not merged work."""
    log = git(repo, "reflog", "show", "--format=%H", f"refs/heads/{b}", "--")
    return log is not None and len(log.splitlines()) == 1


def keeps_files(path):
    """Uncommitted, untracked or ignored files that are not just rebuilt output."""
    out = git(path, "status", "--porcelain", "--ignored", "--untracked-files=normal")
    if out is None:
        return True
    for line in out.splitlines():
        if not line.startswith("!! "):
            return True
        first = line[3:].strip().strip('"').rstrip("/").split("/")[0]
        if first not in REBUILDABLE and not first.endswith(".pyc") and not first.endswith(".log"):
            return True
    return False


def cleanup(repo):
    base, base_name = default_branch(repo)
    current = git(repo, "branch", "--show-current")
    merged, gone = [], []
    wt_branches = {}
    top = os.path.realpath(git(repo, "rev-parse", "--show-toplevel") or repo)
    path = None
    for l in (git(repo, "worktree", "list", "--porcelain") or "").splitlines():
        if l.startswith("worktree "):
            path = l[9:]
        elif l.startswith("branch ") and path:
            wt_branches[l[7 + len("refs/heads/"):]] = path
    if base:
        # for-each-ref, not `git branch`: a detached HEAD is never listed as a branch to delete
        for b in (git(repo, "for-each-ref", f"--merged={base}", "--format=%(refname:short)", "refs/heads") or "").splitlines():
            b = b.strip()
            if b and b not in (current, base_name) and b not in wt_branches:
                merged.append(b)
    for l in (git(repo, "for-each-ref", "--format=%(refname:short)|%(upstream:track)", "refs/heads") or "").splitlines():
        b, _, track = l.partition("|")
        if track == "[gone]" and b not in (current, base_name) and b not in merged and b not in wt_branches:
            gone.append(b)
    worktrees = []
    for b, p in wt_branches.items():
        if os.path.realpath(p) == top or not base:
            continue
        clean = os.path.isdir(p) and not keeps_files(p)
        is_merged = git(repo, "merge-base", "--is-ancestor", b, base) is not None
        if clean and is_merged and not fresh_branch(repo, b):
            worktrees.append({"path": p, "branch": b})
    return {"base": base, "merged_branches": merged, "gone_branches": gone, "worktrees": worktrees}


def apply_cleanup(repo, what):
    found = cleanup(repo)
    done, failed = [], []
    if what == "branches":
        for b in found["merged_branches"]:
            (done if git(repo, "branch", "-d", b) is not None else failed).append(b)
    elif what == "worktrees":
        for w in found["worktrees"]:
            ok = git(repo, "worktree", "remove", w["path"]) is not None
            if ok:
                git(repo, "branch", "-d", w["branch"])
            (done if ok else failed).append(w["path"])
    return {"done": done, "failed": failed}


# ---------- environments ----------

def recipe_of(repo):
    code, out, _ = run(["bash", os.path.join(HERE, "find-recipe.sh"), repo], timeout=10)
    for line in out.splitlines() if code == 0 else []:
        if line.startswith("recipe ") and line[7:] != "none":
            return line[7:]
    return None


def deploy_targets(recipe_text):
    """### targets under ## deploy, with their optional `- url:` and `- health:` lines."""
    out, inside, cur = [], False, None
    for line in recipe_text.splitlines():
        if line.startswith("## "):
            inside = line.rstrip() == "## deploy"
            cur = None
            continue
        if not inside:
            continue
        if line.startswith("### "):
            cur = {"name": re.sub(r"\s*\(confirm\)\s*$", "", line[4:]).strip(), "url": None, "health": None}
            out.append(cur)
            continue
        m = re.match(r"^-\s+(url|health):\s*`?([^`\s]+)`?", line)
        if cur and m:
            cur[m.group(1)] = m.group(2)
    return out


VERSION_KEYS = ("version", "commit", "sha", "gitCommit", "git_commit", "revision", "build", "release", "tag")


def find_version(data):
    if isinstance(data, dict):
        for k in VERSION_KEYS:
            v = data.get(k)
            if isinstance(v, (str, int)) and str(v).strip():
                return str(v).strip()
        for v in data.values():
            if isinstance(v, dict):
                found = find_version(v)
                if found:
                    return found
    return None


class _HttpOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not re.match(r"^https?://", newurl, re.I):
            raise urllib.error.HTTPError(req.full_url, code, "redirect to a non-web url refused", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_HEALTH = urllib.request.build_opener(_HttpOnlyRedirect)


def check(url, timeout=6):
    import time
    if not re.match(r"^https?://", url or "", re.I):
        return {"up": False, "status": None, "ms": None, "version": None, "error": "not an http(s) url"}
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "orca-release-health"})
    t0 = time.monotonic()
    try:
        with _HEALTH.open(req, timeout=timeout) as resp:  # http(s) only: a URL from the user's own recipe
            body = resp.read(65536).decode("utf-8", "replace")
            status = resp.status or 0
            headers = dict(resp.headers)
    except urllib.error.HTTPError as e:
        return {"up": False, "status": e.code, "ms": round((time.monotonic() - t0) * 1000), "version": None, "error": f"HTTP {e.code}"}
    except Exception as e:  # noqa: BLE001 (DNS, TLS, timeout, refused)
        msg = str(getattr(e, "reason", e))
        reason = "not reachable (VPN off?)" if "nodename" in msg or "Name or service" in msg else "timed out" if "timed out" in msg else msg[:80]
        return {"up": False, "status": None, "ms": None, "version": None, "error": reason}
    version = None
    for h in ("X-Version", "X-App-Version", "X-Commit", "X-Git-Commit", "X-Revision"):
        if headers.get(h):
            version = headers[h].strip()
            break
    if not version:
        try:
            version = find_version(json.loads(body))
        except ValueError:
            pass
    return {"up": 200 <= status < 400, "status": status, "ms": round((time.monotonic() - t0) * 1000), "version": version, "error": None}


def behind_by(repo, version, base):
    """Commits on the base branch not in the deployed version, when the version is a known commit or tag."""
    if not version or not base:
        return None
    for ref in (version, f"v{version}", version.split("+")[-1], version.split("-")[-1]):
        if re.fullmatch(r"[\w./-]{2,80}", ref or "") and not ref.startswith("-") and git(repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"):
            n = git(repo, "rev-list", "--count", f"{ref}..{base}")
            return int(n) if n and n.isdigit() else None
    return None


def health(repo):
    recipe = recipe_of(repo)
    if not recipe:
        return {"targets": []}
    try:
        text = open(recipe, encoding="utf-8", errors="replace").read()
    except OSError:
        return {"targets": []}
    base, _ = default_branch(repo)
    out = []
    for t in deploy_targets(text):
        if not t["url"]:
            out.append({**t, "checked": False})
            continue
        url = t["url"].rstrip("/") + ("/" + t["health"].lstrip("/") if t["health"] and not t["health"].startswith("http") else "")
        if t["health"] and t["health"].startswith("http"):
            url = t["health"]
        r = check(url)
        out.append({**t, "checked": True, "checked_url": url, **r, "behind": behind_by(repo, r["version"], base) if r["up"] else None})
    return {"targets": out, "base": base}


# ---------- releases ----------

def releases(repo, limit=15):
    # git sorts by the LAST --sort first: version order, creation date only for ties
    rows = git(repo, "for-each-ref", "--sort=-creatordate", "--sort=-v:refname", f"--count={limit + 1}",
               "--format=%(refname:short)\x1f%(creatordate:iso-strict)\x1f%(contents:subject)\x1f%(taggername)%(authorname)", "refs/tags") or ""
    tags = []
    for line in rows.splitlines():
        p = line.split("\x1f")
        if len(p) >= 3:
            tags.append({"tag": p[0], "date": p[1], "subject": p[2], "by": p[3] if len(p) > 3 else ""})
    for i, t in enumerate(tags):
        prev = tags[i + 1]["tag"] if i + 1 < len(tags) else None
        # tags on different branches: the count between them means nothing
        if prev and git(repo, "merge-base", "--is-ancestor", f"refs/tags/{prev}", f"refs/tags/{t['tag']}") is None:
            t["commits"] = None
            continue
        n = git(repo, "rev-list", "--count", f"refs/tags/{prev}..refs/tags/{t['tag']}" if prev else f"refs/tags/{t['tag']}")
        t["commits"] = int(n) if n and n.isdigit() else None
    base, _ = default_branch(repo)
    since = git(repo, "rev-list", "--count", f"refs/tags/{tags[0]['tag']}..{base}") if tags and base else None
    return {"tags": tags[:limit], "unreleased": int(since) if since and since.isdigit() else None, "base": base}


# ---------- logs ----------

def logs(repo, service, lines=150):
    proj = compose_project(repo)
    if not proj or not re.fullmatch(r"[\w.-]+", service or ""):
        return {"lines": [], "error": "no compose project or bad service name"}
    code, out, err = run(["docker", "compose", "-p", proj, "logs", "--no-color", "--tail", str(lines), service], timeout=15)
    if code != 0:
        return {"lines": [], "error": (err.strip().splitlines() or ["docker failed"])[-1]}
    return {"lines": [re.sub(r"^\S+\s+\|\s?", "", l) for l in out.splitlines()][-lines:], "error": None}


def main(argv):
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, rest = argv[0], argv[1:]
    opt = lambda k, d=None: rest[rest.index(k) + 1] if k in rest and rest.index(k) + 1 < len(rest) else d  # noqa: E731
    if cmd == "prs" and rest:
        res = prs(os.path.realpath(rest[0]), "--gitea-auth" in rest)
    elif cmd == "running" and opt("--repo-list"):
        res = running(opt("--repo-list"))
    elif cmd == "standup" and opt("--repo-list"):
        res = standup(opt("--repo-list"), opt("--since", "yesterday 00:00"))
    elif cmd == "health" and rest:
        res = health(os.path.realpath(rest[0]))
    elif cmd == "releases" and rest:
        res = releases(os.path.realpath(rest[0]))
    elif cmd == "logs" and len(rest) >= 2:
        res = logs(os.path.realpath(rest[0]), rest[1], int(opt("--lines", "150")))
    elif cmd == "cleanup" and rest:
        what = opt("--apply")
        if what and what not in ("branches", "worktrees"):
            print("--apply takes branches or worktrees", file=sys.stderr)
            return 2
        res = apply_cleanup(rest[0], what) if what else cleanup(rest[0])
    else:
        print(__doc__, file=sys.stderr)
        return 2
    json.dump(res, sys.stdout, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
