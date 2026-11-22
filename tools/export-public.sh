#!/bin/bash
# tools/export-public.sh <target-dir> — copy the publishable files (tools/public-files.txt) into a separate folder and
# refuse if any of them mentions something private: the names and hosts of the recipes in this checkout, this
# machine's user and home, the git identity, and the words in .private-words (untracked, one regex per line).
# Never touches git in the target: commit and push there yourself.
set -u
here="$(cd "$(dirname "$0")/.." && pwd -P)"
target="${1:-}"
[ -n "$target" ] || { echo "usage: tools/export-public.sh <target-dir>" >&2; exit 2; }
mkdir -p "$target" && target="$(cd "$target" && pwd -P)" || exit 1
[ "$target" = "$here" ] && { echo "refusing: target is this checkout" >&2; exit 2; }

files=$(cd "$here" && git ls-files | grep -E -f <(grep -vE '^\s*(#|$)' tools/public-files.txt) | grep -vE '/\.orca/')
[ -n "$files" ] || { echo "no files matched tools/public-files.txt" >&2; exit 1; }

# private words
words="$(id -un)|${HOME//\//\\/}"
for k in user.email user.name; do v=$(git -C "$here" config "$k"); [ -n "$v" ] && words="$words|$(printf '%s' "$v" | sed 's/[.[\*^$()+?{|]/\\&/g')"; done
for r in "$here"/recipes/*.md; do
  [ -f "$r" ] || continue
  words="$words|$(basename "$r" .md)"
  for h in $(grep -oE '[a-z0-9.-]+\.[a-z]{2,}/[A-Za-z0-9_.-]+' "$r" | cut -d/ -f1 | sort -u); do
    case "$h" in *example*|github.com|gitlab.com) ;; *) words="$words|${h//./\\.}" ;; esac
  done
done
[ -f "$here/.private-words" ] && words="$words|$(grep -vE '^\s*(#|$)' "$here/.private-words" | paste -sd'|' -)"

hits=$(cd "$here" && printf '%s\n' "$files" | xargs grep -nIiE "$words" 2>/dev/null)
if [ -n "$hits" ]; then
  echo "refusing: private content in publishable files:" >&2
  printf '%s\n' "$hits" | head -40 >&2
  exit 1
fi

(cd "$here" && printf '%s\n' "$files" | while IFS= read -r f; do mkdir -p "$target/$(dirname "$f")"; cp -p "$f" "$target/$f"; done)
echo "exported $(printf '%s\n' "$files" | wc -l | tr -d ' ') files to $target (no private content found)"
