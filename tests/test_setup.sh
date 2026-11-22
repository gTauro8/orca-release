# shellcheck shell=bash

ENGINE="$REPO_ROOT/skills/orca-release"

_setup_home() { new_tmp; mkdir -p "$TMP/home"; }

test_setup_creates_data_folder_and_config() {
  _setup_home
  HOME="$TMP/home" "$ENGINE/scripts/setup.sh" "$TMP/data" >/dev/null || return 1
  [ -d "$TMP/data/recipes" ] && [ -d "$TMP/data/reports" ] && [ -f "$TMP/data/tech-watch.md" ] || { fail "layout"; return 1; }
  git -C "$TMP/data" rev-parse --git-dir >/dev/null 2>&1 || { fail "not a git repo"; return 1; }
  assert_eq "$TMP/data" "$(cat "$TMP/home/.config/orca-release/root")" root &&
  assert_eq "$ENGINE" "$(cat "$TMP/home/.config/orca-release/engine")" engine
}

test_setup_ignores_generated_dashboard() {
  _setup_home
  HOME="$TMP/home" bash "$ENGINE/scripts/setup.sh" "$TMP/data" >/dev/null || return 1
  assert_contains "$(cat "$TMP/data/.gitignore")" "/dashboard/" && assert_contains "$(cat "$TMP/data/.gitignore")" "/prompts/"
}

test_setup_default_data_dir() {
  _setup_home
  HOME="$TMP/home" "$ENGINE/scripts/setup.sh" >/dev/null || return 1
  assert_eq "$TMP/home/orca-release-data" "$(cat "$TMP/home/.config/orca-release/root")"
}

test_setup_keeps_existing_data() {
  _setup_home; mkdir -p "$TMP/data/recipes"; echo mine > "$TMP/data/recipes/x.md"; echo watch > "$TMP/data/tech-watch.md"
  HOME="$TMP/home" "$ENGINE/scripts/setup.sh" "$TMP/data" >/dev/null || return 1
  HOME="$TMP/home" "$ENGINE/scripts/setup.sh" "$TMP/data" >/dev/null || return 1
  assert_eq mine "$(cat "$TMP/data/recipes/x.md")" recipe && assert_eq watch "$(cat "$TMP/data/tech-watch.md")" watch
}

test_setup_no_hook_by_default() {
  _setup_home; mkdir -p "$TMP/home/.claude"; echo '{}' > "$TMP/home/.claude/settings.json"
  HOME="$TMP/home" "$ENGINE/scripts/setup.sh" "$TMP/data" >/dev/null || return 1
  assert_not_contains "$(cat "$TMP/home/.claude/settings.json")" "orca-release-hint"
}

test_setup_hook_flag_registers() {
  _setup_home; mkdir -p "$TMP/home/.claude"; echo '{}' > "$TMP/home/.claude/settings.json"
  HOME="$TMP/home" "$ENGINE/scripts/setup.sh" "$TMP/data" --hook >/dev/null || return 1
  assert_contains "$(cat "$TMP/home/.claude/settings.json")" "$ENGINE/scripts/session-hint.sh"
}

test_works_without_executable_bits() {
  # Orca may copy shared skills without file modes: everything must work via interpreters.
  _setup_home; mkdir -p "$TMP/home/.claude"; echo '{}' > "$TMP/home/.claude/settings.json"
  cp -R "$REPO_ROOT/skills" "$TMP/skills"; find "$TMP/skills" -type f -exec chmod 644 {} +
  E2="$TMP/skills/orca-release"
  HOME="$TMP/home" bash "$E2/scripts/setup.sh" "$TMP/data" --hook >/dev/null 2>&1 || { fail "setup"; return 1; }
  assert_contains "$(cat "$TMP/home/.claude/settings.json")" "bash \\\"$E2/scripts/session-hint.sh\\\"" hook || return 1
  mk_repo "$TMP/app" "https://git.example.org/team/app.git"; echo '{}' > "$TMP/app/package.json"
  git -C "$TMP/app" update-ref refs/remotes/origin/main HEAD
  mk_recipe "$TMP/data" app "git.example.org/team/app" "$TMP/app"
  out=$(HOME="$TMP/home" bash "$E2/scripts/find-recipe.sh" "$TMP/app") || { fail "find-recipe: $out"; return 1; }
  assert_contains "$out" "recipe $TMP/data/recipes/app.md" find || return 1
  out=$(HOME="$TMP/home" bash "$E2/scripts/scan-recipes.sh" --repo "$TMP/app" 2>&1)
  assert_contains "$out" "## app — ok" scan || return 1
  out=$(HOME="$TMP/home" bash "$E2/scripts/session-hint.sh" "$TMP/app")
  assert_contains "$out" "skill: /push /pr /deploy" hint
}

test_engine_templates_present() {
  for f in templates/recipe.md templates/tech-watch.md examples/example-node-api.md procedure.md SKILL.md; do
    [ -f "$ENGINE/$f" ] || { fail "missing $f"; return 1; }
  done
}

test_setup_refuses_a_clone_of_the_package() {
  new_tmp; mkdir -p "$TMP/home" "$TMP/clone/skills/orca-release"
  HOME="$TMP/home" bash "$SCRIPTS/setup.sh" "$TMP/clone" >/dev/null 2>&1; rc=$?
  assert_eq 1 "$rc" && [ ! -d "$TMP/clone/recipes" ] || fail "recipes created inside a clone"
}
