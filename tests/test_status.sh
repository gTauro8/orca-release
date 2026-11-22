# shellcheck shell=bash

st() { ORCA_RELEASE_ROOT="$TMP/root" python3 -I "$SCRIPTS/status.py" --repo-list "$TMP/repos.txt" "$@"; }

_two_repos() {
  new_tmp; mkdir -p "$TMP/root/recipes"
  # clean: on main, pushed, recipe ok
  mk_repo "$TMP/clean" "https://git.example.org/team/clean.git"
  git -C "$TMP/clean" update-ref refs/remotes/origin/main HEAD
  git -C "$TMP/clean" branch -q -u origin/main main 2>/dev/null || git -C "$TMP/clean" config branch.main.remote origin
  git -C "$TMP/clean" config branch.main.merge refs/heads/main
  mk_recipe "$TMP/root" clean "git.example.org/team/clean" ""
  # busy: 2 dirty files, 1 commit ahead on feature with upstream, 1 local-only branch, 1 extra worktree, no recipe
  mk_repo "$TMP/busy" "https://git.example.org/team/busy.git"
  git -C "$TMP/busy" update-ref refs/remotes/origin/feature HEAD
  git -C "$TMP/busy" checkout -q -b feature
  git -C "$TMP/busy" config branch.feature.remote origin; git -C "$TMP/busy" config branch.feature.merge refs/heads/feature
  git -C "$TMP/busy" -c user.email=t@t -c user.name=t commit -q --allow-empty -m ahead
  git -C "$TMP/busy" branch -q local-only
  git -C "$TMP/busy" worktree add -q "$TMP/busy-wt" -b wt-branch
  echo x > "$TMP/busy/a.txt"; echo y > "$TMP/busy/b.txt"
  printf 'id-clean  clean  %s\nid-busy  busy  %s\nid-gone  gone  %s\n' "$TMP/clean" "$TMP/busy" "$TMP/gone" > "$TMP/repos.txt"
}

test_status_table_rows() {
  _two_repos; out=$(st) || return 1
  assert_contains "$out" "| clean | main | — | — | — | 0 | 1 | ok |" clean &&
  assert_contains "$out" "| busy | feature | 2 | 1 | — | 3 | 2 | none |" busy   # main, local-only, wt-branch
}

test_status_behind_upstream() {
  new_tmp; mkdir -p "$TMP/root/recipes"
  mk_repo "$TMP/b" "https://git.example.org/team/b.git"
  git -C "$TMP/b" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
  git -C "$TMP/b" -c user.email=t@t -c user.name=t commit -q --allow-empty -m two
  git -C "$TMP/b" update-ref refs/remotes/origin/main HEAD
  git -C "$TMP/b" branch -q --set-upstream-to=origin/main
  git -C "$TMP/b" reset -q --hard HEAD~2
  printf 'id-b  b  %s\n' "$TMP/b" > "$TMP/repos.txt"
  out=$(st) || return 1
  assert_contains "$out" "b: 2 commits to pull on main" &&
  assert_eq 2 "$(python3 -I "$SCRIPTS/status.py" --repo-list "$TMP/repos.txt" --json | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[0]["behind"])')" behind
}

test_status_missing_repo() {
  _two_repos; out=$(st) || return 1
  assert_contains "$out" "| gone | — | folder not found |"
}

test_status_attention_summary() {
  _two_repos; out=$(st) || return 1
  assert_contains "$out" "Needs attention" && assert_contains "$out" "busy: 2 uncommitted files" &&
  assert_contains "$out" "busy: 1 commits to push on feature" && assert_not_contains "$out" "clean:"
}

test_status_unpushed_without_upstream() {
  new_tmp; mkdir -p "$TMP/root/recipes"
  mk_repo "$TMP/n" "https://git.example.org/team/n.git"
  git -C "$TMP/n" update-ref refs/remotes/origin/main HEAD
  git -C "$TMP/n" checkout -q -b feat
  git -C "$TMP/n" -c user.email=t@t -c user.name=t commit -q --allow-empty -m a
  git -C "$TMP/n" -c user.email=t@t -c user.name=t commit -q --allow-empty -m b
  printf 'id-n  n  %s\n' "$TMP/n" > "$TMP/repos.txt"
  out=$(st) || return 1
  assert_contains "$out" "| n | feat | — | 2 |" table &&
  assert_contains "$out" "n: 2 commits never pushed on feat (no upstream)" attention
}

test_status_dirty_worktree_reported() {
  _two_repos; echo z > "$TMP/busy-wt/z.txt"
  out=$(st) || return 1
  assert_contains "$out" "busy: 1 uncommitted file in worktree wt-branch"
}

test_status_json() {
  _two_repos; out=$(st --json) || return 1
  n=$(printf '%s' "$out" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print([r["name"] for r in d if r.get("dirty")])')
  assert_eq "['busy']" "$n"
}
