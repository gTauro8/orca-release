# shellcheck shell=bash

oc() { "$SCRIPTS/outdated-cmds.sh" "$1"; }

test_outdated_node() {
  new_tmp; mk_repo "$TMP/a"; echo '{}' > "$TMP/a/package.json"
  assert_eq "npm outdated" "$(oc "$TMP/a")"
}

test_outdated_flutter_and_go() {
  new_tmp; mk_repo "$TMP/a"; touch "$TMP/a/pubspec.yaml" "$TMP/a/pubspec.lock" "$TMP/a/go.mod"
  assert_eq 't=$(mktemp -d) && cp pubspec.yaml pubspec.lock "$t"/ && (cd "$t" && flutter pub outdated); rm -rf "$t"
go list -u -m all' "$(oc "$TMP/a")"
}

test_outdated_flutter_without_lock_skipped() {
  new_tmp; mk_repo "$TMP/a"; touch "$TMP/a/pubspec.yaml"
  assert_eq "" "$(oc "$TMP/a")"
}

test_outdated_python_only_with_venv() {
  new_tmp; mk_repo "$TMP/a"; touch "$TMP/a/requirements.txt"
  assert_eq "" "$(oc "$TMP/a")" no-venv || return 1
  mkdir -p "$TMP/a/.venv/bin"; touch "$TMP/a/.venv/bin/python"
  assert_eq ".venv/bin/python -m pip list --outdated" "$(oc "$TMP/a")" venv
}

test_outdated_none() {
  new_tmp; mk_repo "$TMP/a"
  assert_eq "" "$(oc "$TMP/a")"
}
