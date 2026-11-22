# shellcheck shell=bash

QC="$SCRIPTS/quick_commands.py"
qc() { python3 -I "$QC" "$@"; }
jq_py() { # <json> <python expr on d>
  printf '%s' "$1" | python3 -I -c "import json,sys; d=json.load(sys.stdin); print($2)"
}

_fixture() { # repo "app" with compose recipe, repo "lib" with recipe but no compose, missing repo "gone"
  new_tmp
  mk_repo "$TMP/app" "https://git.example.com/team/app.git"
  mk_repo "$TMP/lib" "https://git.example.com/team/lib.git"
  mkdir -p "$TMP/root"
  mk_recipe "$TMP/root" app "git.example.com/team/app" ""
  printf '## compose\n- file: `docker-compose.yml`\n- project: app\n- services: db web once\n- oneshot: once\n' >> "$TMP/root/recipes/app.md"
  mk_recipe "$TMP/root" lib "git.example.com/team/lib" ""
  printf 'id-app  app  %s\nid-lib  lib  %s\nid-gone  gone  %s\n' "$TMP/app" "$TMP/lib" "$TMP/gone" > "$TMP/repos.txt"
}

_build() { qc build --root "$TMP/root" --repo-list "$TMP/repos.txt"; }

test_build_globals() {
  _fixture; out=$(_build) || return 1
  got=$(jq_py "$out" '"|".join("=".join([e["label"], e["prompt"], e["agent"], e["action"], e["scope"]["type"]]) for e in d if e.get("action")=="agent-prompt")')
  assert_eq "Guided push=/push=claude=agent-prompt=global|Open PR=/pr=claude=agent-prompt=global|Deploy=/deploy=claude=agent-prompt=global|Local services=/compose=claude=agent-prompt=global|Align recipes=/align=claude=agent-prompt=global|Updates=/updates=claude=agent-prompt=global|Project status=/status=claude=agent-prompt=global|New task=/prompt=claude=agent-prompt=global|Start dev=/dev=claude=agent-prompt=global" "$got"
}

test_build_repo_compose() {
  _fixture; out=$(_build) || return 1
  labels=$(jq_py "$out" '"|".join(e["label"] for e in d if e["scope"].get("repoId")=="id-app")')
  assert_eq "▶ Start services|■ Stop services|Services status" "$labels" labels || return 1
  expected_up='cd "$(git rev-parse --show-toplevel)" && '$(ORCA_RELEASE_ROOT="$TMP/root" "$SCRIPTS/compose-cmd.sh" "$TMP/root/recipes/app.md" up | awk 'NR>1{printf " && "} {printf "%s", $0}')
  up=$(jq_py "$out" '[e for e in d if e["label"]=="▶ Start services"][0]["command"]')
  assert_eq "$expected_up" "$up" up || return 1
  ae=$(jq_py "$out" '[e for e in d if e["label"]=="▶ Start services"][0]["appendEnter"]')
  assert_eq True "$ae" appendEnter || return 1
  id=$(jq_py "$out" '[e for e in d if e["label"]=="▶ Start services"][0]["id"]')
  assert_contains "$id" "quick-command-orca-release-"
}

test_build_skips_no_compose_and_missing_path() {
  _fixture; out=$(_build) || return 1
  n=$(jq_py "$out" 'sum(1 for e in d if e["scope"].get("repoId") in ("id-lib","id-gone"))')
  assert_eq 0 "$n"
}

test_build_agent_option() {
  _fixture; out=$(qc build --root "$TMP/root" --repo-list "$TMP/repos.txt" --agent codex) || return 1
  assert_eq codex "$(jq_py "$out" '",".join(sorted(set(e["agent"] for e in d if e.get("action")=="agent-prompt")))')"
}

test_build_dashboard_terminal_command() {
  _fixture; out=$(_build) || return 1
  e=$(jq_py "$out" '[e for e in d if e["label"]=="📊 Dashboard"][0]')
  assert_contains "$e" "'action': 'terminal-command'" action &&
  assert_contains "$e" "dashboard.py" script && assert_contains "$e" "'type': 'global'" scope
}

test_build_no_reset() {
  _fixture; out=$(_build) || return 1
  assert_not_contains "$out" "down -v" && assert_not_contains "$out" "reset"
}

test_build_terminal_entries_have_action_and_cd() {
  _fixture; out=$(_build) || return 1
  e=$(jq_py "$out" '[e for e in d if e["label"]=="Services status"][0]')
  assert_contains "$e" "'action': 'terminal-command'" action || return 1
  cmd=$(jq_py "$out" '[e for e in d if e["label"]=="Services status"][0]["command"]')
  assert_contains "$cmd" 'cd "$(git rev-parse --show-toplevel)" && docker compose' cd
}

test_guide_lists_every_entry() {
  _fixture; _build > "$TMP/entries.json" || return 1
  out=$(qc guide "$TMP/entries.json" --repo-list "$TMP/repos.txt") || return 1
  assert_contains "$out" "Settings → Quick Commands" &&
  assert_contains "$out" "Guided push" && assert_contains "$out" "Agent prompt · Claude · /push" &&
  assert_contains "$out" "Project: app" && assert_contains "$out" "▶ Start services" &&
  assert_contains "$out" "Append Enter: on"
}

test_no_apply_command() {
  _fixture; _build > "$TMP/entries.json"
  qc apply "$TMP/entries.json" >/dev/null 2>&1 && { fail "apply must not exist (Orca stores settings in SQLite)"; return 1; }
  return 0
}
