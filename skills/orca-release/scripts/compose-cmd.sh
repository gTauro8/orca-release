#!/bin/bash
# compose-cmd.sh <recipe> <action> [service] — print the exact commands for a /compose action, one per line.
# Actions: up stop status logs reset volumes.
# Exit: 0 ok · 1 unknown action · 2 no "## compose" section · 3 missing project/file.
. "$(dirname "$0")/lib.sh"
recipe="$1"; action="${2:-up}"; one="${3:-}"

section_has "$recipe" compose || { echo "error no compose section" >&2; exit 2; }
file=$(section_get "$recipe" compose file)
project=$(section_get "$recipe" compose project)
[ -n "$project" ] || { echo "error missing project" >&2; exit 3; }
[ -n "$file" ] || { echo "error missing file" >&2; exit 3; }
services=$(section_get "$recipe" compose services)
oneshot=$(section_get "$recipe" compose oneshot)
C="docker compose -p $project -f $file"

join() { echo "$*" | sed -E 's/[[:space:]]+/ /g; s/ $//'; }   # cmd + optional args, no trailing space
override() { section_get "$recipe" compose "$1"; }

case "$action" in
  up)
    o=$(override up); [ -n "$o" ] && { echo "$o"; exit 0; }
    if [ -n "$oneshot" ]; then
      join "$C up -d $oneshot"
      rest=""
      for s in $services; do case " $oneshot " in *" $s "*) ;; *) rest="$rest $s" ;; esac; done
      join "$C up -d --wait $rest"
    else
      join "$C up -d --wait $services"
    fi ;;
  stop)
    o=$(override stop); [ -n "$o" ] && { echo "$o"; exit 0; }
    join "$C stop $services" ;;
  status)  echo "$C ps -a" ;;
  logs)    join "$C logs --tail 100 ${one:-$services}" ;;
  reset)
    o=$(override reset); [ -n "$o" ] && { echo "$o"; exit 0; }
    echo "$C down -v" ;;
  volumes) echo "$C config --volumes" ;;
  *) echo "unknown action '$action'" >&2; exit 1 ;;
esac
