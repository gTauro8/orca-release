#!/bin/bash
# install.sh [--data DIR] — install from a clone: link every skill into the skill folders of the agents Orca
# launches (~/.agents, ~/.claude, and ~/.gemini / ~/.grok when present), record skills/orca-release as the engine,
# register the session hint. Your recipes live in a data folder of yours, never in this clone:
#   --data DIR      use DIR (created by /release-setup if it does not exist yet)
#   (no --data)     keep the data folder already configured; a checkout that has recipes/ is its own data folder
#                   (the author's setup); otherwise none is recorded and /release-setup creates one.
# Must be run from the main checkout of a git clone.
set -u
here="$(cd "$(dirname "$0")" && pwd -P)"
engine="$here/skills/orca-release"
data=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data) data="${2:-}"; shift 2 || { echo "--data needs a folder" >&2; exit 1; } ;;
    *) echo "unknown option: $1 (usage: install.sh [--data DIR])" >&2; exit 1 ;;
  esac
done

git_dir=$(cd "$here" && git rev-parse --path-format=absolute --git-dir) || exit 1
common=$(cd "$here" && git rev-parse --path-format=absolute --git-common-dir) || exit 1
if [ "$git_dir" != "$common" ]; then
  echo "run install.sh from the main checkout, not a worktree ($here)" >&2
  exit 1
fi

skills="orca-release push pr deploy compose align updates weekly-report release-setup prompt status dev dashboard"
# Names used before 1.2.0: links to them that point into this repo are removed.
old_skills="allinea aggiornamenti report-settimanale configura-rilascio stato"
targets="$HOME/.claude/skills $HOME/.agents/skills"
for a in .gemini .grok; do [ -d "$HOME/$a" ] && targets="$targets $HOME/$a/skills"; done

# Check everything first: never leave a half-done install.
for t in $targets; do
  for s in $skills; do
    dest="$t/$s"
    if [ -L "$dest" ]; then
      case "$(readlink "$dest")" in "$here"/*) continue ;; esac
      echo "refusing: $dest is a link to $(readlink "$dest"), not to this repo" >&2; exit 1
    elif [ -e "$dest" ]; then
      echo "refusing: $dest already exists and is not managed by this repo" >&2; exit 1
    fi
  done
done

for t in $targets; do
  for s in $old_skills; do
    if [ -L "$t/$s" ]; then
      case "$(readlink "$t/$s")" in "$here"/*) rm "$t/$s" && echo "removed old $t/$s" ;; esac
    fi
  done
done

for t in $targets; do
  mkdir -p "$t"
  for s in $skills; do
    ln -sfn "$here/skills/$s" "$t/$s"
    echo "linked $t/$s -> $here/skills/$s"
  done
done

mkdir -p "$HOME/.config/orca-release"
echo "$engine" > "$HOME/.config/orca-release/engine"
current=$(cat "$HOME/.config/orca-release/root" 2>/dev/null)
if [ -n "$data" ]; then
  mkdir -p "$data" && data="$(cd "$data" && pwd -P)" || exit 1
  [ "$data" = "$here" ] && [ ! -d "$here/recipes" ] && { echo "refusing: the clone itself is not a data folder" >&2; exit 1; }
elif [ -n "$current" ] && [ -d "$current" ]; then
  data="$current"
elif [ -d "$here/recipes" ]; then
  data="$here"
fi
if [ -n "$data" ]; then
  echo "$data" > "$HOME/.config/orca-release/root"
  echo "data folder: $data"
else
  echo "no data folder yet: ask an agent to “set up the release skills” (/release-setup) to create one"
fi

# Session-start hint (Claude Code hook) in the global settings and every Orca Claude profile.
exec bash "$engine/scripts/register-hint.sh"
