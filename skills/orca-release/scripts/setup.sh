#!/bin/bash
# setup.sh [DATA_DIR] [--hook] — first-time setup after installing the skills from an Orca share link.
# Creates the personal data folder (default ~/orca-release-data: recipes/, reports/, tech-watch.md, a git repo),
# records it and this engine in ~/.config/orca-release/. Never overwrites existing files.
# --hook also registers the session-start hint (asks nothing: the calling skill asks the user first).
set -u
engine="$(cd "$(dirname "$0")/.." && pwd -P)"
data="" hook=0
for a in "$@"; do
  case "$a" in --hook) hook=1 ;; *) data="$a" ;; esac
done
data="${data:-$HOME/orca-release-data}"
# A clone of the skills package is code, not a data folder: recipes saved there would end up in its history.
if [ -d "$data/skills/orca-release" ]; then
  echo "refusing: $data is a copy of the orca-release package; pick another folder for your recipes (e.g. ~/orca-release-data)" >&2
  exit 1
fi

mkdir -p "$data/recipes" "$data/reports" || exit 1
data="$(cd "$data" && pwd -P)"
[ -f "$data/tech-watch.md" ] || cp "$engine/templates/tech-watch.md" "$data/tech-watch.md"
for ig in /dashboard/ /prompts/; do
  grep -qx "$ig" "$data/.gitignore" 2>/dev/null || echo "$ig" >> "$data/.gitignore"
done
[ -f "$data/README.md" ] || printf '# My recipes\n\nRecipes and reports for the orca-release skills. One recipe per project in `recipes/`.\nTemplate: `%s/templates/recipe.md`.\n' "$engine" > "$data/README.md"
if ! git -C "$data" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$data" init -q -b main
  git -C "$data" add -A
  git -C "$data" -c commit.gpgsign=false commit -q -m "orca-release: dati iniziali" ||
    echo "warning: git commit failed in $data (set git user.name / user.email); files are there, uncommitted" >&2
fi

mkdir -p "$HOME/.config/orca-release"
echo "$data" > "$HOME/.config/orca-release/root"
echo "$engine" > "$HOME/.config/orca-release/engine"
echo "data folder: $data"
echo "engine: $engine"

[ "$hook" = 1 ] && exec bash "$engine/scripts/register-hint.sh"
exit 0
