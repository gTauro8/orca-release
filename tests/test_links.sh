# shellcheck shell=bash
# ## links: domain and typed links between projects.

_links_root() { # recipes a (with the given ## links lines) and b
  new_tmp
  mk_recipe "$TMP/root" a "h/o/a" ""
  mk_recipe "$TMP/root" b "h/o/b" ""
  printf '## links\n' >> "$TMP/root/recipes/a.md"
  for l in "$@"; do printf '%s\n' "$l" >> "$TMP/root/recipes/a.md"; done
}

_parse() { python3 -I -B -c 'import sys, json; sys.path.insert(0, sys.argv[1]); import links; print(json.dumps(links.parse_links(open(sys.argv[2]).read()), sort_keys=True))' "$SCRIPTS" "$1"; }

test_links_parse_confirmed_and_pending() {
  _links_root "- domain: team-shop" "- domain-label: Team Shop" "- uses-api: b" "- follows: c <!-- inferred: confirm -->"
  out=$(_parse "$TMP/root/recipes/a.md") || return 1
  assert_eq '{"domain": "team-shop", "domain_label": "Team Shop", "links": [{"target": "b", "type": "uses-api"}], "pending": [{"target": "c", "type": "follows"}]}' "$out"
}

test_links_parse_without_section() {
  new_tmp; mk_recipe "$TMP/root" a "h/o/a" ""
  assert_eq '{"domain": null, "domain_label": null, "links": [], "pending": []}' "$(_parse "$TMP/root/recipes/a.md")"
}

test_validate_links_unknown_type() {
  _links_root "- calls: b"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
  assert_eq 1 "$rc" && assert_contains "$out" "a.md: unknown link type 'calls'"
}

test_validate_links_unknown_target() {
  _links_root "- uses-api: ghost"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
  assert_eq 1 "$rc" && assert_contains "$out" "a.md: link target 'ghost' is not a recipe id (use ext:<Name> for external systems)"
}

test_validate_links_self_and_two_domains() {
  _links_root "- related: a" "- domain: x" "- domain: y"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1); rc=$?
  assert_eq 1 "$rc" && assert_contains "$out" "a.md: links to itself" && assert_contains "$out" "a.md: more than one domain"
}

test_validate_links_ext_ok() {
  _links_root "- replaces: ext:Joomla" "- uses-api: b" "- domain: core"
  out=$("$SCRIPTS/validate-recipes.sh" "$TMP/root" 2>&1) || fail "$out"
}

# _two_repos: repos app and cms (remote .../team/cms-backend) with recipes; app/CLAUDE.md mentions cms-backend on line 3.
_two_repos() {
  new_tmp
  mk_repo "$TMP/app" "https://git.example.com/team/app.git"
  mk_repo "$TMP/cms" "https://git.example.com/team/cms-backend.git"
  for r in app cms; do git -C "$TMP/$r" update-ref refs/remotes/origin/main HEAD; done
  mk_recipe "$TMP/root" app "git.example.com/team/app" "$TMP/app"
  mk_recipe "$TMP/root" cms "git.example.com/team/cms-backend" "$TMP/cms"
  printf '# App\n\nReads content from cms-backend (the CMS).\n' > "$TMP/app/CLAUDE.md"
}
_scan() { python3 -I "$SCRIPTS/scan_recipes.py" --root "$TMP/root" "$@"; }

test_scan_link_candidate_from_claude_md() {
  _two_repos; out=$(_scan)
  assert_contains "$out" '+ link? cms — "Reads content from cms-backend (the CMS)." (CLAUDE.md:3)' &&
  assert_contains "$out" "## app — ok"
}

test_scan_link_candidate_skips_existing_and_ignored() {
  _two_repos; printf '## links\n- uses-api: cms\n' >> "$TMP/root/recipes/app.md"
  assert_not_contains "$(_scan)" "link? cms" existing || return 1
  mk_recipe "$TMP/root" app "git.example.com/team/app" "$TMP/app"; echo '<!-- ignore: link:cms -->' >> "$TMP/root/recipes/app.md"
  assert_not_contains "$(_scan)" "link? cms" ignored
}

test_scan_link_candidate_short_id() {
  _two_repos
  mk_repo "$TMP/api" "https://git.example.com/team/api.git"
  mk_recipe "$TMP/root" api "git.example.com/team/api" "$TMP/api"
  printf 'The api is slow.\n' > "$TMP/app/README.md"
  assert_not_contains "$(_scan)" "link? api" plain-word || return 1
  printf 'Calls git.example.com/team/api for orders.\n' > "$TMP/app/README.md"
  assert_contains "$(_scan)" "link? api" repo-path
}

test_scan_link_candidate_not_self() {
  _two_repos; printf 'This app is the app.\n' > "$TMP/app/README.md"
  assert_not_contains "$(_scan)" "link? app"
}

test_scan_json_links() {
  _two_repos; out=$(_scan --json-links) || return 1
  printf '%s' "$out" | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
assert len(d) == 1, d
c = d[0]
assert (c["from"], c["to"], c["file"], c["line"]) == ("app", "cms", "CLAUDE.md", 3), c
assert c["text"] == "Reads content from cms-backend (the CMS).", c
' || fail "json shape"
}

test_scan_candidates_survive_odd_package_json() {
  _two_repos
  mk_repo "$TMP/odd" "https://git.example.com/team/odd-repo.git"
  mk_recipe "$TMP/root" oddrepo "git.example.com/team/odd-repo" "$TMP/odd"
  printf '["not", "an", "object"]' > "$TMP/odd/package.json"
  mk_repo "$TMP/odd2" "https://git.example.com/team/odd-two.git"
  mk_recipe "$TMP/root" oddtwo "git.example.com/team/odd-two" "$TMP/odd2"
  printf '{"description": {"nested": true}}' > "$TMP/odd2/package.json"
  assert_contains "$(_scan)" '+ link? cms'
}
