# shellcheck shell=bash

_dev_recipe() {
  new_tmp; mk_recipe "$TMP/root" app "h/o/app" ""
  printf '## dev\n- [ ] `npm run start:dev`\n- [ ] apri http://localhost:3000\n- [ ] `npm run worker` <!-- inferred: confirm -->\n## compose\n- file: `docker-compose.yml`\n- project: app\n' >> "$TMP/root/recipes/app.md"
}

test_dev_cmds_lists_auto_steps_in_order() {
  _dev_recipe
  assert_eq "npm run start:dev
npm run worker" "$(bash "$SCRIPTS/dev-cmds.sh" "$TMP/root/recipes/app.md")"
}

test_dev_cmds_heading_with_trailing_space() {
  new_tmp; mk_recipe "$TMP/root" app "h/o/app" ""
  printf '## dev   \n- [ ] `npm run dev`\n' >> "$TMP/root/recipes/app.md"
  assert_eq "npm run dev" "$(bash "$SCRIPTS/dev-cmds.sh" "$TMP/root/recipes/app.md")"
}

test_dev_cmds_no_section() {
  new_tmp; mk_recipe "$TMP/root" app "h/o/app" ""
  bash "$SCRIPTS/dev-cmds.sh" "$TMP/root/recipes/app.md" >/dev/null 2>&1; assert_eq 2 "$?"
}

test_hint_shows_dev() {
  _dev_recipe
  mk_repo "$TMP/app" "https://h/o/app.git"; git -C "$TMP/app" update-ref refs/remotes/origin/main HEAD
  out=$(ORCA_RELEASE_ROOT="$TMP/root" bash "$SCRIPTS/session-hint.sh" "$TMP/app")
  assert_contains "$out" "skill: /compose /dev /push /pr /deploy"
}
