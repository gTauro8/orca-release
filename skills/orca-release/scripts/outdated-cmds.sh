#!/bin/bash
# outdated-cmds.sh DIR — read-only commands that list outdated dependencies for the repo at DIR, one per line.
# Run them from DIR. They never change lockfiles or install anything.
d="${1:-$PWD}"
[ -f "$d/package.json" ] && echo "npm outdated"
# flutter pub outdated may run an implicit `pub get` (rewrites pubspec.lock / .dart_tool): run it on a temp copy.
# Without pubspec.lock there is nothing to compare safely, so skip.
if [ -f "$d/pubspec.yaml" ] && [ -f "$d/pubspec.lock" ]; then
  echo 't=$(mktemp -d) && cp pubspec.yaml pubspec.lock "$t"/ && (cd "$t" && flutter pub outdated); rm -rf "$t"'
fi
[ -f "$d/go.mod" ] && echo "go list -u -m all"
if [ -f "$d/requirements.txt" ] || [ -f "$d/pyproject.toml" ]; then
  [ -f "$d/.venv/bin/python" ] && echo ".venv/bin/python -m pip list --outdated"
fi
exit 0
