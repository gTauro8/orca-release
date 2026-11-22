# shellcheck shell=bash
# deps.py: direct dependencies with resolved versions.

_deps() { python3 -I -B -c 'import sys, json; sys.path.insert(0, sys.argv[1]); import deps; print(json.dumps(deps.direct_deps(sys.argv[2]), sort_keys=True))' "$SCRIPTS" "$1"; }

test_deps_npm_lock() {
  new_tmp; mkdir -p "$TMP/r"
  printf '{"dependencies": {"@nestjs/core": "^11.0.0"}, "devDependencies": {"jest": "^29"}}' > "$TMP/r/package.json"
  printf '{"lockfileVersion": 3, "packages": {"": {}, "node_modules/@nestjs/core": {"version": "11.2.11"}}}' > "$TMP/r/package-lock.json"
  assert_eq '{"@nestjs/core": "11.2.11", "jest": "^29"}' "$(_deps "$TMP/r")"
}

test_deps_npm_without_lock() {
  new_tmp; mkdir -p "$TMP/r"; printf '{"dependencies": {"zod": "^3.22.0"}}' > "$TMP/r/package.json"
  assert_eq '{"zod": "^3.22.0"}' "$(_deps "$TMP/r")"
}

test_deps_npm_lock_v1_and_broken_json() {
  new_tmp; mkdir -p "$TMP/r"; printf '{"dependencies": {"zod": "^3"}}' > "$TMP/r/package.json"
  printf '{"lockfileVersion": 1, "dependencies": {"zod": {"version": "3.1.0"}}}' > "$TMP/r/package-lock.json"
  assert_eq '{"zod": "3.1.0"}' "$(_deps "$TMP/r")" v1 || return 1
  printf '{broken' > "$TMP/r/package.json"
  assert_eq '{}' "$(_deps "$TMP/r")" broken
}

test_deps_pubspec() {
  new_tmp; mkdir -p "$TMP/r"
  printf 'packages:\n  go_router:\n    dependency: "direct main"\n    description:\n      name: go_router\n    source: hosted\n    version: "17.0.0"\n  meta:\n    dependency: transitive\n    version: "1.16.0"\n  mocktail:\n    dependency: "direct dev"\n    version: "1.0.4"\nsdks:\n  dart: ">=3.0.0"\n' > "$TMP/r/pubspec.lock"
  assert_eq '{"go_router": "17.0.0", "mocktail": "1.0.4"}' "$(_deps "$TMP/r")"
}

test_deps_go_mod() {
  new_tmp; mkdir -p "$TMP/r"
  printf 'module x\n\ngo 1.25\n\nrequire github.com/one/a v1.2.0\n\nrequire (\n\tgithub.com/two/b v2.0.0\n\tgithub.com/three/c v0.1.0 // indirect\n)\n' > "$TMP/r/go.mod"
  assert_eq '{"github.com/one/a": "v1.2.0", "github.com/two/b": "v2.0.0"}' "$(_deps "$TMP/r")"
}
