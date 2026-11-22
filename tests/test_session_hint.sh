# shellcheck shell=bash

_json_field() { # <json> <python expr on d>
  printf '%s' "$1" | python3 -I -c "import json,sys; d=json.load(sys.stdin); print($2)"
}

_app_with_recipe() {
  new_tmp; mk_repo "$TMP/app" "https://git.example.com/team/app.git"
  touch "$TMP/app/docker-compose.yml"; echo '{}' > "$TMP/app/package.json"
  git -C "$TMP/app" update-ref refs/remotes/origin/main HEAD
  mk_recipe "$TMP/root" app "git.example.com/team/app" ""
  printf '## compose\n- file: `docker-compose.yml`\n- project: app\n' >> "$TMP/root/recipes/app.md"
}

EXPECTED_LINE='📦 app · node docker · skill: /compose /push /pr /deploy'

test_hint_with_recipe_and_compose() {
  _app_with_recipe
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/app")
  assert_eq "$EXPECTED_LINE" "$(_json_field "$out" 'd["systemMessage"]')" msg &&
  assert_eq "$EXPECTED_LINE" "$(_json_field "$out" 'd["hookSpecificOutput"]["additionalContext"]')" ctx &&
  assert_eq SessionStart "$(_json_field "$out" 'd["hookSpecificOutput"]["hookEventName"]')" event
}

test_hint_from_subdir_and_worktree() {
  _app_with_recipe
  mkdir -p "$TMP/app/src/x"
  git -C "$TMP/app" add -A; git -C "$TMP/app" -c user.email=t@t -c user.name=t commit -qm files
  git -C "$TMP/app" worktree add -q "$TMP/wt" -b feat
  out1=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/app/src/x")
  out2=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/wt")
  assert_contains "$(_json_field "$out1" 'd["systemMessage"]')" "skill: /compose /push /pr /deploy" subdir &&
  assert_contains "$(_json_field "$out2" 'd["systemMessage"]')" "skill: /compose /push /pr /deploy" worktree
}

test_hint_no_recipe_compose_file() {
  new_tmp; mk_repo "$TMP/svc"; touch "$TMP/svc/compose.yaml"; mkdir -p "$TMP/root/recipes"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/svc")
  msg=$(_json_field "$out" 'd["systemMessage"]')
  assert_contains "$msg" "/compose" && assert_contains "$msg" "no recipe: /push creates one" &&
  assert_not_contains "$msg" "/deploy"
}

test_hint_silent_no_recipe_no_compose() {
  new_tmp; mk_repo "$TMP/lib"; touch "$TMP/lib/package.json" "$TMP/lib/Dockerfile"; mkdir -p "$TMP/root/recipes"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/lib")
  assert_eq "" "$out"
}

test_hint_dockerfile_alone_no_compose_skill() {
  new_tmp; mk_repo "$TMP/app" "https://git.example.com/team/app.git"; touch "$TMP/app/Dockerfile"
  mk_recipe "$TMP/root" app "git.example.com/team/app" ""
  msg=$(_json_field "$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/app")" 'd["systemMessage"]')
  assert_contains "$msg" "skill: /push /pr /deploy" && assert_not_contains "$msg" "/compose"
}

test_hint_warns_when_recipe_outdated() {
  _app_with_recipe
  printf '{"scripts": {"typecheck": "tsc"}}\n' > "$TMP/app/package.json"
  msg=$(_json_field "$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/app")" 'd["systemMessage"]')
  assert_contains "$msg" "⚠ recipe out of date: /align"
}

test_hint_no_warning_when_ok() {
  _app_with_recipe
  msg=$(_json_field "$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/app")" 'd["systemMessage"]')
  assert_not_contains "$msg" "⚠"
}

test_hint_silent_outside_repo() {
  new_tmp; mkdir -p "$TMP/plain" "$TMP/root/recipes"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/plain"); rc=$?
  assert_eq 0 "$rc" && assert_eq "" "$out"
}

test_hint_silent_without_root() {
  new_tmp; mk_repo "$TMP/app"; mkdir -p "$TMP/home"
  out=$(env -u ORCA_RELEASE_ROOT HOME="$TMP/home" "$SCRIPTS/session-hint.sh" "$TMP/app"); rc=$?
  assert_eq 0 "$rc" && assert_eq "" "$out"
}

test_hint_is_valid_json() {
  _app_with_recipe
  ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/app" | python3 -I -c 'import json,sys; json.load(sys.stdin)' || fail "invalid json"
}

test_hint_fast() {
  _app_with_recipe
  start=$(python3 -I -c 'import time; print(time.time())')
  ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/session-hint.sh" "$TMP/app" >/dev/null
  end=$(python3 -I -c 'import time; print(time.time())')
  python3 -I -c "import sys; sys.exit(0 if $end - $start < 1.0 else 1)" || fail "took $(python3 -I -c "print(round($end-$start,2))")s"
}
