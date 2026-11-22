#!/bin/bash
# register-hint.sh — add the session-start hint (Claude Code SessionStart hook) to ~/.claude/settings.json and to every
# Orca Claude profile's settings.json (Orca keeps a copy per profile). Other hooks, Orca's included, are left alone.
# Idempotent. Exit 1 if any file could not be updated (that file is left untouched).
engine="$(cd "$(dirname "$0")/.." && pwd -P)"
hook_cmd="bash \"$engine/scripts/session-hint.sh\" # orca-release-hint"
seen=""
failed=0
register() {
  local f="$1" real
  [ -e "$f" ] || [ "$f" = "$HOME/.claude/settings.json" ] || return 0
  real=$(cd "$(dirname "$f")" 2>/dev/null && pwd -P)/$(basename "$f")
  [ -L "$f" ] && real=$(cd "$(dirname "$f")" && cd "$(dirname "$(readlink "$f")")" && pwd -P)/$(basename "$(readlink "$f")")
  case "$seen" in *"|$real|"*) return 0 ;; esac
  seen="$seen|$real|"
  mkdir -p "$(dirname "$f")"
  if python3 -I "$engine/scripts/register-hook.py" "$f" "$hook_cmd"; then
    echo "session hint registered in $f"
  else
    echo "could not register the session hint in $f" >&2; failed=1
  fi
}
register "$HOME/.claude/settings.json"
for f in "$HOME/Library/Application Support/orca/claude-profiles"/*/home/settings.json; do
  if [ -e "$f" ]; then register "$f"; fi
done
exit "$failed"
