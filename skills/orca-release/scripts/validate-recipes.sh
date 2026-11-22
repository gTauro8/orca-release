#!/bin/bash
# validate-recipes.sh [root] — lint every recipes/*.md (files starting with _ are skipped).
# Prints "<file>: <problem>" per problem; exit 1 if any.
. "$(dirname "$0")/lib.sh"
root="${1:-$(release_root)}"
[ -d "$root/recipes" ] || { echo "no recipes dir under $root" >&2; exit 1; }

problems=0
report() { echo "$1: $2"; problems=$((problems+1)); }
seen="$(mktemp)"; trap 'rm -f "$seen"' EXIT

for f in "$root"/recipes/*.md; do
  [ -e "$f" ] || continue
  name=$(basename "$f"); case "$name" in _*) continue ;; esac
  stem="${name%.md}"

  id=$(frontmatter_get "$f" id)
  [ "$id" = "$stem" ] || report "$name" "id '$id' must equal filename '$stem'"

  host=$(frontmatter_get "$f" host)
  case "$host" in github|gitea|other) ;; *) report "$name" "host '$host' must be github|gitea|other" ;; esac

  [ -n "$(frontmatter_get "$f" base_branch)" ] || report "$name" "base_branch missing"

  remotes=$(frontmatter_list "$f" remotes); paths=$(frontmatter_list "$f" paths)
  [ -n "$remotes$paths" ] || report "$name" "no match: set match.remotes or match.paths"

  for s in push pr deploy; do
    grep -q "^## $s[[:space:]]*$" "$f" || report "$name" "missing section $s"
  done

  if section_has "$f" compose; then
    cfile=$(section_get "$f" compose file)
    [ -n "$cfile" ] || report "$name" "missing compose file"
    [ -n "$(section_get "$f" compose project)" ] || report "$name" "missing compose project"
    case "$cfile" in
      *.dev.yml|*.dev.yaml)
        case "$(section_raw "$f" compose file)" in
          *"<!-- local: confirmed -->"*) ;;
          *) report "$name" "server compose file $cfile (add <!-- local: confirmed --> if it really is local)" ;;
        esac ;;
    esac
    for o in up stop reset; do
      raw=$(section_raw "$f" compose "$o")
      [ -z "$raw" ] && continue
      [ "$(step_kind "$raw")" = command ] || report "$name" "override $o must be one backticked command"
    done
  fi

  while IFS= read -r r; do
    [ -z "$r" ] && continue
    n=$(normalize_remote "$r")
    other=$(awk -v n="$n" '$1==n{print $2; exit}' "$seen")
    if [ -n "$other" ]; then report "$name" "duplicate remote $n (also in $other)"; else echo "$n $name" >> "$seen"; fi
  done <<EOF
$remotes
EOF
done

# ## links (domain, typed links): checked across recipes, since a target must be another recipe.
link_problems=$(python3 -I "$(dirname "$0")/links.py" check "$root")
while IFS= read -r l; do
  [ -n "$l" ] && report "${l%%: *}" "${l#*: }"
done <<LINKS
$link_problems
LINKS

[ "$problems" -eq 0 ]
