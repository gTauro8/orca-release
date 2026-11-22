#!/bin/bash
# find-recipe.sh [dir] — which release recipe applies to the git repo containing dir.
# Output (one "key value" per line): root, remote, recipe (path|none), stack.
# Exit: 0 match or none · 2 several recipes match · 3 not a git repo · 4 no release root configured.
. "$(dirname "$0")/lib.sh"

dir="${1:-$PWD}"
top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || { echo "error not-a-git-repo $dir"; exit 3; }
top=$(cd "$top" && pwd -P)
common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
main_top=""
[ -n "$common" ] && main_top=$(cd "$common/.." 2>/dev/null && pwd -P)

url=$(git -C "$dir" config --get remote.origin.url)
remote="-"
[ -n "$url" ] && remote=$(normalize_remote "$url")

root=$(release_root)
[ -n "$root" ] && [ -d "$root/recipes" ] || { echo "error no-release-root (run the release-setup skill)"; exit 4; }

same_path() { # a b : equal after resolving symlinks
  local a b
  a=$(cd "$1" 2>/dev/null && pwd -P) || return 1
  b=$(cd "$2" 2>/dev/null && pwd -P) || return 1
  [ "$a" = "$b" ]
}

matches=""
for f in "$root"/recipes/*.md; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in _*) continue ;; esac
  hit=""
  if [ "$remote" != "-" ]; then
    while IFS= read -r r; do
      [ -n "$r" ] && [ "$(normalize_remote "$r")" = "$remote" ] && hit=1
    done <<EOF
$(frontmatter_list "$f" remotes)
EOF
  fi
  if [ -z "$hit" ]; then
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      if same_path "$p" "$top" || { [ -n "$main_top" ] && same_path "$p" "$main_top"; }; then hit=1; fi
    done <<EOF
$(frontmatter_list "$f" paths)
EOF
  fi
  [ -n "$hit" ] && matches="$matches $f"
done

stack=""
add() { stack="$stack $1"; }
[ -f "$top/pubspec.yaml" ] && add flutter
{ [ -d "$top/ios" ] || ls -d "$top"/*.xcodeproj >/dev/null 2>&1; } && add ios
[ -d "$top/android" ] && add android
[ -f "$top/go.mod" ] && add go
[ -f "$top/package.json" ] && add node
{ [ -f "$top/pyproject.toml" ] || [ -f "$top/requirements.txt" ]; } && add python
{ ls "$top"/docker-compose*.yml >/dev/null 2>&1 || [ -f "$top/Dockerfile" ] || [ -f "$top/compose.yaml" ] || [ -f "$top/compose.yml" ]; } && add docker
[ -f "$top/Makefile" ] && add make
for w in "$top"/.github/workflows/*.yml "$top"/.github/workflows/*.yaml; do
  [ -e "$w" ] && { add gh-actions; break; }
done
[ -d "$top/.gitea/workflows" ] && add gitea-actions
stack="${stack# }"

set -- $matches
if [ $# -gt 1 ]; then echo "error multiple $*"; exit 2; fi

echo "root $top"
echo "remote $remote"
echo "recipe ${1:-none}"
echo "stack ${stack:--}"
cfile=""
[ -n "${1:-}" ] && cfile=$(section_get "$1" compose file)
echo "compose ${cfile:-none}"
