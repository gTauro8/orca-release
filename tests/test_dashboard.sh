# shellcheck shell=bash

_dash_fixture() {
  new_tmp; mkdir -p "$TMP/root/recipes" "$TMP/root/reports"
  # released: tag v1.2.0 then 2 more commits, 1 dirty file; recipe with deploy targets
  mk_repo "$TMP/released" "https://git.example.org/team/released.git"
  git -C "$TMP/released" -c user.email=t@t -c user.name=t tag -a v1.2.0 -m v1.2.0
  git -C "$TMP/released" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
  git -C "$TMP/released" -c user.email=t@t -c user.name=t commit -q --allow-empty -m two
  git -C "$TMP/released" update-ref refs/remotes/origin/main HEAD
  echo x > "$TMP/released/dirty.txt"
  mk_recipe "$TMP/root" released "git.example.org/team/released" ""
  printf '### staging (confirm)\n- [ ] x\n' >> "$TMP/root/recipes/released.md"
  # untagged repo whose name needs escaping
  mk_repo "$TMP/odd" ""
  printf 'id-r  released  %s\nid-o  <b>odd</script>  %s\nid-g  gone  %s\n' "$TMP/released" "$TMP/odd" "$TMP/gone" > "$TMP/repos.txt"
  printf '# Report settimanale — 2026-11-16\n## In breve\n1. **Sicurezza:** aggiorna `pkg`\n## Ricette\nx\n' > "$TMP/root/reports/2026-11-16.md"
  printf '# Report settimanale — 2026-11-23\n## In breve\n1. **Nuovo:** passa a `node 24`\n## Ricette\nx\n' > "$TMP/root/reports/2026-11-23.md"
}

_dash() { ORCA_RELEASE_ROOT="$TMP/root" python3 -I "$SCRIPTS/dashboard.py" --repo-list "$TMP/repos.txt" --out "$TMP/d.html" --no-open "$@"; }

test_dashboard_writes_file_with_projects() {
  _dash_fixture; _dash >/dev/null || return 1
  h=$(cat "$TMP/d.html")
  assert_contains "$h" "<title>" && assert_contains "$h" "released" && assert_contains "$h" "v1.2.0" &&
  assert_contains "$h" "2 commits since the last release" && assert_contains "$h" "staging" &&
  assert_contains "$h" "1 uncommitted change" && assert_contains "$h" "1 uncommitted file on"
}

test_dashboard_kpis() {
  _dash_fixture; _dash >/dev/null || return 1
  h=$(cat "$TMP/d.html")
  assert_contains "$h" 'data-kpi="projects">3<' projects &&
  assert_contains "$h" 'data-kpi="dirty">1<' dirty &&
  assert_contains "$h" 'data-kpi="unreleased">2<' unreleased
}

test_dashboard_escapes_names() {
  _dash_fixture; _dash >/dev/null || return 1
  h=$(cat "$TMP/d.html")
  assert_contains "$h" "&lt;b&gt;odd&lt;/script&gt;" && assert_not_contains "$h" "<b>odd"
}

test_dashboard_untagged_and_missing() {
  _dash_fixture; _dash >/dev/null || return 1
  h=$(cat "$TMP/d.html")
  assert_contains "$h" "no tag" && assert_contains "$h" "folder not found"
}

test_dashboard_latest_report_summary() {
  _dash_fixture; _dash >/dev/null || return 1
  h=$(cat "$TMP/d.html")
  assert_contains "$h" "<strong>Nuovo:</strong> passa a <code>node 24</code>" && assert_not_contains "$h" "Sicurezza:"
}

test_dashboard_italic_and_missing_last() {
  _dash_fixture
  printf '# Weekly report — 2026-11-30\n## Summary\n1. advisory *high* on x\n' > "$TMP/root/reports/2026-11-30.md"
  _dash >/dev/null || return 1
  h=$(cat "$TMP/d.html")
  assert_contains "$h" "advisory <em>high</em> on x" italic || return 1
  python3 -I -c 'import sys; h=open(sys.argv[1]).read(); sys.exit(0 if h.index("folder not found") > h.index("v1.2.0") else 1)' "$TMP/d.html" || fail "missing project not last"
}

test_dashboard_default_out_in_data_folder() {
  _dash_fixture
  ORCA_RELEASE_ROOT="$TMP/root" python3 -I "$SCRIPTS/dashboard.py" --repo-list "$TMP/repos.txt" --no-open >/dev/null || return 1
  [ -f "$TMP/root/dashboard/index.html" ] || fail "no default output"
}

test_dashboard_no_external_resources() {
  _dash_fixture; _dash >/dev/null || return 1
  assert_not_contains "$(cat "$TMP/d.html")" "http"
}

test_dashboard_json_for_control_panel() {
  _dash_fixture
  printf '{}' > /dev/null
  mkdir -p "$TMP/released/graphify-out" && printf '{"nodes":[],"links":[]}' > "$TMP/released/graphify-out/graph.json"
  printf 'name: x\n' > "$TMP/released/pubspec.yaml"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" python3 -I "$SCRIPTS/dashboard.py" --repo-list "$TMP/repos.txt" --json) || return 1
  printf '%s' "$out" | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
assert d["report"]["name"] == "2026-11-23", d["report"]
assert "node 24" in d["report"]["items"][0]
p = {r["name"]: r for r in d["projects"]}
r = p["released"]
assert r["tag"] == "v1.2.0" and r["since"] == 2 and r["dirty"] >= 1, r
assert "staging" in r["targets"], r["targets"]
assert "flutter" in r["stack"], r["stack"]
assert r["graphify"] is True and p["<b>odd</script>"]["graphify"] is False
assert len(r["weeks"]) == 12 and sum(r["weeks"]) == 3, r["weeks"]
assert r["recipe_file"].endswith("released.md"), r["recipe_file"]
assert p["gone"]["missing"] is True
' || fail "json shape"
  [ ! -e "$TMP/root/dashboard/index.html" ] || fail "json mode must not write the html page"
}

test_dashboard_json_graph() {
  _dash_fixture
  mk_recipe "$TMP/root" odd "" "$TMP/odd"
  printf '{"dependencies": {"left-pad": "^1.0.0", "zod": "^3"}}' > "$TMP/released/package.json"
  printf '{"lockfileVersion": 3, "packages": {"node_modules/left-pad": {"version": "1.0.0"}}}' > "$TMP/released/package-lock.json"
  printf '{"dependencies": {"left-pad": "^1.3.0"}}' > "$TMP/odd/package.json"
  printf '{"lockfileVersion": 3, "packages": {"node_modules/left-pad": {"version": "1.3.0"}}}' > "$TMP/odd/package-lock.json"
  printf '## links\n- domain: core\n- uses-api: odd\n- related: ghost\n- follows: odd <!-- inferred: confirm -->\n' >> "$TMP/root/recipes/released.md"
  out=$(ORCA_RELEASE_ROOT="$TMP/root" python3 -I "$SCRIPTS/dashboard.py" --repo-list "$TMP/repos.txt" --json) || return 1
  printf '%s' "$out" | RP="$TMP/released" OP="$TMP/odd" python3 -I -c '
import json, os, sys
d = json.load(sys.stdin)
p = {r["name"]: r for r in d["projects"]}
r = p["released"]
assert r["domain"] == "core" and r["domain_label"] is None, r
assert r["links"] == [{"type": "uses-api", "target": "odd"}], r["links"]
assert d["shared_deps"] == {"left-pad": {os.environ["RP"]: "1.0.0", os.environ["OP"]: "1.3.0"}}, d["shared_deps"]
assert r["deps"] == {"left-pad": "1.0.0"}, r["deps"]
assert p["gone"].get("links", []) == [], p["gone"]
' || fail "graph json"
}
