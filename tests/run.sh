#!/bin/bash
# Runs every test_* function in tests/test_*.sh (or the files given as args).
# Each test runs in its own subshell. Exit non-zero if any test fails.
cd "$(dirname "$0")/.." || exit 1
files=("$@")
[ ${#files[@]} -eq 0 ] && files=(tests/test_*.sh)

pass=0; failed=0; failures=""
for f in "${files[@]}"; do
  names=$(grep -oE '^test_[A-Za-z0-9_]+' "$f" | sort -u)
  for t in $names; do
    if ( set -u; . tests/helpers.sh; . "$f"; "$t" ) ; then
      pass=$((pass+1)); echo "ok   $f::$t"
    else
      failed=$((failed+1)); failures="$failures $f::$t"; echo "FAIL $f::$t"
    fi
  done
done
echo "---"
echo "$pass passed, $failed failed"
[ "$failed" -eq 0 ] || { echo "failed:$failures"; exit 1; }
