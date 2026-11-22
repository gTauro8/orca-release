# Test helpers. Sourced by tests/run.sh before each test file.
# shellcheck shell=bash

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"   # real path: /var vs /private/var on macOS
SCRIPTS="$REPO_ROOT/skills/orca-release/scripts"

fail() { echo "    FAIL: $*" >&2; return 1; }

assert_eq() { # expected actual [msg]
  [ "$1" = "$2" ] || fail "${3:-} expected [$1] got [$2]"
}

assert_contains() { # haystack needle [msg]
  case "$1" in *"$2"*) return 0 ;; esac
  fail "${3:-} [$1] does not contain [$2]"
}

assert_not_contains() { # haystack needle [msg]
  case "$1" in *"$2"*) fail "${3:-} [$1] contains [$2]"; return 1 ;; esac
  return 0
}

# Fresh temp dir per test, exported as TMP.
new_tmp() { TMP="$(mktemp -d "${TMPDIR:-/tmp}/orca-release-test.XXXXXX")"; TMP="$(cd "$TMP" && pwd -P)"; }

# mk_repo <dir> [remote_url] : git repo with one commit and optional origin.
mk_repo() {
  mkdir -p "$1"
  git -C "$1" init -q -b main
  git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  if [ -n "${2:-}" ]; then git -C "$1" remote add origin "$2"; fi
}

# mk_recipe <root> <id> <remotes-csv> <paths-csv> [host]
# Writes <root>/recipes/<id>.md with all required sections.
mk_recipe() {
  local root="$1" id="$2" remotes="$3" paths="$4" host="${5:-gitea}"
  mkdir -p "$root/recipes"
  {
    echo "---"
    echo "id: $id"
    echo "match:"
    echo "  remotes: [$(csv_to_list "$remotes")]"
    echo "  paths: [$(csv_to_list "$paths")]"
    echo "host: $host"
    echo "base_branch: main"
    echo "---"
    echo "## push"
    echo '- [ ] `true`'
    echo "## pr"
    echo "- title: free"
    echo "## deploy"
    echo "### prod (confirm)"
    echo "- [ ] check manually"
  } > "$root/recipes/$id.md"
}

csv_to_list() { # "a,b" -> "a", "b"
  [ -z "$1" ] && return 0
  echo "$1" | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"", (i>1?", ":""), $i}}'
}
