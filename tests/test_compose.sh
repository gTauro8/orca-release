# shellcheck shell=bash

# _compose_recipe <dir> <compose-section-lines...> : recipe with a decoy key in ## deploy
_compose_recipe() {
  local dir="$1"; shift
  mkdir -p "$dir"
  {
    echo "---"; echo "id: app"; echo "match:"; echo '  remotes: ["h/o/app"]'
    echo "host: gitea"; echo "base_branch: main"; echo "---"
    echo "## push"; echo '- [ ] `true`'
    echo "## pr"; echo "- title: free"
    echo "## deploy"; echo "- file: wrong.yml"
    if [ $# -gt 0 ]; then echo "## compose"; for l in "$@"; do echo "$l"; done; fi
  } > "$dir/app.md"
}

_std() {
  new_tmp
  _compose_recipe "$TMP" '- file: `docker-compose.yml`' '- services: postgres payments-mock   # comment' '- project: shop-api'
  R="$TMP/app.md"
}

C='docker compose -p shop-api -f docker-compose.yml'

test_section_get_strips_backticks() {
  _std; . "$SCRIPTS/lib.sh"
  assert_eq docker-compose.yml "$(section_get "$R" compose file)"
}

test_section_get_ignores_other_sections() {
  _std; . "$SCRIPTS/lib.sh"
  assert_eq wrong.yml "$(section_get "$R" deploy file)" deploy &&
  assert_eq docker-compose.yml "$(section_get "$R" compose file)" compose
}

test_section_get_strips_comment() {
  _std; . "$SCRIPTS/lib.sh"
  assert_eq "postgres payments-mock" "$(section_get "$R" compose services)"
}

test_section_get_absent_key_empty() {
  _std; . "$SCRIPTS/lib.sh"
  assert_eq "" "$(section_get "$R" compose oneshot)" &&
  section_has "$R" compose && ! section_has "$R" nothere
}

test_up_plain() {
  _std
  assert_eq "$C up -d --wait postgres payments-mock" "$("$SCRIPTS/compose-cmd.sh" "$R" up)"
}

test_up_oneshot_split() {
  new_tmp
  _compose_recipe "$TMP" '- file: `docker-compose.yml`' '- project: cm' '- services: postgres media media-bucket' '- oneshot: media-bucket'
  out=$("$SCRIPTS/compose-cmd.sh" "$TMP/app.md" up)
  assert_eq "docker compose -p cm -f docker-compose.yml up -d media-bucket
docker compose -p cm -f docker-compose.yml up -d --wait postgres media" "$out"
}

test_up_no_services_no_trailing_space() {
  new_tmp
  _compose_recipe "$TMP" '- file: `compose.yaml`' '- project: dev'
  assert_eq "docker compose -p dev -f compose.yaml up -d --wait" "$("$SCRIPTS/compose-cmd.sh" "$TMP/app.md" up)"
}

test_stop_reset_status_logs_volumes() {
  _std
  assert_eq "$C stop postgres payments-mock" "$("$SCRIPTS/compose-cmd.sh" "$R" stop)" stop &&
  assert_eq "$C down -v" "$("$SCRIPTS/compose-cmd.sh" "$R" reset)" reset &&
  assert_eq "$C ps -a" "$("$SCRIPTS/compose-cmd.sh" "$R" status)" status &&
  assert_eq "$C logs --tail 100 postgres" "$("$SCRIPTS/compose-cmd.sh" "$R" logs postgres)" logs1 &&
  assert_eq "$C logs --tail 100 postgres payments-mock" "$("$SCRIPTS/compose-cmd.sh" "$R" logs)" logs-all &&
  assert_eq "$C config --volumes" "$("$SCRIPTS/compose-cmd.sh" "$R" volumes)" volumes
}

test_override_up() {
  new_tmp
  _compose_recipe "$TMP" '- file: `deploy/dev/compose.yaml`' '- project: dev' '- up: `make dev-up`'
  assert_eq "make dev-up" "$("$SCRIPTS/compose-cmd.sh" "$TMP/app.md" up)"
}

test_no_section_exit2() {
  new_tmp; _compose_recipe "$TMP"
  "$SCRIPTS/compose-cmd.sh" "$TMP/app.md" up >/dev/null 2>&1; assert_eq 2 "$?"
}

test_missing_project_exit3() {
  new_tmp; _compose_recipe "$TMP" '- file: `docker-compose.yml`'
  "$SCRIPTS/compose-cmd.sh" "$TMP/app.md" up >/dev/null 2>&1; assert_eq 3 "$?"
}

test_unknown_action_exit1() {
  _std
  "$SCRIPTS/compose-cmd.sh" "$R" explode >/dev/null 2>&1; assert_eq 1 "$?"
}
