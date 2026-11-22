#!/bin/bash
# dev-cmds.sh <recipe> — the [auto] commands of the recipe's "## dev" section, one per line, in order.
# Each is a long-running process: /dev starts each one in its own Orca terminal. Manual steps are not printed.
# Exit 2 if the recipe has no "## dev" section.
. "$(dirname "$0")/lib.sh"
recipe="$1"
section_has "$recipe" dev || { echo "error no dev section" >&2; exit 2; }
awk '/^## /{h=$0; sub(/[ \t]+$/, "", h); inside=(h=="## dev"); next} inside' "$recipe" | while IFS= read -r line; do
  step="${line#- \[ \] }"
  [ "$step" = "$line" ] && continue
  if [ "$(step_kind "$step")" = command ]; then
    printf '%s\n' "$step" | sed -E 's/^`([^`]+)`.*$/\1/'
  fi
done
