# shellcheck shell=bash

# _proj: repo at $TMP/proj with Makefile (lint test), package.json (scripts: test, typecheck),
# workflows deploy.yml + nightly.yml, docker-compose.yml (services db, mock); recipe "proj" pointing at it.
_proj() {
  new_tmp
  mk_repo "$TMP/proj" "https://git.example.com/team/proj.git"
  printf 'lint:\n\techo\ntest:\n\techo\n' > "$TMP/proj/Makefile"
  printf '{"scripts": {"test": "jest", "typecheck": "tsc"}}\n' > "$TMP/proj/package.json"
  mkdir -p "$TMP/proj/.github/workflows"; touch "$TMP/proj/.github/workflows/deploy.yml" "$TMP/proj/.github/workflows/nightly.yml"
  printf 'services:\n  db:\n    image: postgres\n  mock:\n    image: busybox\n' > "$TMP/proj/docker-compose.yml"
  git -C "$TMP/proj" update-ref refs/remotes/origin/main HEAD
  mkdir -p "$TMP/root/recipes"
  R="$TMP/root/recipes/proj.md"
}

# _recipe <push-lines> [compose-lines] — full recipe for proj
_recipe() {
  {
    echo "---"; echo "id: proj"; echo "match:"; echo '  remotes: ["git.example.com/team/proj"]'
    echo "  paths: [\"$TMP/proj\"]"; echo "host: gitea"; echo "base_branch: ${BASE:-main}"; echo "---"
    echo "## push"; printf '%s\n' "$1"
    echo "## pr"; echo "- title: free"
    echo "## deploy"; echo "### prod (confirm)"; echo '- [ ] `gh workflow run deploy.yml --ref main`'
    echo '- [ ] nightly.yml runs by itself'
    if [ -n "${2:-}" ]; then echo "## compose"; printf '%s\n' "$2"; fi
  } > "$R"
}

GOOD_PUSH='- [ ] `make lint`
- [ ] `make test`
- [ ] `npm test`
- [ ] `npm run typecheck`'
GOOD_COMPOSE='- file: `docker-compose.yml`
- project: proj
- services: db mock'

scan() { ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/scan-recipes.sh" "$@"; }

test_scan_ok() {
  _proj; _recipe "$GOOD_PUSH" "$GOOD_COMPOSE"
  out=$(scan); assert_contains "$out" "## proj — ok" && assert_not_contains "$out" "✗" && assert_not_contains "$out" "+ "
}

test_scan_missing_make_target() {
  _proj; _recipe "$GOOD_PUSH
- [ ] \`make lint-guard\`" "$GOOD_COMPOSE"
  out=$(scan); assert_contains "$out" "## proj — out of date" && assert_contains "$out" '✗ `make lint-guard`: target not in the Makefile'
}

test_scan_missing_npm_script() {
  _proj; _recipe "$GOOD_PUSH
- [ ] \`npm run lint\`" "$GOOD_COMPOSE"
  out=$(scan); assert_contains "$out" '✗ `npm run lint`: script not in package.json'
}

test_scan_missing_workflow() {
  _proj; rm "$TMP/proj/.github/workflows/deploy.yml"; _recipe "$GOOD_PUSH" "$GOOD_COMPOSE"
  out=$(scan); assert_contains "$out" '✗ `gh workflow run deploy.yml --ref main`: workflow not found'
}

test_scan_compose_file_and_service() {
  _proj; _recipe "$GOOD_PUSH" '- file: `docker-compose.yml`
- project: proj
- services: db cache'
  out=$(scan); assert_contains "$out" "✗ compose: service \`cache\` not in docker-compose.yml" || return 1
  _recipe "$GOOD_PUSH" '- file: `compose.missing.yml`
- project: proj'
  out=$(scan); assert_contains "$out" "✗ compose: file \`compose.missing.yml\` not found"
}

test_scan_base_branch_missing() {
  _proj; BASE=develop _recipe "$GOOD_PUSH" "$GOOD_COMPOSE"
  out=$(scan); assert_contains "$out" "✗ base_branch \`develop\` does not exist on origin"
}

test_scan_new_things() {
  _proj; _recipe '- [ ] `make lint`' ""
  out=$(scan)
  assert_contains "$out" "+ script npm \`typecheck\` not used in the recipe" &&
  assert_contains "$out" "+ script npm \`test\` not used in the recipe" &&
  assert_contains "$out" "+ target make \`test\` not used in the recipe" &&
  assert_contains "$out" "+ file compose \`docker-compose.yml\` without a ## compose section" &&
  assert_not_contains "$out" "workflow \`deploy.yml\` not mentioned" &&
  assert_not_contains "$out" "workflow \`nightly.yml\` not mentioned"
}

test_scan_new_workflow() {
  _proj; touch "$TMP/proj/.github/workflows/release.yml"; _recipe "$GOOD_PUSH" "$GOOD_COMPOSE"
  out=$(scan); assert_contains "$out" "+ workflow \`release.yml\` not mentioned in the recipe"
}

test_scan_confirm_count_is_not_update() {
  _proj; _recipe "$GOOD_PUSH
- [ ] check <!-- inferred: confirm -->
- [ ] check2 <!-- inferred: confirm -->" "$GOOD_COMPOSE"
  out=$(scan); assert_contains "$out" "## proj — ok (2 to confirm)"
}

test_scan_repo_missing() {
  _proj; _recipe "$GOOD_PUSH" "$GOOD_COMPOSE"; rm -rf "$TMP/proj"
  out=$(scan); assert_contains "$out" "## proj — repo not found"
}

test_scan_status_and_repo_filter() {
  _proj; _recipe "$GOOD_PUSH
- [ ] \`make nope\`" "$GOOD_COMPOSE"
  mk_recipe "$TMP/root" other "h/o/other" "/nonexistent-other"
  assert_eq update "$(scan --repo "$TMP/proj" --status)" status || return 1
  out=$(scan --repo "$TMP/proj"); assert_contains "$out" "## proj" && assert_not_contains "$out" "## other"
}

test_scan_status_ok() {
  _proj; _recipe "$GOOD_PUSH" "$GOOD_COMPOSE"
  assert_eq ok "$(scan --repo "$TMP/proj" --status)"
}

test_scan_bad_file_does_not_stop_scan() {
  _proj; _recipe "$GOOD_PUSH" "$GOOD_COMPOSE"
  printf 'services:\n  db:\n    image: \xe9t\xe9\n  mock:\n    image: b\n' > "$TMP/proj/docker-compose.yml"
  printf '["not", "an", "object"]\n' > "$TMP/proj/package.json"
  mk_repo "$TMP/zz" "https://git.example.com/team/zz.git"
  mk_recipe "$TMP/root" zz "git.example.com/team/zz" "$TMP/zz"
  out=$(scan); rc=$?
  assert_eq 0 "$rc" exit && assert_contains "$out" "## proj" && assert_contains "$out" "## zz" &&
  assert_not_contains "$out" "Traceback"
}

test_scan_ignore_markers() {
  _proj; touch "$TMP/proj/.github/workflows/core.yml"
  _recipe '- [ ] `make lint`
<!-- ignore: npm:test npm:typecheck make:test wf:core.yml compose -->' ""
  out=$(scan)
  assert_contains "$out" "## proj — ok" && assert_not_contains "$out" "+ "
}

test_scan_confirm_counts_only_markers() {
  _proj; _recipe "$GOOD_PUSH
<!-- Steps that were guessed end with a comment saying \"inferred: confirm\" -->" "$GOOD_COMPOSE"
  out=$(scan); assert_contains "$out" "## proj — ok" && assert_not_contains "$out" "to confirm"
}

test_scan_without_config_errors() {
  new_tmp; mkdir -p "$TMP/home"
  out=$(env -u ORCA_RELEASE_ROOT HOME="$TMP/home" bash "$SCRIPTS/scan-recipes.sh" 2>&1); rc=$?
  assert_eq 3 "$rc" exit && assert_contains "$out" "release-setup"
}

test_scan_commands_with_cd_are_skipped() {
  _proj; _recipe "$GOOD_PUSH
- [ ] \`cd ios && make archive\`" "$GOOD_COMPOSE"
  out=$(scan); assert_not_contains "$out" "make archive"
}
