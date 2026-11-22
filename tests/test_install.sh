# shellcheck shell=bash

# Copy this repo into a temp main checkout so tests never touch the real one.
_mk_checkout() {
  new_tmp
  mkdir -p "$TMP/home" "$TMP/checkout"
  mkdir -p "$TMP/checkout/skills"; cp -R "$REPO_ROOT/skills/orca-release" "$TMP/checkout/skills/"; cp "$REPO_ROOT/install.sh" "$TMP/checkout/"
  for s in push pr deploy compose align updates weekly-report release-setup; do mkdir -p "$TMP/checkout/skills/$s"; done
  git -C "$TMP/checkout" init -q -b main
  git -C "$TMP/checkout" add -A
  git -C "$TMP/checkout" -c user.email=t@t -c user.name=t commit -q -m init
}

test_installs_links_and_root() {
  _mk_checkout
  mkdir -p "$TMP/checkout/recipes"   # the author's checkout is its own data folder
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  assert_eq "$TMP/checkout" "$(cat "$TMP/home/.config/orca-release/root")" root || return 1
  for s in push pr deploy; do
    assert_eq "$TMP/checkout/skills/$s" "$(readlink "$TMP/home/.claude/skills/$s")" "claude $s" || return 1
    assert_eq "$TMP/checkout/skills/$s" "$(readlink "$TMP/home/.agents/skills/$s")" "agents $s" || return 1
  done
}

test_idempotent() {
  _mk_checkout
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null; rc=$?
  assert_eq 0 "$rc" && assert_eq "$TMP/checkout/skills/push" "$(readlink "$TMP/home/.claude/skills/push")"
}

test_refuses_worktree() {
  _mk_checkout
  git -C "$TMP/checkout" worktree add -q "$TMP/wt" -b other
  out=$(HOME="$TMP/home" "$TMP/wt/install.sh" 2>&1); rc=$?
  assert_eq 1 "$rc" exit || return 1
  assert_contains "$out" "run install.sh from the main checkout, not a worktree" || return 1
  [ ! -e "$TMP/home/.config/orca-release/root" ] || fail "root file written"
}

test_refuses_foreign_existing_dir() {
  _mk_checkout
  mkdir -p "$TMP/home/.claude/skills/push"; touch "$TMP/home/.claude/skills/push/SKILL.md"
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null 2>&1; rc=$?
  assert_eq 1 "$rc" exit || return 1
  [ -f "$TMP/home/.claude/skills/push/SKILL.md" ] || fail "foreign skill touched" || return 1
  [ ! -L "$TMP/home/.claude/skills/pr" ] || fail "partial install happened"
}

PROFILES_REL="Library/Application Support/orca/claude-profiles"

_mk_profiles() { # two Orca profiles whose settings already hold Orca's own SessionStart hook
  for p in p1 p2; do
    mkdir -p "$TMP/home/$PROFILES_REL/$p/home"
    printf '%s\n' '{"model": "x", "hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": "orca-hook"}]}]}}' \
      > "$TMP/home/$PROFILES_REL/$p/home/settings.json"
  done
  mkdir -p "$TMP/home/.claude"
  printf '%s\n' '{"model": "x"}' > "$TMP/home/.claude/settings.json"
}

_count_ours() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sum("orca-release-hint" in h.get("command","") for g in d.get("hooks",{}).get("SessionStart",[]) for h in g.get("hooks",[])))' "$1"; }

_hook_cmd() { # <file> <index>
  python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["hooks"]["SessionStart"][int(sys.argv[2])]["hooks"][0]["command"])' "$1" "$2"
}

test_links_compose() {
  _mk_checkout
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  assert_eq "$TMP/checkout/skills/compose" "$(readlink "$TMP/home/.claude/skills/compose")"
}

test_links_new_skills() {
  _mk_checkout
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  for s in align updates weekly-report; do
    assert_eq "$TMP/checkout/skills/$s" "$(readlink "$TMP/home/.claude/skills/$s")" "$s" || return 1
  done
}

test_registers_hook_global_and_profiles() {
  _mk_checkout; _mk_profiles
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  for f in "$TMP/home/.claude/settings.json" "$TMP/home/$PROFILES_REL"/p*/home/settings.json; do
    assert_eq 1 "$(_count_ours "$f")" "$f" || return 1
  done
  f="$TMP/home/$PROFILES_REL/p1/home/settings.json"
  assert_eq orca-hook "$(_hook_cmd "$f" 0)" "orca hook first and unchanged" || return 1
  assert_contains "$(_hook_cmd "$f" 1)" "$TMP/checkout/skills/orca-release/scripts/session-hint.sh"
}

test_hook_idempotent() {
  _mk_checkout; _mk_profiles
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  assert_eq 1 "$(_count_ours "$TMP/home/.claude/settings.json")" global &&
  assert_eq 1 "$(_count_ours "$TMP/home/$PROFILES_REL/p2/home/settings.json")" profile
}

test_settings_without_hooks_key() {
  _mk_checkout; _mk_profiles
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  m=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["model"])' "$TMP/home/.claude/settings.json")
  assert_eq x "$m"
}

test_hook_only_on_startup() {
  _mk_checkout; _mk_profiles
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  m=$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print([g.get("matcher") for g in d["hooks"]["SessionStart"] if "orca-release-hint" in g["hooks"][0]["command"]][0])' "$TMP/home/.claude/settings.json")
  assert_eq startup "$m"
}

test_settings_permissions_kept() {
  _mk_checkout; _mk_profiles
  chmod 600 "$TMP/home/.claude/settings.json"
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  assert_eq 600 "$(stat -f %Lp "$TMP/home/.claude/settings.json")"
}

test_broken_settings_reported() {
  _mk_checkout; _mk_profiles
  printf 'not json' > "$TMP/home/$PROFILES_REL/p1/home/settings.json"
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null 2>&1; rc=$?
  assert_eq 1 "$rc" exit || return 1
  assert_eq 'not json' "$(cat "$TMP/home/$PROFILES_REL/p1/home/settings.json")" "broken file untouched"
}

test_backup_written_once() {
  _mk_checkout; _mk_profiles
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  assert_eq '{"model": "x"}' "$(cat "$TMP/home/.claude/settings.json.orca-release.bak")" "backup holds the original"
}

test_removes_links_with_old_italian_names() {
  _mk_checkout
  mkdir -p "$TMP/home/.claude/skills" "$TMP/elsewhere/stato"
  ln -s "$TMP/checkout/skills/allinea" "$TMP/home/.claude/skills/allinea"
  ln -s "$TMP/elsewhere/stato" "$TMP/home/.claude/skills/stato"
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  [ ! -L "$TMP/home/.claude/skills/allinea" ] || fail "old link into this repo must go" || return 1
  [ -L "$TMP/home/.claude/skills/stato" ] || fail "a link that is not ours must stay"
}

test_public_clone_records_no_data_folder() {
  _mk_checkout
  out=$(HOME="$TMP/home" "$TMP/checkout/install.sh") || return 1
  [ ! -e "$TMP/home/.config/orca-release/root" ] || { fail "a clone without recipes must not become the data folder"; return 1; }
  assert_contains "$out" "/release-setup" && assert_eq "$TMP/checkout/skills/orca-release" "$(cat "$TMP/home/.config/orca-release/engine")" engine
}

test_data_option_and_existing_data_kept() {
  _mk_checkout
  HOME="$TMP/home" "$TMP/checkout/install.sh" --data "$TMP/mydata" >/dev/null || return 1
  assert_eq "$TMP/mydata" "$(cat "$TMP/home/.config/orca-release/root")" data || return 1
  HOME="$TMP/home" "$TMP/checkout/install.sh" >/dev/null || return 1
  assert_eq "$TMP/mydata" "$(cat "$TMP/home/.config/orca-release/root")" kept
}
