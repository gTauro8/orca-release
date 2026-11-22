# shellcheck shell=bash

MOBILE_APP=git.example.com/team/mobile-app

test_normalize_remote_forms() {
  . "$SCRIPTS/lib.sh"
  assert_eq "$MOBILE_APP" "$(normalize_remote https://git.example.com/team/mobile-app.git)" https &&
  assert_eq "$MOBILE_APP" "$(normalize_remote git@git.example.com:team/mobile-app.git)" scp &&
  assert_eq "$MOBILE_APP" "$(normalize_remote https://u:tok@git.example.com/team/mobile-app.git)" creds &&
  assert_eq "$MOBILE_APP" "$(normalize_remote ssh://git@git.example.com:2222/team/mobile-app)" ssh-port &&
  assert_eq "$MOBILE_APP" "$(normalize_remote HTTPS://Git.Example.com/Team/Mobile-App.git)" case &&
  assert_eq forge.example.net/git/flutter-app "$(normalize_remote https://forge.example.net/git/flutter-app/)" trailing-slash
}

test_match_by_remote() {
  new_tmp; mk_repo "$TMP/app" "https://git.example.com/team/mobile-app.git"
  mk_recipe "$TMP/root" mobile-app "$MOBILE_APP" ""
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app")
  assert_contains "$out" "recipe $TMP/root/recipes/mobile-app.md" &&
  assert_contains "$out" "root $TMP/app" &&
  assert_contains "$out" "remote $MOBILE_APP"
}

test_match_from_subdir_and_worktree() {
  new_tmp; mk_repo "$TMP/app" "git@git.example.com:team/mobile-app.git"
  mkdir -p "$TMP/app/lib/src"
  git -C "$TMP/app" worktree add -q "$TMP/wt" -b feature
  mk_recipe "$TMP/root" mobile-app "$MOBILE_APP" "$TMP/app"
  out1=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app/lib/src")
  out2=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/wt")
  assert_contains "$out1" "recipe $TMP/root/recipes/mobile-app.md" subdir &&
  assert_contains "$out2" "recipe $TMP/root/recipes/mobile-app.md" worktree
}

test_match_by_path() {
  new_tmp; mk_repo "$TMP/local"
  mk_recipe "$TMP/root" local "" "$TMP/local"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/local")
  assert_contains "$out" "recipe $TMP/root/recipes/local.md" &&
  assert_contains "$out" "remote -"
}

test_match_by_tilde_path() {
  new_tmp; mk_repo "$TMP/home/Dev/x"
  mk_recipe "$TMP/root" x "" "~/Dev/x"
  out=$(HOME="$TMP/home" ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/home/Dev/x")
  assert_contains "$out" "recipe $TMP/root/recipes/x.md"
}

test_none_reports_stack() {
  new_tmp; mk_repo "$TMP/app" "https://github.com/me/app.git"
  touch "$TMP/app/pubspec.yaml"; mkdir "$TMP/app/ios" "$TMP/app/android"
  mkdir -p "$TMP/root/recipes"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app")
  assert_contains "$out" "recipe none" &&
  assert_contains "$out" "stack flutter ios android"
}

test_stack_other_markers() {
  new_tmp; mk_repo "$TMP/app"
  touch "$TMP/app/go.mod" "$TMP/app/package.json" "$TMP/app/docker-compose.dev.yml" "$TMP/app/Makefile"
  mkdir -p "$TMP/app/.github/workflows"; touch "$TMP/app/.github/workflows/ci.yml"
  mkdir -p "$TMP/root/recipes"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app")
  assert_contains "$out" "stack go node docker make gh-actions"
}

test_stack_compose_yaml_is_docker() {
  new_tmp; mk_repo "$TMP/app"; touch "$TMP/app/compose.yaml"; mkdir -p "$TMP/root/recipes"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app")
  assert_contains "$out" "stack docker"
}

test_multiple_is_error() {
  new_tmp; mk_repo "$TMP/app" "https://git.example.com/team/mobile-app.git"
  mk_recipe "$TMP/root" a "$MOBILE_APP" ""
  mk_recipe "$TMP/root" b "$MOBILE_APP" ""
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app"); rc=$?
  assert_eq 2 "$rc" exit && assert_contains "$out" "error multiple"
}

test_no_credentials_leak() {
  new_tmp; mk_repo "$TMP/app" "https://u:s3cr3t@git.example.com/team/mobile-app.git"
  mkdir -p "$TMP/root/recipes"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app")
  assert_not_contains "$out" "s3cr3t"
}

test_template_ignored() {
  new_tmp; mk_repo "$TMP/app" "https://git.example.com/team/mobile-app.git"
  mk_recipe "$TMP/root" _template "$MOBILE_APP" ""
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app")
  assert_contains "$out" "recipe none"
}

test_find_recipe_compose_line() {
  new_tmp; mk_repo "$TMP/app" "https://git.example.com/team/mobile-app.git"
  mk_recipe "$TMP/root" mobile-app "$MOBILE_APP" ""
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app")
  assert_contains "$out" "compose none" without || return 1
  printf '## compose\n- file: `docker-compose.yml`\n- project: x\n' >> "$TMP/root/recipes/mobile-app.md"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/app")
  assert_contains "$out" "compose docker-compose.yml" with
}

test_not_a_repo() {
  new_tmp; mkdir -p "$TMP/plain" "$TMP/root/recipes"
  ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/find-recipe.sh" "$TMP/plain" >/dev/null 2>&1; rc=$?
  assert_eq 3 "$rc"
}
