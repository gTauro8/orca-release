#!/bin/bash
# pr-url.sh <host> <normalized-remote> <base> <branch> [template]
# Prints the web URL where a PR can be opened. Exit 4 for github (use `gh pr create`), 1 for unknown host.
host="$1"; remote="$2"; base="$3"; branch="$4"; tpl="${5:-}"
case "$host" in
  github) echo "github: use gh pr create" >&2; exit 4 ;;
  gitea)  echo "https://$remote/compare/$base...$branch" ;;
  other)
    if [ -n "$tpl" ]; then
      out="${tpl//\{remote\}/$remote}"; out="${out//\{base\}/$base}"; out="${out//\{branch\}/$branch}"
      echo "$out"
    else
      echo "https://$remote"
    fi ;;
  *) echo "unknown host '$host'" >&2; exit 1 ;;
esac
