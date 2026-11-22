# shellcheck shell=bash

test_step_kind() {
  . "$SCRIPTS/lib.sh"
  assert_eq command "$(step_kind '`flutter test`')" plain &&
  assert_eq command "$(step_kind '`make test` <!-- inferred: confirm -->')" inferred &&
  assert_eq manual "$(step_kind 'bump version in pubspec.yaml')" prose &&
  assert_eq manual "$(step_kind 'run `make test` then check output')" mixed &&
  assert_eq manual "$(step_kind '`a` and `b`')" two-spans
}

_valid_root() { new_tmp; mkdir -p "$TMP/root/recipes"; }

test_template_is_valid_recipe() {
  _valid_root
  sed 's/^id: .*/id: demo/' "$REPO_ROOT/skills/orca-release/templates/recipe.md" > "$TMP/root/recipes/demo.md"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1) || fail "$out"
}

test_missing_section_fails() {
  _valid_root; mk_recipe "$TMP/root" x "h/o/x" ""
  sed -i '' '/^## deploy/,$d' "$TMP/root/recipes/x.md"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
  assert_eq 1 "$rc" && assert_contains "$out" "x.md: missing section deploy"
}

test_bad_host_fails() {
  _valid_root; mk_recipe "$TMP/root" x "h/o/x" "" gitlab
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
  assert_eq 1 "$rc" && assert_contains "$out" "host"
}

test_host_other_valid() {
  _valid_root; mk_recipe "$TMP/root" a "h/o/a" "" other
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1) || fail "$out"
}

test_engine_has_no_personal_content() {
  # Names come from this machine (the author's recipes, user, home), so the test itself publishes none of them.
  words="/Users/|orca-manager|personalized|install\.sh|$(id -un)"
  for r in "$REPO_ROOT"/recipes/*.md; do
    [ -f "$r" ] || continue
    words="$words|$(basename "$r" .md)"
    for h in $(grep -oE '[a-z0-9.-]+\.[a-z]{2,}/[A-Za-z0-9_.-]+' "$r" | cut -d/ -f1-2 | sort -u); do
      case "$h" in *example*) ;; *) words="$words|${h//./\\.}" ;; esac
    done
  done
  hits=$(grep -rIn -iE "$words" "$REPO_ROOT/skills")
  assert_eq "" "$hits" "personal or author-only content in shared skills:"
}

test_every_skill_is_tracked_by_git() {
  for f in "$REPO_ROOT"/skills/*/SKILL.md; do
    rel="${f#$REPO_ROOT/}"
    git -C "$REPO_ROOT" ls-files --error-unmatch "$rel" >/dev/null 2>&1 && continue
    git -C "$REPO_ROOT" check-ignore -q "$rel" && { fail "$rel is ignored by .gitignore"; return 1; }
  done
  return 0
}

test_no_compiled_files_in_skills() {
  new_tmp; mkdir -p "$TMP/root/recipes"; printf '' > "$TMP/repos.txt"
  ORCA_RELEASE_ROOT="$TMP/root" python3 -I "$SCRIPTS/dashboard.py" --repo-list "$TMP/repos.txt" --out "$TMP/d.html" --no-open >/dev/null || return 1
  hits=$(find "$REPO_ROOT/skills" \( -name '*.pyc' -o -name __pycache__ \))
  assert_eq "" "$hits" "compiled files in shared skills:"
}

test_dev_and_prompt_safety_wording() {
  grep -q 'wait for an explicit yes before saving or running anything' "$REPO_ROOT/skills/dev/SKILL.md" || { fail "dev must gate drafts"; return 1; }
  grep -q 'never auto-run a step marked' "$REPO_ROOT/skills/dev/SKILL.md" || { fail "dev must not auto-run inferred steps"; return 1; }
  grep -q -- '--no-parent' "$REPO_ROOT/skills/prompt/SKILL.md" || fail "prompt must create independent worktrees"
}

test_skills_call_scripts_through_interpreters() {
  # every "$E/scripts/x.sh" must be preceded by `bash `, every "$E/scripts/x.py" by `-I ` (python3 -I)
  hits=$(find "$REPO_ROOT/skills" -name '*.md' -exec perl -ne '
    while (/(.{0,11})"\$E\/scripts\/[\w-]+\.(sh|py)"/g) {
      my ($pre, $ext) = ($1, $2);
      print "$ARGV: $&\n" unless ($ext eq "sh" && $pre =~ /bash $/) || ($ext eq "py" && $pre =~ /-I $/);
    }' {} +)
  assert_eq "" "$hits" "scripts must be run as bash \"\$E/scripts/x.sh\" / python3 -I \"…py\":"
}

test_skills_step1_clean() {
  for f in "$REPO_ROOT"/skills/{push,pr,deploy,compose,align,updates,weekly-report,prompt,status,dev}/SKILL.md; do
    grep -q 'Locate the two folders' "$f" || { fail "$f: missing canonical step 1"; return 1; }
    grep -qE 'stop\.\.|first and stop\. and' "$f" && { fail "$f: broken splice"; return 1; }
  done
  return 0
}

test_configura_reruns_setup_when_already_configured() {
  grep -q 'still run `bash "$E/scripts/setup.sh" "$D"`' "$REPO_ROOT/skills/release-setup/SKILL.md" || fail "release-setup must re-run setup to record the engine"
}

test_id_must_match_filename() {
  _valid_root; mk_recipe "$TMP/root" x "h/o/x" ""
  mv "$TMP/root/recipes/x.md" "$TMP/root/recipes/y.md"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
  assert_eq 1 "$rc" && assert_contains "$out" "y.md: id"
}

test_needs_remote_or_path() {
  _valid_root; mk_recipe "$TMP/root" x "" ""
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
  assert_eq 1 "$rc" && assert_contains "$out" "x.md: no match"
}

test_duplicate_remote_fails() {
  _valid_root
  mk_recipe "$TMP/root" a "git.example.com/team/mobile-app" ""
  mk_recipe "$TMP/root" b "https://git.example.com/team/mobile-app.git" ""
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
  assert_eq 1 "$rc" && assert_contains "$out" "duplicate remote"
}

test_compose_reset_confirmed_before_running() {
  f="$REPO_ROOT/skills/compose/SKILL.md"
  grep -qF 'For `reset`, do step 7 first' "$f" || fail "step 5 must defer reset commands until the user says yes"
}

test_skills_frontmatter() {
  . "$SCRIPTS/lib.sh"
  for s in push pr deploy compose align updates weekly-report release-setup prompt status dev dashboard; do
    f="$REPO_ROOT/skills/$s/SKILL.md"
    [ -f "$f" ] || { fail "missing $f"; return 1; }
    assert_eq "$s" "$(frontmatter_get "$f" name)" "$s name" || return 1
    desc=$(frontmatter_get "$f" description)
    case "$s" in
      push)   assert_contains "$desc" "fai il push" "$s desc" && assert_contains "$desc" "push this branch" "$s desc" || return 1 ;;
      pr)     assert_contains "$desc" "apri la PR" "$s desc" && assert_contains "$desc" "open a PR" "$s desc" || return 1 ;;
      deploy) assert_contains "$desc" "rilascia" "$s desc" && assert_contains "$desc" "deploy to production" "$s desc" || return 1 ;;
      compose) assert_contains "$desc" "avvia i servizi" "$s desc" && assert_contains "$desc" "start the services" "$s desc" || return 1 ;;
      align) assert_contains "$desc" "allinea le ricette" "$s desc" && assert_contains "$desc" "align the recipes" "$s desc" || return 1 ;;
      updates) assert_contains "$desc" "novità" "$s desc" && assert_contains "$desc" "any updates" "$s desc" || return 1 ;;
      weekly-report) assert_contains "$desc" "report settimanale" "$s desc" && assert_contains "$desc" "weekly report" "$s desc" || return 1 ;;
      release-setup) assert_contains "$desc" "configura le skill" "$s desc" && assert_contains "$desc" "set up the release skills" "$s desc" || return 1 ;;
      prompt) assert_contains "$desc" "nuovo task" "$s desc" && assert_contains "$desc" "new task" "$s desc" || return 1 ;;
      status) assert_contains "$desc" "stato dei progetti" "$s desc" && assert_contains "$desc" "project status" "$s desc" || return 1 ;;
      dev) assert_contains "$desc" "avvia lo sviluppo" "$s desc" && assert_contains "$desc" "start dev" "$s desc" || return 1 ;;
      dashboard) assert_contains "$desc" "dashboard" "$s desc" || return 1 ;;
    esac
    grep -q 'procedure.md' "$f" || { fail "$s does not load shared procedure"; return 1; }
  done
}

test_recipe_save_commits_only_that_file() {
  f="$REPO_ROOT/skills/orca-release/procedure.md"
  grep -qF 'commit -m "recipes: update <id>" -- "recipes/<id>.md"' "$f" || fail "save must commit with pathspec"
}

test_push_has_no_bare_stash() {
  f="$REPO_ROOT/skills/push/SKILL.md"
  if grep -qiE '(^|[^-])stash([^ ]|$)| stash,' "$f" && ! grep -qF 'git stash push -u -m' "$f"; then
    fail "push offers stash without the safe tagged procedure"; return 1
  fi
  grep -qF 'git stash apply' "$f" || fail "push must restore stashed changes"
}

test_push_checks_upstream_name() {
  f="$REPO_ROOT/skills/push/SKILL.md"
  grep -qF 'upstream branch name differs' "$f" || fail "push must treat a differently-named upstream as no upstream"
}

_compose_valid_case() { # lines appended as ## compose to a valid recipe; prints validator output, sets rc
  _valid_root; mk_recipe "$TMP/root" x "h/o/x" ""
  { echo "## compose"; for l in "$@"; do echo "$l"; done; } >> "$TMP/root/recipes/x.md"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
}

test_compose_requires_file() {
  _compose_valid_case '- project: p'
  assert_eq 1 "$rc" && assert_contains "$out" "x.md: missing compose file"
}

test_compose_requires_project() {
  _compose_valid_case '- file: `docker-compose.yml`'
  assert_eq 1 "$rc" && assert_contains "$out" "x.md: missing compose project"
}

test_compose_rejects_server_file() {
  _compose_valid_case '- file: `docker-compose.dev.yml`' '- project: p'
  assert_eq 1 "$rc" && assert_contains "$out" "server compose file"
}

test_compose_server_file_confirmed_ok() {
  _compose_valid_case '- file: `docker-compose.dev.yml` <!-- local: confirmed -->' '- project: p'
  assert_eq 0 "$rc" "$out"
}

test_compose_override_must_be_command() {
  _compose_valid_case '- file: `compose.yaml`' '- project: p' '- up: make dev-up'
  assert_eq 1 "$rc" && assert_contains "$out" "override up must be one backticked command"
}

test_compose_valid_section_passes() {
  _compose_valid_case '- file: `compose.yaml`' '- project: p' '- up: `make dev-up`' '- services: db'
  assert_eq 0 "$rc" "$out"
}

test_all_valid_passes() {
  _valid_root; mk_recipe "$TMP/root" a "h/o/a" ""; mk_recipe "$TMP/root" b "" "/tmp/b"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1) || fail "$out"
}

test_align_covers_links() {
  f="$REPO_ROOT/skills/align/SKILL.md"
  for w in --json-links uses-api follows replaces related "ignore: link:" domain; do
    grep -qF -- "$w" "$f" || { fail "align SKILL.md does not mention $w"; return 1; }
  done
}

test_example_with_links_is_valid() {
  _valid_root
  f="$REPO_ROOT/skills/orca-release/examples/example-node-api.md"
  grep -q '^## links' "$f" && grep -q 'ext:' "$f" || { fail "example has no ## links with an ext: target"; return 1; }
  cp "$f" "$TMP/root/recipes/example-node-api.md"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1) || fail "$out"
}
