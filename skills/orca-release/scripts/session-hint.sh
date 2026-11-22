#!/bin/bash
# session-hint.sh [dir] — Claude Code SessionStart hook: one line with the project's stack and useful skills.
# Prints hook JSON, or nothing. Always exits 0 so it can never break session start.
dir="${1:-$PWD}"
out=$(bash "$(dirname "$0")/find-recipe.sh" "$dir" 2>/dev/null) || exit 0

get() { printf '%s\n' "$out" | awk -v k="$1" '$1==k{ $1=""; sub(/^ /,""); print; exit }'; }
root=$(get root); recipe=$(get recipe); stack=$(get stack); compose=$(get compose)
[ -n "$root" ] || exit 0

has_compose=""
[ "$compose" != "none" ] && [ -n "$compose" ] && has_compose=1
for c in "$root"/docker-compose*.yml "$root"/docker-compose*.yaml "$root"/compose.yaml "$root"/compose.yml; do
  [ -e "$c" ] && { has_compose=1; break; }
done
# Silent unless this repo has a recipe or a compose file (the hook runs in every Claude session).
[ "$recipe" = "none" ] && [ -z "$has_compose" ] && exit 0

skills=""
[ -n "$has_compose" ] && skills="/compose"
[ "$recipe" != "none" ] && grep -q '^## dev[[:space:]]*$' "$recipe" 2>/dev/null && skills="$skills /dev"
[ "$recipe" != "none" ] && skills="$skills /push /pr /deploy"
skills="${skills# }"

line="📦 $(basename "$root")"
[ "$stack" != "-" ] && line="$line · $stack"
[ -n "$skills" ] && line="$line · skill: $skills"
[ "$recipe" = "none" ] && line="$line · no recipe: /push creates one"
if [ "$recipe" != "none" ] && [ "$(bash "$(dirname "$0")/scan-recipes.sh" --repo "$root" --status 2>/dev/null)" = "update" ]; then
  line="$line · ⚠ recipe out of date: /align"
fi

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
l=$(esc "$line")
printf '{"systemMessage": "%s", "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "%s"}}\n' "$l" "$l"
exit 0
