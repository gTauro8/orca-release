# shellcheck shell=bash
# work.py: PR host detection, standup, cleanup (list and safe apply), agent processes filtered out.

_w() { python3 -I "$SCRIPTS/work.py" "$@"; }
_q() { python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {"d": d}))' "$1"; }
_g() { git -C "$1" -c user.email=me@x -c user.name=Me "${@:2}"; }

_repo_with_branches() {
  new_tmp; R="$TMP/r"; git init -q -b main "$R"; git -C "$R" config user.email me@x
  _g "$R" commit -q --allow-empty -m base
  _g "$R" checkout -q -b done-feature; _g "$R" commit -q --allow-empty -m "feature work"
  _g "$R" checkout -q main; _g "$R" merge -q --ff-only done-feature
  _g "$R" checkout -q -b open-work; _g "$R" commit -q --allow-empty -m "not merged"
  _g "$R" checkout -q main
  _g "$R" branch merged-wt; git -C "$R" worktree add -q "$TMP/wt-clean" merged-wt
  _g "$TMP/wt-clean" commit -q --allow-empty -m "wt work"; _g "$R" merge -q --ff-only merged-wt
  _g "$R" branch dirty-wt; git -C "$R" worktree add -q "$TMP/wt-dirty" dirty-wt; echo x > "$TMP/wt-dirty/f"
}

test_work_cleanup_lists_only_safe_things() {
  _repo_with_branches; out=$(_w cleanup "$R") || return 1
  assert_eq "main" "$(echo "$out" | _q 'd["base"]')" base &&
  assert_eq "['done-feature']" "$(echo "$out" | _q 'd["merged_branches"]')" merged &&
  assert_eq "['merged-wt']" "$(echo "$out" | _q '[w["branch"] for w in d["worktrees"]]')" worktrees
}

test_work_cleanup_apply_deletes_exactly_that() {
  _repo_with_branches
  assert_eq "['done-feature']" "$(_w cleanup "$R" --apply branches | _q 'd["done"]')" branches || return 1
  _w cleanup "$R" --apply worktrees >/dev/null || return 1
  assert_eq "" "$(git -C "$R" branch --list done-feature merged-wt)" gone &&
  assert_contains "$(git -C "$R" branch --list open-work dirty-wt)" "open-work" &&
  assert_contains "$(git -C "$R" branch --list dirty-wt)" "dirty-wt" &&
  [ -d "$TMP/wt-dirty" ] && [ ! -d "$TMP/wt-clean" ] || fail "dirty worktree must stay, clean one must go"
}

test_work_standup_my_commits_on_all_branches() {
  _repo_with_branches
  _g "$R" -c user.email=other@x commit -q --allow-empty -m "someone else"
  printf 'id  r  %s\n' "$R" > "$TMP/list.txt"
  out=$(_w standup --repo-list "$TMP/list.txt" --since "1 day ago") || return 1
  assert_eq "['base', 'feature work', 'not merged', 'wt work']" "$(echo "$out" | _q 'sorted(c["subject"] for c in d[0]["commits"])')"
}

test_work_prs_needs_a_remote_and_never_prompts() {
  new_tmp; R="$TMP/n"; git init -q "$R"
  assert_eq "no remote" "$(_w prs "$R" | _q 'd["error"]')" none || return 1
  git -C "$R" remote add origin https://127.0.0.1:9/team/app.git
  out=$(_w prs "$R" --gitea-auth) || return 1
  # not reachable, so not known to be Gitea: no Gitea calls and no stored credentials sent anywhere
  assert_eq "None" "$(echo "$out" | _q 'd["host"]')" host && assert_contains "$out" '"error"'
}

test_work_cleanup_keeps_new_worktrees_and_personal_files() {
  _repo_with_branches
  # just created for a task: no commit of its own yet, so it is not "merged work"
  _g "$R" branch fresh-wt; git -C "$R" worktree add -q "$TMP/wt-fresh" fresh-wt
  # merged, clean for git status, but holds an ignored file somebody wrote by hand
  _g "$R" branch env-wt; git -C "$R" worktree add -q "$TMP/wt-env" env-wt
  _g "$TMP/wt-env" commit -q --allow-empty -m "env work"; _g "$R" merge -q --ff-only env-wt
  printf '.env.local\nnode_modules/\n' > "$TMP/excludes"
  git -C "$TMP/wt-env" config core.excludesFile "$TMP/excludes"
  echo SECRET=1 > "$TMP/wt-env/.env.local"
  # only rebuildable output ignored: this one can go
  mkdir -p "$TMP/wt-clean/node_modules/x"; echo y > "$TMP/wt-clean/node_modules/x/i.js"
  git -C "$TMP/wt-clean" config core.excludesFile "$TMP/excludes"
  out=$(_w cleanup "$R") || return 1
  assert_eq "['merged-wt']" "$(echo "$out" | _q 'sorted(w["branch"] for w in d["worktrees"])')" worktrees
}

test_work_cleanup_never_lists_a_detached_head() {
  _repo_with_branches
  _g "$R" checkout -q --detach
  out=$(_w cleanup "$R") || return 1
  assert_eq "['done-feature']" "$(echo "$out" | _q 'd["merged_branches"]')" merged
}

test_work_releases_newest_version_first_and_no_stash_in_standup() {
  _repo_with_branches
  _g "$R" tag v1.0.0 HEAD~1
  GIT_COMMITTER_DATE="2020-01-01T00:00:00" _g "$R" tag -a v1.2.0 -m two
  _g "$R" tag -a v1.1.0 -m one HEAD~1
  assert_eq "['v1.2.0', 'v1.1.0', 'v1.0.0'] 0" "$(_w releases "$R" | _q '" ".join([str([t["tag"] for t in d["tags"]]), str(d["unreleased"])])')" order || return 1
  echo change > "$R/f.txt"; git -C "$R" add f.txt; _g "$R" stash -q
  printf 'id  r  %s\n' "$R" > "$TMP/list.txt"
  out=$(_w standup --repo-list "$TMP/list.txt" --since "1 day ago") || return 1
  assert_not_contains "$out" "index on" stash
}

test_work_health_refuses_non_web_urls() {
  out=$(python3 -I -B -c 'import sys,json; sys.path.insert(0, sys.argv[1]); import work; print(json.dumps(work.check("file:///etc/hosts")))' "$SCRIPTS")
  assert_contains "$out" '"up": false' up && assert_contains "$out" "not an http" why
}

test_work_agent_processes_are_not_dev_processes() {
  assert_eq "True True True False" "$(python3 -I -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import work; print(work.is_agent("claude"), work.is_agent("2.1.330"), work.is_agent("orcad"), work.is_agent("node"))' "$SCRIPTS")"
}

test_work_targets_parse_url_and_health() {
  out=$(python3 -I -B -c 'import sys,json; sys.path.insert(0, sys.argv[1]); import work; print(json.dumps(work.deploy_targets(open(sys.argv[2]).read())))' "$SCRIPTS" <(printf '## deploy\n### staging (confirm)\n- url: https://staging.example.org\n- health: `/api/health`\n- [ ] `make deploy`\n### prod\n- [ ] x\n## compose\n- url: https://not-a-target\n'))
  assert_eq '[{"name": "staging", "url": "https://staging.example.org", "health": "/api/health"}, {"name": "prod", "url": null, "health": null}]' "$out"
}

test_work_health_reads_version_and_commits_behind() {
  _repo_with_branches
  sha=$(git -C "$R" rev-parse HEAD~1)
  mkdir -p "$TMP/www/api"; printf '{"status":"ok","build":{"commit":"%s"}}' "$sha" > "$TMP/www/api/health"
  port=$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
  (cd "$TMP/www" && exec python3 -I -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1) & srv=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s "http://127.0.0.1:$port/" >/dev/null 2>&1 && break; sleep 0.3; done
  mkdir -p "$TMP/root/recipes"
  cat > "$TMP/root/recipes/r.md" <<REC
---
id: r
host: other
base_branch: main
match:
  paths: [$R]
---
## push
## pr
## deploy
### staging
- url: http://127.0.0.1:$port
- health: /api/health
- [ ] \`true\`
### prod
- url: http://127.0.0.1:1
REC
  out=$(ORCA_RELEASE_ROOT="$TMP/root" python3 -I -B "$SCRIPTS/work.py" health "$R"); kill $srv 2>/dev/null
  assert_eq "True 200 $sha 1" "$(echo "$out" | _q '" ".join(str(x) for x in [d["targets"][0]["up"], d["targets"][0]["status"], d["targets"][0]["version"], d["targets"][0]["behind"]])')" staging &&
  assert_eq "False" "$(echo "$out" | _q 'd["targets"][1]["up"]')" prod-down
}

test_work_releases_newest_first_with_commits() {
  _repo_with_branches
  _g "$R" tag -a v1.0.0 -m "first" HEAD~1
  _g "$R" commit -q --allow-empty -m "after"
  _g "$R" tag -a v1.1.0 -m "second"
  _g "$R" commit -q --allow-empty -m "unreleased"
  out=$(_w releases "$R") || return 1
  assert_eq "['v1.1.0', 'v1.0.0'] [2, 2] 1" "$(echo "$out" | _q '" ".join([str([t["tag"] for t in d["tags"]]), str([t["commits"] for t in d["tags"]]), str(d["unreleased"])])')"
}

test_work_logs_refuses_bad_service_names() {
  _repo_with_branches
  assert_contains "$(_w logs "$R" 'db; rm -rf /')" "bad service name"
}
